/**
 * script.js — Nova Chat UI Controller
 * Handles: SSE streaming, guest mode (sessionStorage) & authenticated mode (MongoDB),
 * slide-out sidebar, settings configurations, and account registrations.
 */

(() => {
  'use strict';

  // ── DOM References ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const app = $('#app');
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

  // Sidebar elements
  const sidebarToggleBtn = $('#sidebar-toggle-btn');
  const sidebarCloseBtn = $('#sidebar-close-btn');
  const sidebarOverlay = $('#sidebar-overlay');
  const newChatBtn = $('#new-chat-btn');
  const conversationList = $('#conversation-list');
  const settingsTriggerBtn = $('#settings-trigger-btn');
  
  // Auth elements
  const loginTriggerBtn = $('#login-trigger-btn');
  const logoutBtn = $('#logout-btn');
  const authOverlay = $('#auth-overlay');
  const authCloseBtn = $('#auth-close-btn');
  const authModalTitle = $('#auth-modal-title');
  const tabLogin = $('#tab-login');
  const tabRegister = $('#tab-register');
  const authForm = $('#auth-form');
  const authUsernameInput = $('#auth-username');
  const authPasswordInput = $('#auth-password');
  const authSubmitBtn = $('#auth-submit-btn');
  const userDisplayName = $('#user-display-name');
  const authLoggedOut = $('#auth-logged-out');
  const authLoggedIn = $('#auth-logged-in');

  // Settings elements
  const settingsOverlay = $('#settings-overlay');
  const settingsCloseBtn = $('#settings-close-btn');
  const settingsForm = $('#settings-form');
  const settingsSystemTextarea = $('#settings-system');
  const settingsTemperatureRange = $('#settings-temperature');
  const tempValDisplay = $('#temp-val-display');
  const settingsTokensInput = $('#settings-tokens');

  // ── App State ───────────────────────────────────────────────────
  let state = {
    conversations: {}, // id -> { id, title, settings: {}, messages: [] }
    currentConversationId: null,
    isGenerating: false,
    pendingImage: null, // { name, dataUrl, mimeType }
    user: null, // { username, token }
    isLoginTab: true
  };

  // ── Storage Manager Abstraction (Hybrid Strategy) ────────────────
  const StorageManager = {
    isGuest() {
      return !state.user;
    },

    getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      if (state.user && state.user.token) {
        headers['Authorization'] = `Bearer ${state.user.token}`;
      }
      return headers;
    },

    async loadConversations() {
      if (this.isGuest()) {
        try {
          const raw = sessionStorage.getItem('nova_guest_conversations');
          return raw ? JSON.parse(raw) : {};
        } catch (e) {
          console.warn('Failed to load guest conversations:', e);
          return {};
        }
      } else {
        const res = await fetch('/api/conversations', {
          headers: this.getHeaders()
        });
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            handleLogout();
            showToast('Session expired. Switched to guest mode.');
            return {};
          }
          throw new Error('Failed to fetch remote conversations.');
        }
        const data = await res.json();
        
        // Convert array to object map
        const map = {};
        for (const c of data) {
          map[c._id] = {
            id: c._id,
            title: c.title,
            settings: c.settings,
            messages: [] // loaded on-demand
          };
        }
        return map;
      }
    },

    async createConversation(title, settings) {
      if (this.isGuest()) {
        const id = crypto.randomUUID();
        return { id, title, settings };
      } else {
        const res = await fetch('/api/conversations', {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({ title, settings })
        });
        if (!res.ok) throw new Error('Failed to create remote conversation.');
        const c = await res.json();
        return { id: c._id, title: c.title, settings: c.settings };
      }
    },

    async updateConversation(id, title, settings) {
      if (this.isGuest()) {
        return true;
      } else {
        const res = await fetch(`/api/conversations/${id}`, {
          method: 'PUT',
          headers: this.getHeaders(),
          body: JSON.stringify({ title, settings })
        });
        if (!res.ok) throw new Error('Failed to update conversation.');
        return true;
      }
    },

    async deleteConversation(id) {
      if (this.isGuest()) {
        return true;
      } else {
        const res = await fetch(`/api/conversations/${id}`, {
          method: 'DELETE',
          headers: this.getHeaders()
        });
        if (!res.ok) throw new Error('Failed to delete conversation.');
        return true;
      }
    },

    async getMessages(conversationId) {
      if (this.isGuest()) {
        const conv = state.conversations[conversationId];
        return conv ? conv.messages : [];
      } else {
        const res = await fetch(`/api/conversations/${conversationId}/messages`, {
          headers: this.getHeaders()
        });
        if (!res.ok) throw new Error('Failed to load messages.');
        return await res.json();
      }
    }
  };

  // ── Initialize ──────────────────────────────────────────────────
  async function init() {
    // Check JWT
    const token = localStorage.getItem('nova_jwt_token');
    const username = localStorage.getItem('nova_username');
    if (token && username) {
      state.user = { token, username };
      userDisplayName.textContent = username;
      authLoggedOut.classList.add('hidden');
      authLoggedIn.classList.remove('hidden');
    }

    await reloadWorkspace();
    bindEvents();
    promptInput.focus();
  }

  // ── Reload Workspace ────────────────────────────────────────────
  async function reloadWorkspace(forceNewChat = false) {
    try {
      state.conversations = await StorageManager.loadConversations();
      
      const keys = Object.keys(state.conversations);
      if (keys.length > 0 && !forceNewChat) {
        // Switch to the most recent conversation
        state.currentConversationId = keys[0];
        const msgs = await StorageManager.getMessages(state.currentConversationId);
        state.conversations[state.currentConversationId].messages = msgs;
        renderAllMessages();
      } else {
        state.currentConversationId = null;
        renderAllMessages();
      }
    } catch (err) {
      showToast('Error syncing conversations.');
      console.error(err);
    }
    renderConversationList();
    updateEmptyState();
  }

  // Save guest conversations back to sessionStorage
  function saveGuestConversations() {
    if (StorageManager.isGuest()) {
      sessionStorage.setItem('nova_guest_conversations', JSON.stringify(state.conversations));
    }
  }

  // ── Event Bindings ──────────────────────────────────────────────
  function bindEvents() {
    // Send message
    sendBtn.addEventListener('click', handleSend);
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    });

    // Auto-grow textarea + send btn
    promptInput.addEventListener('input', () => {
      autoGrowTextarea();
      updateSendButton();
    });

    // Image Uploads
    imageUploadBtn.addEventListener('click', () => imageFileInput.click());
    imageFileInput.addEventListener('change', handleImageSelect);
    imageRemoveBtn.addEventListener('click', clearPendingImage);

    // Global Action Buttons
    clearChatBtn.addEventListener('click', () => {
      const activeChat = state.conversations[state.currentConversationId];
      if (!activeChat || activeChat.messages.length === 0) return;
      showConfirm('Clear conversation message history?', () => {
        clearCurrentChatMessages();
        showToast('Messages cleared');
      });
    });
    exportChatBtn.addEventListener('click', handleExport);

    // Sidebar Toggling
    sidebarToggleBtn.addEventListener('click', toggleSidebar);
    sidebarCloseBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // New Chat Action
    newChatBtn.addEventListener('click', () => {
      closeSidebarOnMobile();
      createNewConversationFlow();
    });

    // Settings Modal
    settingsTriggerBtn.addEventListener('click', openSettingsModal);
    settingsCloseBtn.addEventListener('click', closeSettingsModal);
    settingsTemperatureRange.addEventListener('input', () => {
      tempValDisplay.textContent = settingsTemperatureRange.value;
    });
    settingsForm.addEventListener('submit', saveSettingsFlow);

    // Auth Actions
    loginTriggerBtn.addEventListener('click', openAuthModal);
    authCloseBtn.addEventListener('click', closeAuthModal);
    tabLogin.addEventListener('click', () => switchAuthTab(true));
    tabRegister.addEventListener('click', () => switchAuthTab(false));
    authForm.addEventListener('submit', handleAuthSubmit);
    logoutBtn.addEventListener('click', () => {
      showConfirm('Log out of your account?', () => {
        handleLogout();
        showToast('Logged out successfully');
      });
    });

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

  // ── Sidebar UI Actions ──────────────────────────────────────────
  function toggleSidebar() {
    app.classList.toggle('sidebar-open');
    app.classList.toggle('sidebar-closed');
  }

  function closeSidebar() {
    app.classList.remove('sidebar-open');
    app.classList.add('sidebar-closed');
  }

  function closeSidebarOnMobile() {
    if (window.innerWidth <= 768) {
      closeSidebar();
    }
  }

  // ── Send Message & SSE Streaming ────────────────────────────────
  async function handleSend() {
    const text = promptInput.value.trim();
    if ((!text && !state.pendingImage) || state.isGenerating) return;

    // Create a new conversation if none is active
    if (!state.currentConversationId) {
      await createNewConversationFlow(text.slice(0, 25) || 'New Chat');
    }

    const currentChat = state.conversations[state.currentConversationId];
    const isFirstMessage = !currentChat.messages || currentChat.messages.length === 0;

    const attachments = [];
    if (state.pendingImage) {
      attachments.push({ ...state.pendingImage, type: 'image' });
    }

    const userMsg = createMessage('user', text, attachments);
    currentChat.messages.push(userMsg);
    renderMessage(userMsg);

    // Auto-rename if this is the first message and current title is the default 'New Chat'
    if (isFirstMessage && currentChat.title === 'New Chat') {
      const newTitle = text.slice(0, 25).trim() || 'New Chat';
      currentChat.title = newTitle;
      try {
        await StorageManager.updateConversation(state.currentConversationId, newTitle, currentChat.settings);
        renderConversationList();
      } catch (e) {
        console.warn('Auto-rename error:', e);
      }
    }

    // Clear input
    promptInput.value = '';
    autoGrowTextarea();
    clearPendingImage();
    updateEmptyState();

    if (StorageManager.isGuest()) {
      saveGuestConversations();
    }

    // Call streaming backend
    await generateResponse();
  }

  async function generateResponse() {
    state.isGenerating = true;
    updateSendButton();

    const currentChat = state.conversations[state.currentConversationId];

    // Show typing dots
    const typingEl = createTypingIndicator();
    chatColumn.appendChild(typingEl);
    scrollToBottom(true);

    // Create assistant bubble DOM container
    const botMsg = createMessage('assistant', '');
    botMsg.status = 'generating';
    
    const botRow = document.createElement('div');
    botRow.className = 'message-row assistant animate-in';
    botRow.dataset.messageId = botMsg.id;
    botRow.innerHTML = buildAssistantBubble(botMsg);

    const bubbleContent = botRow.querySelector('.bubble-content');
    
    try {
      const apiMessages = currentChat.messages.map(m => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments
      }));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: StorageManager.getHeaders(),
        body: JSON.stringify({
          messages: apiMessages,
          conversationId: StorageManager.isGuest() ? null : state.currentConversationId,
          settings: currentChat.settings
        })
      });

      // Remove typing dots immediately
      typingEl.remove();

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server Error (${response.status})`);
      }

      // Insert message bubble
      chatColumn.appendChild(botRow);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep partial lines

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataVal = trimmed.slice(6).trim();
            if (dataVal === '[DONE]') continue;

            try {
              const parsed = JSON.parse(dataVal);
              if (parsed.error) {
                throw new Error(parsed.error);
              }
              if (parsed.text) {
                botMsg.content += parsed.text;
                bubbleContent.innerHTML = NovaMarkdown.render(botMsg.content);
                scrollToBottom(true);
              }
            } catch (e) {
              // Partial JSON chunk, wait for buffer flush
            }
          }
        }
      }

      // Successful stream close
      botMsg.status = 'delivered';
      currentChat.messages.push(botMsg);

      if (StorageManager.isGuest()) {
        saveGuestConversations();
      }

      // Bind dynamic actions to the bubble (Copy/Regenerate)
      bindMessageActions(botRow, botMsg);

    } catch (err) {
      typingEl.remove();
      botRow.remove();

      const errorMsg = createMessage('assistant', '');
      errorMsg.status = 'error';
      errorMsg.error = {
        message: err.message || 'Something went wrong.',
        retryable: true
      };
      currentChat.messages.push(errorMsg);
      renderMessage(errorMsg);

      if (StorageManager.isGuest()) {
        saveGuestConversations();
      }
    } finally {
      state.isGenerating = false;
      updateSendButton();
      scrollToBottom(true);
    }
  }

  // ── Conversation CRUD Flow ──────────────────────────────────────
  async function createNewConversationFlow(title = 'New Chat') {
    const defaultSettings = {
      systemInstruction: '',
      temperature: 0.7,
      maxOutputTokens: 2048
    };

    try {
      const conv = await StorageManager.createConversation(title, defaultSettings);
      state.conversations[conv.id] = {
        id: conv.id,
        title: conv.title,
        settings: conv.settings,
        messages: []
      };

      state.currentConversationId = conv.id;
      if (StorageManager.isGuest()) {
        saveGuestConversations();
      }
      
      renderConversationList();
      renderAllMessages();
      updateEmptyState();
      promptInput.focus();
    } catch (e) {
      showToast('Failed to create new conversation');
    }
  }

  async function switchConversation(id) {
    if (state.currentConversationId === id || state.isGenerating) return;
    
    state.currentConversationId = id;
    closeSidebarOnMobile();

    try {
      const msgs = await StorageManager.getMessages(id);
      state.conversations[id].messages = msgs;
      renderAllMessages();
    } catch (err) {
      showToast('Error loading messages.');
    }
    
    renderConversationList();
    updateEmptyState();
    promptInput.focus();
  }

  async function renameConversation(id) {
    const conv = state.conversations[id];
    if (!conv) return;

    const newTitle = prompt('Rename conversation title:', conv.title);
    if (newTitle === null) return;
    
    const trimmed = newTitle.trim();
    if (!trimmed) {
      showToast('Title cannot be empty');
      return;
    }

    try {
      conv.title = trimmed;
      await StorageManager.updateConversation(id, trimmed, conv.settings);
      if (StorageManager.isGuest()) {
        saveGuestConversations();
      }
      renderConversationList();
      showToast('Conversation renamed');
    } catch (e) {
      showToast('Failed to rename conversation');
    }
  }

  async function deleteConversationFlow(id) {
    showConfirm('Delete this conversation history permanently?', async () => {
      try {
        await StorageManager.deleteConversation(id);
        delete state.conversations[id];

        if (StorageManager.isGuest()) {
          saveGuestConversations();
        }

        if (state.currentConversationId === id) {
          const keys = Object.keys(state.conversations);
          state.currentConversationId = keys.length > 0 ? keys[0] : null;
          if (state.currentConversationId) {
            const msgs = await StorageManager.getMessages(state.currentConversationId);
            state.conversations[state.currentConversationId].messages = msgs;
          }
          renderAllMessages();
        }

        renderConversationList();
        updateEmptyState();
        showToast('Conversation deleted');
      } catch (e) {
        showToast('Failed to delete conversation');
      }
    });
  }

  async function clearCurrentChatMessages() {
    if (!state.currentConversationId) return;
    
    try {
      // Deleting messages by deleting the conversation then recreating it is cleanest, 
      // or we can delete and rebuild history empty
      const conv = state.conversations[state.currentConversationId];
      conv.messages = [];
      
      if (StorageManager.isGuest()) {
        saveGuestConversations();
      } else {
        // On authenticated backend: we delete and recreate to wipe messages
        await StorageManager.deleteConversation(state.currentConversationId);
        const newConv = await StorageManager.createConversation(conv.title, conv.settings);
        // Swap IDs
        delete state.conversations[state.currentConversationId];
        state.conversations[newConv.id] = {
          id: newConv.id,
          title: newConv.title,
          settings: newConv.settings,
          messages: []
        };
        state.currentConversationId = newConv.id;
      }
      
      renderAllMessages();
      updateEmptyState();
      renderConversationList();
    } catch (e) {
      showToast('Failed to clear chat history');
    }
  }

  // ── Settings Flow ───────────────────────────────────────────────
  function openSettingsModal() {
    if (!state.currentConversationId) {
      showToast('Create a conversation first to configure settings.');
      return;
    }
    const conv = state.conversations[state.currentConversationId];
    settingsSystemTextarea.value = conv.settings?.systemInstruction || '';
    settingsTemperatureRange.value = conv.settings?.temperature !== undefined ? conv.settings.temperature : 0.7;
    tempValDisplay.textContent = settingsTemperatureRange.value;
    settingsTokensInput.value = conv.settings?.maxOutputTokens || 2048;

    settingsOverlay.classList.remove('hidden');
  }

  function closeSettingsModal() {
    settingsOverlay.classList.add('hidden');
  }

  async function saveSettingsFlow(e) {
    e.preventDefault();
    const conv = state.conversations[state.currentConversationId];
    if (!conv) return;

    const newSettings = {
      systemInstruction: settingsSystemTextarea.value,
      temperature: parseFloat(settingsTemperatureRange.value),
      maxOutputTokens: parseInt(settingsTokensInput.value, 10)
    };

    try {
      conv.settings = newSettings;
      await StorageManager.updateConversation(conv.id, conv.title, newSettings);
      
      if (StorageManager.isGuest()) {
        saveGuestConversations();
      }
      
      closeSettingsModal();
      showToast('Settings saved for this chat.');
    } catch (err) {
      showToast('Failed to save settings.');
    }
  }

  // ── Authentication Flow ──────────────────────────────────────────
  function openAuthModal() {
    authUsernameInput.value = '';
    authPasswordInput.value = '';
    switchAuthTab(true);
    authOverlay.classList.remove('hidden');
  }

  function closeAuthModal() {
    authOverlay.classList.add('hidden');
  }

  function switchAuthTab(isLogin) {
    state.isLoginTab = isLogin;
    tabLogin.classList.toggle('active', isLogin);
    tabRegister.classList.toggle('active', !isLogin);
    authModalTitle.textContent = isLogin ? 'Sign In' : 'Create Account';
    authSubmitBtn.textContent = isLogin ? 'Log In' : 'Sign Up';

    // Reset input fields
    authUsernameInput.value = '';
    authPasswordInput.value = '';
    
    const confirmGroup = document.getElementById('confirm-password-group');
    const confirmInput = document.getElementById('auth-confirm-password');
    if (confirmGroup && confirmInput) {
      if (isLogin) {
        confirmGroup.style.display = 'none';
        confirmInput.removeAttribute('required');
        confirmInput.value = '';
      } else {
        confirmGroup.style.display = 'flex';
        confirmInput.setAttribute('required', 'true');
        confirmInput.value = '';
      }
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value;

    if (!username || !password) return;

    // Password validation on Register
    if (!state.isLoginTab) {
      const confirmInput = document.getElementById('auth-confirm-password');
      if (confirmInput && password !== confirmInput.value) {
        showToast('Passwords do not match.');
        return;
      }
    }

    const endpoint = state.isLoginTab ? '/api/auth/login' : '/api/auth/register';
    authSubmitBtn.disabled = true;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Request failed.');
      }

      if (state.isLoginTab) {
        // Login success
        localStorage.setItem('nova_jwt_token', data.token);
        localStorage.setItem('nova_username', data.username);
        
        state.user = { token: data.token, username: data.username };
        userDisplayName.textContent = data.username;
        authLoggedOut.classList.add('hidden');
        authLoggedIn.classList.remove('hidden');
        
        closeAuthModal();
        showToast(`Welcome back, ${data.username}!`);
        await reloadWorkspace(true);
      } else {
        // Register success -> switch to login
        showToast('Registered successfully. Please log in.');
        switchAuthTab(true);
      }
    } catch (err) {
      showToast(err.message || 'Authentication failed.');
    } finally {
      authSubmitBtn.disabled = false;
    }
  }

  function handleLogout() {
    localStorage.removeItem('nova_jwt_token');
    localStorage.removeItem('nova_username');
    state.user = null;
    
    authLoggedOut.classList.remove('hidden');
    authLoggedIn.classList.add('hidden');
    
    reloadWorkspace();
  }

  // ── Rendering Functions ─────────────────────────────────────────
  function renderConversationList() {
    conversationList.innerHTML = '';
    const keys = Object.keys(state.conversations);
    
    if (keys.length === 0) {
      conversationList.innerHTML = '<div class="sidebar-empty">No chats yet</div>';
      return;
    }

    // Sort by chronological creation (or updatedAt, keys in load order)
    keys.forEach(id => {
      const conv = state.conversations[id];
      const activeClass = (id === state.currentConversationId) ? 'active' : '';
      
      const item = document.createElement('div');
      item.className = `conversation-item ${activeClass}`;
      item.dataset.id = id;
      item.innerHTML = `
        <span class="conversation-item-title">${NovaMarkdown.escapeHtml(conv.title)}</span>
        <div class="conversation-item-actions">
          <button class="conversation-action-btn edit" title="Rename"><span class="material-symbols-outlined">edit</span></button>
          <button class="conversation-action-btn delete" title="Delete"><span class="material-symbols-outlined">delete</span></button>
        </div>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.conversation-action-btn')) return;
        switchConversation(id);
      });

      const editBtn = item.querySelector('.edit');
      editBtn.addEventListener('click', () => renameConversation(id));

      const deleteBtn = item.querySelector('.delete');
      deleteBtn.addEventListener('click', () => deleteConversationFlow(id));

      conversationList.appendChild(item);
    });
  }

  function renderAllMessages() {
    chatColumn.querySelectorAll('.message-row').forEach(el => el.remove());

    const activeChat = state.conversations[state.currentConversationId];
    if (!activeChat || activeChat.messages.length === 0) {
      updateEmptyState();
      return;
    }

    activeChat.messages.forEach((msg, idx) => {
      renderMessage(msg, idx > 0 ? idx * 20 : 0, false);
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
    `;
  }

  function buildAssistantBubble(msg) {
    const renderedContent = msg.content ? NovaMarkdown.render(msg.content) : '<span class="typing-dots"><span></span><span></span><span></span></span>';
    return `
      <div class="bubble-row">
        <div class="bot-avatar">
          <span class="material-symbols-outlined">auto_awesome</span>
        </div>
        <div class="bubble assistant-bubble">
          <div class="bubble-content markdown-body">${renderedContent}</div>
          <div class="message-actions assistant-actions">
            <button class="action-btn copy-btn" title="Copy"><span class="material-symbols-outlined">content_copy</span></button>
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

  // ── Message Action Bindings ─────────────────────────────────────
  function bindMessageActions(row, msg) {
    // Copy button
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

    // Retry button for errors
    const retryBtn = row.querySelector('.retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (!state.isGenerating) {
          const activeChat = state.conversations[state.currentConversationId];
          // Remove the error message from state
          activeChat.messages = activeChat.messages.filter(m => m.id !== msg.id);
          row.remove();
          generateResponse();
        }
      });
    }
  }

  // ── Image Uploading Helpers ─────────────────────────────────────
  function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
      showToast('Unsupported image type. Use PNG, JPEG, GIF, or WebP.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast('Image size exceeds 10MB.');
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

  // ── Export Chat ──────────────────────────────────────────────────
  function handleExport() {
    const activeChat = state.conversations[state.currentConversationId];
    if (!activeChat || activeChat.messages.length === 0) {
      showToast('No messages to export');
      return;
    }

    let md = `# Nova Chat Export - ${activeChat.title}\n\n`;
    md += `*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;

    activeChat.messages.forEach(msg => {
      if (msg.role === 'user') {
        md += `## You\n\n${msg.content}\n\n`;
        if (msg.attachments && msg.attachments.length > 0) {
          md += `*[Image attachment: ${msg.attachments[0].name}]*\n\n`;
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
    a.download = `${activeChat.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Conversation exported successfully.');
  }

  // ── UI Utilities ─────────────────────────────────────────────────
  function updateEmptyState() {
    const activeChat = state.conversations[state.currentConversationId];
    const hasMessages = activeChat && activeChat.messages.length > 0;
    emptyState.classList.toggle('hidden', hasMessages);
  }

  function updateSendButton() {
    const hasInput = promptInput.value.trim() !== '' || state.pendingImage !== null;
    const canSend = hasInput && !state.isGenerating;
    sendBtn.disabled = !canSend;

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

  // ── Toast Notifications ─────────────────────────────────────────
  function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('visible');
    });

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Confirm Modal Dialog ────────────────────────────────────────
  function showConfirm(message, onConfirm) {
    confirmMessage.textContent = message;
    confirmOverlay.classList.remove('hidden');

    const cleanListeners = () => {
      confirmOk.removeEventListener('click', handleOk);
      confirmCancel.removeEventListener('click', handleCancel);
    };

    const handleOk = () => {
      confirmOverlay.classList.add('hidden');
      cleanListeners();
      onConfirm();
    };

    const handleCancel = () => {
      confirmOverlay.classList.add('hidden');
      cleanListeners();
    };

    confirmOk.addEventListener('click', handleOk);
    confirmCancel.addEventListener('click', handleCancel);
  }

  // ── Start ───────────────────────────────────────────────────────
  init();
})();
