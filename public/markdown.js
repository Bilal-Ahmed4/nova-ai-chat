/**
 * markdown.js — Lightweight Markdown-to-HTML renderer for Nova
 * Zero dependencies. Supports: headings, bold, italic, inline code,
 * code blocks with language labels + copy button, lists, links,
 * blockquotes, horizontal rules, paragraphs, line breaks.
 */

const NovaMarkdown = (() => {

  // ── Sanitize HTML to prevent XSS ──────────────────────────────
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Inline processing ─────────────────────────────────────────
  function processInline(text) {
    // Inline code (must come first to prevent inner processing)
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

    // Bold + italic
    text = text.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');

    // Links
    text = text.replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

    return text;
  }

  // ── Parse a list block (recursive for nested) ─────────────────
  function parseList(lines, startIndex, baseIndent) {
    const items = [];
    let i = startIndex;

    while (i < lines.length) {
      const line = lines[i];
      const stripped = line.replace(/^\s*/, '');
      const indent = line.length - line.trimStart().length;

      if (stripped === '') {
        i++;
        continue;
      }

      if (indent < baseIndent && i > startIndex) break;

      const olMatch = stripped.match(/^(\d+)\.\s+(.*)/);
      const ulMatch = stripped.match(/^[-*]\s+(.*)/);

      if (indent === baseIndent && (olMatch || ulMatch)) {
        const content = olMatch ? olMatch[2] : ulMatch[1];
        items.push({ content: processInline(escapeHtml(content)), children: null, ordered: !!olMatch });
        i++;

        // Check for nested list
        if (i < lines.length) {
          const nextLine = lines[i];
          const nextIndent = nextLine.length - nextLine.trimStart().length;
          const nextStripped = nextLine.trimStart();
          if (nextIndent > baseIndent && (nextStripped.match(/^[-*]\s+/) || nextStripped.match(/^\d+\.\s+/))) {
            const nested = parseList(lines, i, nextIndent);
            items[items.length - 1].children = nested.html;
            i = nested.endIndex;
          }
        }
      } else if (indent > baseIndent) {
        // Part of a nested list we haven't handled
        i++;
      } else {
        break;
      }
    }

    if (items.length === 0) return { html: '', endIndex: startIndex };

    const isOrdered = items[0].ordered;
    const tag = isOrdered ? 'ol' : 'ul';
    const html = `<${tag}>${items.map(item =>
      `<li>${item.content}${item.children ? item.children : ''}</li>`
    ).join('')}</${tag}>`;

    return { html, endIndex: i };
  }

  // ── Main render function ──────────────────────────────────────
  function render(markdown) {
    if (!markdown) return '';

    const lines = markdown.split('\n');
    const blocks = [];
    let i = 0;
    let inCodeBlock = false;
    let codeBlockLang = '';
    let codeBlockContent = [];

    while (i < lines.length) {
      const line = lines[i];

      // ── Code block fence ─────────────────────────────
      if (line.trimStart().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeBlockLang = line.trimStart().slice(3).trim();
          codeBlockContent = [];
          i++;
          continue;
        } else {
          // Close code block
          inCodeBlock = false;
          const code = escapeHtml(codeBlockContent.join('\n'));
          const langLabel = codeBlockLang ? `<span class="code-lang">${escapeHtml(codeBlockLang)}</span>` : '';
          const copyBtn = `<button class="code-copy-btn" onclick="NovaMarkdown.copyCode(this)" title="Copy code"><span class="material-symbols-outlined">content_copy</span></button>`;
          blocks.push(`<div class="code-block-wrapper">${langLabel}${copyBtn}<pre><code class="language-${escapeHtml(codeBlockLang)}">${code}</code></pre></div>`);
          codeBlockLang = '';
          codeBlockContent = [];
          i++;
          continue;
        }
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        i++;
        continue;
      }

      // ── Empty line ───────────────────────────────────
      if (line.trim() === '') {
        i++;
        continue;
      }

      // ── Heading ──────────────────────────────────────
      const headingMatch = line.match(/^(#{1,4})\s+(.*)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        const text = processInline(escapeHtml(headingMatch[2]));
        blocks.push(`<h${level + 1}>${text}</h${level + 1}>`);
        i++;
        continue;
      }

      // ── Horizontal rule ──────────────────────────────
      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        blocks.push('<hr>');
        i++;
        continue;
      }

      // ── Blockquote ───────────────────────────────────
      if (line.trimStart().startsWith('> ')) {
        const quoteLines = [];
        while (i < lines.length && lines[i].trimStart().startsWith('> ')) {
          quoteLines.push(lines[i].trimStart().slice(2));
          i++;
        }
        const quoteContent = quoteLines.map(l => processInline(escapeHtml(l))).join('<br>');
        blocks.push(`<blockquote>${quoteContent}</blockquote>`);
        continue;
      }

      // ── Unordered list ───────────────────────────────
      if (/^\s*[-*]\s+/.test(line)) {
        const indent = line.length - line.trimStart().length;
        const result = parseList(lines, i, indent);
        if (result.html) {
          blocks.push(result.html);
          i = result.endIndex;
          continue;
        }
      }

      // ── Ordered list ─────────────────────────────────
      if (/^\s*\d+\.\s+/.test(line)) {
        const indent = line.length - line.trimStart().length;
        const result = parseList(lines, i, indent);
        if (result.html) {
          blocks.push(result.html);
          i = result.endIndex;
          continue;
        }
      }

      // ── Paragraph (collect contiguous non-empty lines) ─
      const paraLines = [];
      while (i < lines.length && lines[i].trim() !== '' &&
        !lines[i].trimStart().startsWith('```') &&
        !lines[i].match(/^#{1,4}\s+/) &&
        !lines[i].trimStart().startsWith('> ') &&
        !/^\s*[-*]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^[-*_]{3,}\s*$/.test(lines[i].trim())) {
        paraLines.push(processInline(escapeHtml(lines[i])));
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push(`<p>${paraLines.join('<br>')}</p>`);
      }
    }

    // Handle unclosed code block
    if (inCodeBlock && codeBlockContent.length > 0) {
      const code = escapeHtml(codeBlockContent.join('\n'));
      const langLabel = codeBlockLang ? `<span class="code-lang">${escapeHtml(codeBlockLang)}</span>` : '';
      blocks.push(`<div class="code-block-wrapper">${langLabel}<pre><code class="language-${escapeHtml(codeBlockLang)}">${code}</code></pre></div>`);
    }

    return blocks.join('');
  }

  // ── Copy code helper ──────────────────────────────────────────
  function copyCode(button) {
    const codeEl = button.closest('.code-block-wrapper').querySelector('code');
    const text = codeEl.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const icon = button.querySelector('.material-symbols-outlined');
      icon.textContent = 'check';
      button.classList.add('copied');
      setTimeout(() => {
        icon.textContent = 'content_copy';
        button.classList.remove('copied');
      }, 2000);
    });
  }

  return { render, copyCode, escapeHtml };
})();

// Expose globally
window.NovaMarkdown = NovaMarkdown;
