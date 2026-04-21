/**
 * script.js — Nova Chat UI Controller
 * Handles: UI state, message rendering, conversation management,
 * image attachments, message actions, and localStorage persistence.
 * All API calls go through the backend proxy — no API key here.
 */

(() => {
  'use strict';

  // ── DOM References ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const chatArea = $('#chat-area');
  const chatColumn = chatArea.querySelector('.chat-column');
  const emptyState = $('#empty-state');
  const promptInput = $('#prompt-input');
  const sendBtn = $('#send-btn');
  const clearChatBtn = $('#clear-chat-btn');
  const exportChatBtn = $('#export-chat-btn');
  const scrollBottomBtn = $('#scroll-bottom-btn');
  const imageUploadBtn = $('#image-upload-btn');
  const imageFileInput = $('#image-file-input');
  const imagePreviewBar = $('#image-preview-bar');
  const imagePreviewThumb = $('#image-preview-thumb');
  const imagePreviewName = $('#image-preview-name');
  const imageRemoveBtn = $('#image-remove-btn');
  const toastContainer = $('#toast-container');
  const confirmOverlay = $('#confirm-overlay');
  const confirmMessage = $('#confirm-message');
  const confirmCancel = $('#confirm-cancel');
  const confirmOk = $('#confirm-ok');

  // ── App State ───────────────────────────────────────────────────
  const STORAGE_KEY = 'nova_chat_history';
  let state = {
    messages: [],
    isGenerating: false,
    pendingImage: null // { name, dataUrl, mimeType }
  };

  // ── Initialize ──────────────────────────────────────────────────
  function init() {
    loadFromStorage();
    renderAllMessages();
    updateEmptyState();
    bindEvents();
    promptInput.focus();
  }

  // ── Event Bindings ──────────────────────────────────────────────
  function bindEvents() {
    // Send
    sendBtn.addEventListener('click', handleSend);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-grow textarea + send button state
    promptInput.addEventListener('input', () => {
      autoGrowTextarea();
      updateSendButton();
    });

    // Image upload
    imageUploadBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleImageSelect);
    imageRemoveBtn.addEventListener('click', clearPendingImage);

    // Global actions
    clearChatBtn.addEventListener('click', () => {
      if (state.messages.length === 0) return;
      showConfirm('Clear entire conversation?', () => {
        clearChat();
        showToast('Chat cleared');
      });
    });
    exportChatBtn.addEventListener('click', handleExport);

    // Scroll-to-bottom FAB
    chatArea.addEventListener('scroll', handleScroll);
    scrollBottomBtn.addEventListener('click', () => scrollToBottom(true));

    // Suggestion chips
    document.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const prompt = chip.dataset.prompt;
        if (prompt) {
          promptInput.value = prompt;
          autoGrowTextarea();
          updateSendButton();
          handleSend();
        }
      });
    });
  }

  // ── Send Message ────────────────────────────────────────────────
  async function handleSend() {
    const text = promptInput.value.trim();
    if ((!text && !state.pendingImage) || state.isGenerating) return;

    const attachments = [];
    if (state.pendingImage) {
      attachments.push({ ...state.pendingImage, type: 'image' });
    }

    // Create user message
    const userMsg = createMessage('user', text, attachments);
    state.messages.push(userMsg);
    renderMessage(userMsg);

    // Clear input
    promptInput.value = '';
    autoGrowTextarea();
    clearPendingImage();
    updateEmptyState();

    // Generate response
    await generateResponse();
  }

  async function generateResponse() {
    state.isGenerating = true;
    updateSendButton();

    // Show typing indicator
    const typingEl = createTypingIndicator();
    chatColumn.appendChild(typingEl);
    scrollToBottom(true);

    try {
      // Build messages payload for the API
      const apiMessages = state.messages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role,
          content: m.content,
          attachments: m.attachments
        }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages })
      });

      const data = await res.json();

      // Remove typing indicator
      typingEl.remove();

      if (!res.ok) {
        const errMsg = createMessage('assistant', null);
        errMsg.status = 'error';
        errMsg.error = {
          message: data.error || 'Something went wrong.',
          retryable: data.retryable !== false
        };
        state.messages.push(errMsg);
        renderMessage(errMsg);
        saveToStorage();
        return;
      }

      // Success
      const botMsg = createMessage('assistant', data.content);
      botMsg.status = 'delivered';
      state.messages.push(botMsg);
      renderMessage(botMsg);
      saveToStorage();

    } catch (err) {
      // Network error
      typingEl.remove();
      const errMsg = createMessage('assistant', null);
      errMsg.status = 'error';
      errMsg.error = {
        message: 'Network error. Check your connection and try again.',
        retryable: true
      };
      state.messages.push(errMsg);
      renderMessage(errMsg);
      saveToStorage();
    } finally {
      state.isGenerating = false;
      updateSendButton();
      scrollToBottom(true);
    }
  }

  // ── Retry / Regenerate / Edit ───────────────────────────────────
  function retryLastMessage() {
    // Remove the last error message
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.status === 'error') {
      state.messages.pop();
      removeMessageEl(lastMsg.id);
    }
    generateResponse();
  }

  function regenerateResponse() {
    // Remove last assistant message
    const lastMsg = state.messages[state.messages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant') {
      state.messages.pop();
      removeMessageEl(lastMsg.id);
    }
    generateResponse();
  }

  function editLastUserMessage() {
    // Find the last user message
    for (let i = state.messages.length - 1; i >= 0; i--) {
      if (state.messages[i].role === 'user') {
        const msg = state.messages[i];

        // Remove the user message and everything after it
        const removed = state.messages.splice(i);
        removed.forEach(m => removeMessageEl(m.id));

        // Put content back in input
        promptInput.value = msg.content;
        autoGrowTextarea();
        updateSendButton();
        promptInput.focus();
        updateEmptyState();
        saveToStorage();
        break;
      }
    }
  }

  // ── Message Model ───────────────────────────────────────────────
  function createMessage(role, content, attachments = []) {
    return {
      id: crypto.randomUUID(),
      role,
      content: content || '',
      timestamp: Date.now(),
      status: 'delivered',
      error: null,
      attachments
    };
  }

  // ── Rendering ───────────────────────────────────────────────────
  function renderAllMessages() {
    // Clear dynamic messages (keep empty state)
    chatColumn.querySelectorAll('.message-row').forEach(el => el.remove());

    state.messages.forEach((msg, idx) => {
      renderMessage(msg, idx > 0 ? idx * 30 : 0, false);
    });

    scrollToBottom(false);
  }

  function renderMessage(msg, delay = 0, animate = true) {
    const row = document.createElement('div');
    row.className = `message-row ${msg.role}`;
    row.dataset.messageId = msg.id;
    if (animate) row.classList.add('animate-in');
    if (delay > 0) row.style.animationDelay = `${delay}ms`;

    if (msg.role === 'user') {
      row.innerHTML = buildUserBubble(msg);
    } else if (msg.status === 'error') {
      row.innerHTML = buildErrorBubble(msg);
    } else {
      row.innerHTML = buildAssistantBubble(msg);
    }

    chatColumn.appendChild(row);
    bindMessageActions(row, msg);
    scrollToBottom(animate);
  }

  function buildUserBubble(msg) {
    const escaped = NovaMarkdown.escapeHtml(msg.content);
    const imageHtml = msg.attachments.length > 0
      ? `<div class="msg-image-preview"><img src="${msg.attachments[0].dataUrl}" alt="${NovaMarkdown.escapeHtml(msg.attachments[0].name)}"></div>`
      : '';

    return `
      <div class="bubble user-bubble">
        ${imageHtml}
        ${msg.content ? `<div class="bubble-text">${escaped}</div>` : ''}
      </div>
      <div class="message-actions user-actions">
        <button class="action-btn edit-btn" title="Edit"><span class="material-symbols-outlined">edit</span></button>
      </div>
    `;
  }

  function buildAssistantBubble(msg) {
    const renderedContent = NovaMarkdown.render(msg.content);
    return `
      <div class="bubble-row">
        <div class="bot-avatar">
          <span class="material-symbols-outlined">auto_awesome</span>
        </div>
        <div class="bubble assistant-bubble">
          <div class="bubble-content markdown-body">${renderedContent}</div>
          <div class="message-actions assistant-actions">
            <button class="action-btn copy-btn" title="Copy"><span class="material-symbols-outlined">content_copy</span></button>
            <button class="action-btn regenerate-btn" title="Regenerate"><span class="material-symbols-outlined">refresh</span></button>
          </div>
        </div>
      </div>
    `;
  }

  function buildErrorBubble(msg) {
    return `
      <div class="bubble-row">
        <div class="bot-avatar error-avatar">
          <span class="material-symbols-outlined">error</span>
        </div>
        <div class="bubble error-bubble">
          <div class="bubble-text">${NovaMarkdown.escapeHtml(msg.error.message)}</div>
          ${msg.error.retryable
            ? '<button class="retry-btn"><span class="material-symbols-outlined">refresh</span> Retry</button>'
            : ''
          }
        </div>
      </div>
    `;
  }

  function createTypingIndicator() {
    const el = document.createElement('div');
    el.className = 'message-row assistant typing-row animate-in';
    el.id = 'typing-indicator';
    el.innerHTML = `
      <div class="bubble-row">
        <div class="bot-avatar">
          <span class="material-symbols-outlined">auto_awesome</span>
        </div>
        <div class="bubble assistant-bubble typing-bubble">
          <div class="typing-dots">
            <span></span><span></span><span></span>
          </div>
        </div>
      </div>
    `;
    return el;
  }

  function removeMessageEl(id) {
    const el = chatColumn.querySelector(`[data-message-id="${id}"]`);
    if (el) el.remove();
  }

  // ── Message Action Bindings ─────────────────────────────────────
  function bindMessageActions(row, msg) {
    // Copy
    const copyBtn = row.querySelector('.copy-btn');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(msg.content).then(() => {
          const icon = copyBtn.querySelector('.material-symbols-outlined');
          icon.textContent = 'check';
          copyBtn.classList.add('copied');
          showToast('Copied to clipboard');
          setTimeout(() => {
            icon.textContent = 'content_copy';
            copyBtn.classList.remove('copied');
          }, 2000);
        });
      });
    }

    // Regenerate
    const regenBtn = row.querySelector('.regenerate-btn');
    if (regenBtn) {
      regenBtn.addEventListener('click', () => {
        if (!state.isGenerating) regenerateResponse();
      });
    }

    // Edit
    const editBtn = row.querySelector('.edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        if (!state.isGenerating) editLastUserMessage();
      });
    }

    // Retry
    const retryBtn = row.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (!state.isGenerating) retryLastMessage();
      });
    }
  }

  // ── Image Upload ────────────────────────────────────────────────
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast('Unsupported file type. Use PNG, JPEG, GIF, or WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Image too large. Max 10 MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.pendingImage = {
        name: file.name,
        dataUrl: reader.result,
        mimeType: file.type
      };
      imagePreviewThumb.src = reader.result;
      imagePreviewName.textContent = file.name;
      imagePreviewBar.classList.remove('hidden');
      updateSendButton();
    };
    reader.readAsDataURL(file);

    // Reset file input so the same file can be re-selected
    imageFileInput.value = '';
  }

  function clearPendingImage() {
    state.pendingImage = null;
    imagePreviewBar.classList.add('hidden');
    imagePreviewThumb.src = '';
    imagePreviewName.textContent = '';
    imageFileInput.value = '';
    updateSendButton();
  }

  // ── Chat Actions ────────────────────────────────────────────────
  function clearChat() {
    state.messages = [];
    chatColumn.querySelectorAll('.message-row').forEach(el => el.remove());
    updateEmptyState();
    saveToStorage();
  }

  function handleExport() {
    if (state.messages.length === 0) {
      showToast('No messages to export');
      return;
    }

    let md = '# Nova Chat Export\n\n';
    md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    state.messages.forEach(msg => {
      if (msg.role === 'user') {
        md += `## You\n\n${msg.content}\n\n`;
        if (msg.attachments.length > 0) {
          md += `*[Image attached: ${msg.attachments[0].name}]*\n\n`;
        }
      } else if (msg.status === 'error') {
        md += `## Nova (Error)\n\n${msg.error.message}\n\n`;
      } else {
        md += `## Nova\n\n${msg.content}\n\n`;
      }
      md += '---\n\n';
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nova-chat-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Chat exported');
  }

  // ── UI Helpers ──────────────────────────────────────────────────
  function updateEmptyState() {
    const hasMessages = state.messages.length > 0;
    emptyState.classList.toggle('hidden', hasMessages);
  }

  function updateSendButton() {
    const hasInput = promptInput.value.trim() !== '' || state.pendingImage !== null;
    const canSend = hasInput && !state.isGenerating;
    sendBtn.disabled = !canSend;

    // Toggle loading spinner
    sendBtn.querySelector('.send-icon').classList.toggle('hidden', state.isGenerating);
    sendBtn.querySelector('.loading-icon').classList.toggle('hidden', !state.isGenerating);
  }

  function autoGrowTextarea() {
    promptInput.style.height = 'auto';
    promptInput.style.height = Math.min(promptInput.scrollHeight, 200) + 'px';
  }

  function scrollToBottom(smooth = true) {
    requestAnimationFrame(() => {
      chatArea.scrollTo({
        top: chatArea.scrollHeight,
        behavior: smooth ? 'smooth' : 'instant'
      });
    });
  }

  function handleScroll() {
    const distFromBottom = chatArea.scrollHeight - chatArea.scrollTop - chatArea.clientHeight;
    scrollBottomBtn.classList.toggle('hidden', distFromBottom < 100);
  }

  // ── Toast System ────────────────────────────────────────────────
  function showToast(message, duration = 2500) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);

    // Trigger reflow then add visible class
    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Confirm Dialog ──────────────────────────────────────────────
  function showConfirm(message, onConfirm) {
    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');

    const handleOk = () => {
      confirmOverlay.classList.add('hidden');
      confirmOk.removeEventListener('click', handleOk);
      confirmCancel.removeEventListener('click', handleCancel);
      onConfirm();
    };
    const handleCancel = () => {
      confirmOverlay.classList.add('hidden');
      confirmOk.removeEventListener('click', handleOk);
      confirmCancel.removeEventListener('click', handleCancel);
    };

    confirmOk.addEventListener('click', handleOk);
    confirmCancel.addEventListener('click', handleCancel);
  }

  // ── Persistence ─────────────────────────────────────────────────
  function saveToStorage() {
    try {
      // Don't save image data URLs (too large for localStorage)
      const slim = state.messages.map(m => ({
        ...m,
        attachments: m.attachments.map(a => ({
          ...a,
          dataUrl: a.type === 'image' ? '(image)' : a.dataUrl
        }))
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch (e) {
      console.warn('Failed to save chat:', e);
    }
  }

  function loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        state.messages = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to load chat:', e);
      state.messages = [];
    }
  }

  // ── Boot ────────────────────────────────────────────────────────
  init();
})();
