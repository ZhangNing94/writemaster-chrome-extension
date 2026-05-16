// WriteMaster - Content Script
// Floating toolbar above focused textarea/input, AI writing assistance

(function() {
  'use strict';

  let toolbar = null;
  let suggestionPanel = null;
  let activeElement = null;
  let currentTone = 'professional';
  let isProcessing = false;

  // --- Create Toolbar ---
  function createToolbar() {
    if (toolbar) toolbar.remove();

    toolbar = document.createElement('div');
    toolbar.id = 'writemaster-toolbar';
    toolbar.innerHTML = `
      <div class="wm-toolbar-inner">
        <div class="wm-actions">
          <button class="wm-btn" data-op="polish" title="润色 - 让表达更流畅">
            <span>✨</span> 润色
          </button>
          <button class="wm-btn" data-op="rewrite" title="改写 - 换种说法">
            <span>🔄</span> 改写
          </button>
          <button class="wm-btn" data-op="expand" title="扩展 - 增加细节">
            <span>📝</span> 扩展
          </button>
          <button class="wm-btn" data-op="shorten" title="精简 - 去掉冗余">
            <span>✂️</span> 精简
          </button>
          <button class="wm-btn" data-op="translate" title="翻译成其他语言">
            <span>🌐</span> 翻译
          </button>
        </div>
        <div class="wm-options">
          <select class="wm-tone-select" title="选择语气风格">
            <option value="professional">💼 专业</option>
            <option value="friendly">😊 友好</option>
            <option value="concise">🎯 简洁</option>
            <option value="creative">🎨 创意</option>
          </select>
          <select class="wm-lang-select" title="翻译目标语言" style="display:none">
            <option value="en">🇬🇧 English</option>
            <option value="ja">🇯🇵 日本語</option>
            <option value="ko">🇰🇷 한국어</option>
            <option value="fr">🇫🇷 Français</option>
            <option value="de">🇩🇪 Deutsch</option>
            <option value="es">🇪🇸 Español</option>
            <option value="pt">🇵🇹 Português</option>
            <option value="ru">🇷🇺 Русский</option>
            <option value="ar">🇸🇦 العربية</option>
            <option value="th">🇹🇭 ไทย</option>
            <option value="vi">🇻🇳 Tiếng Việt</option>
            <option value="id">🇮🇩 Indonesia</option>
            <option value="it">🇮🇹 Italiano</option>
          </select>
        </div>
      </div>
    `;

    document.body.appendChild(toolbar);

    // Bind button events
    toolbar.querySelectorAll('.wm-btn').forEach(btn => {
      btn.addEventListener('click', () => handleOperation(btn.dataset.op));
    });

    // Bind tone change
    toolbar.querySelector('.wm-tone-select').addEventListener('change', (e) => {
      currentTone = e.target.value;
      chrome.storage.local.set({ preferredTone: currentTone });
    });

    // Show/hide language selector for translate
    toolbar.querySelectorAll('.wm-btn[data-op="translate"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const langSelect = toolbar.querySelector('.wm-lang-select');
        const toneSelect = toolbar.querySelector('.wm-tone-select');
        langSelect.style.display = 'inline-block';
        toneSelect.style.display = 'none';
      });
    });

    // Show tone selector for non-translate
    toolbar.querySelectorAll('.wm-btn:not([data-op="translate"])').forEach(btn => {
      btn.addEventListener('click', () => {
        const langSelect = toolbar.querySelector('.wm-lang-select');
        const toneSelect = toolbar.querySelector('.wm-tone-select');
        langSelect.style.display = 'none';
        toneSelect.style.display = 'inline-block';
      });
    });
  }

  // --- Position Toolbar ---
  function positionToolbar(el) {
    if (!toolbar || !isElementVisible(el)) {
      hideToolbar();
      return;
    }

    const rect = el.getBoundingClientRect();
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;

    // Position above the element
    let top = rect.top + scrollTop - 50;
    let left = rect.left + scrollLeft;

    // Adjust if too close to top of viewport
    if (rect.top < 70) {
      // Position below instead
      top = rect.bottom + scrollTop + 6;
    }

    // Adjust if too far right
    const toolbarWidth = toolbar.offsetWidth || 400;
    if (left + toolbarWidth > window.innerWidth) {
      left = window.innerWidth - toolbarWidth - 8;
    }
    if (left < 0) left = 8;

    toolbar.style.top = `${top}px`;
    toolbar.style.left = `${left}px`;
  }

  function isElementVisible(el) {
    if (!el || !el.offsetParent) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // --- Show/Hide Toolbar ---
  function showToolbar(el) {
    if (!toolbar) createToolbar();
    
    // Restore preferred tone
    chrome.storage.local.get(['preferredTone'], (result) => {
      if (result.preferredTone) {
        currentTone = result.preferredTone;
        const toneSelect = toolbar.querySelector('.wm-tone-select');
        if (toneSelect) toneSelect.value = currentTone;
      }
    });

    activeElement = el;
    toolbar.style.display = 'block';
    positionToolbar(el);
  }

  function hideToolbar() {
    if (toolbar) {
      toolbar.style.display = 'none';
    }
    hideSuggestion();
    activeElement = null;
  }

  // --- Get text from element ---
  function getElementText(el) {
    if (!el) return '';
    if (el.isContentEditable) {
      return el.textContent || '';
    }
    // Get selected text within the input, or fall back to full value
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    if (end > start) {
      return el.value.substring(start, end);
    }
    return el.value || '';
  }

  // --- Handle Operation ---
  async function handleOperation(operation) {
    if (!activeElement || isProcessing) return;
    isProcessing = true;

    const text = getElementText(activeElement);
    if (!text || text.trim().length < 3) {
      showSuggestion('error', '⚠️ 文本太短，请输入至少3个字符');
      isProcessing = false;
      return;
    }

    // Show loading
    showSuggestion('loading');

    // Get language for translate
    let lang = 'en';
    if (operation === 'translate') {
      const langSelect = toolbar.querySelector('.wm-lang-select');
      lang = langSelect ? langSelect.value : 'en';
    }

    // Call background
    chrome.runtime.sendMessage({
      action: 'assist',
      text: text,
      operation: operation,
      tone: currentTone,
      lang: lang
    }, (response) => {
      isProcessing = false;

      if (!response) {
        showSuggestion('error', '⚠️ 扩展通信失败，请刷新页面重试');
        return;
      }

      if (response.success) {
        showSuggestion('result', response.result, response.modeLabel);
      } else {
        showSuggestion('error', '⚠️ ' + (response.error || '操作失败'));
      }
    });
  }

  // --- Suggestion Panel ---
  function showSuggestion(type, content, label) {
    hideSuggestion();

    suggestionPanel = document.createElement('div');
    suggestionPanel.id = 'writemaster-suggestion';

    if (type === 'loading') {
      suggestionPanel.innerHTML = `
        <div class="wm-sugg-header">
          <span class="wm-sugg-label">✍️ AI 正在处理...</span>
          <button class="wm-sugg-close" title="取消">×</button>
        </div>
        <div class="wm-sugg-body">
          <div class="wm-sugg-spinner"></div>
        </div>
      `;
    } else if (type === 'error') {
      suggestionPanel.innerHTML = `
        <div class="wm-sugg-header">
          <span class="wm-sugg-label">提示</span>
          <button class="wm-sugg-close" title="关闭">×</button>
        </div>
        <div class="wm-sugg-body wm-sugg-error">${content}</div>
      `;
    } else {
      suggestionPanel.innerHTML = `
        <div class="wm-sugg-header">
          <span class="wm-sugg-label">✍️ ${label || '改写结果'}</span>
          <button class="wm-sugg-close" title="关闭">×</button>
        </div>
        <div class="wm-sugg-body">${escapeHtml(content)}</div>
        <div class="wm-sugg-footer">
          <button class="wm-sugg-apply" title="应用到文本框">✅ 应用</button>
          <button class="wm-sugg-cancel" title="保留原文">取消</button>
        </div>
      `;
    }

    document.body.appendChild(suggestionPanel);

    // Bind close
    suggestionPanel.querySelector('.wm-sugg-close').addEventListener('click', () => {
      hideSuggestion();
    });

    // Bind apply
    const applyBtn = suggestionPanel.querySelector('.wm-sugg-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => {
        applyResult(content);
      });
    }

    // Bind cancel
    const cancelBtn = suggestionPanel.querySelector('.wm-sugg-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        hideSuggestion();
      });
    }

    // Position next to active element
    positionSuggestion();
  }

  function hideSuggestion() {
    if (suggestionPanel) {
      suggestionPanel.remove();
      suggestionPanel = null;
    }
  }

  function positionSuggestion() {
    if (!suggestionPanel || !activeElement) return;

    const rect = activeElement.getBoundingClientRect();
    const scrollTop = window.scrollY;
    const scrollLeft = window.scrollX;

    // Position to the right of the element, or below if narrow
    let top = rect.top + scrollTop;
    let left = rect.right + scrollLeft + 10;

    if (left + 350 > window.innerWidth + scrollLeft) {
      // Not enough space on right, position below
      top = rect.bottom + scrollTop + 8;
      left = rect.left + scrollLeft;
    }

    // Ensure within viewport
    if (top + 300 > scrollTop + window.innerHeight) {
      top = Math.max(scrollTop + 10, scrollTop + window.innerHeight - 320);
    }
    if (left < scrollLeft + 10) left = scrollLeft + 10;

    suggestionPanel.style.top = `${top}px`;
    suggestionPanel.style.left = `${left}px`;
  }

  function applyResult(text) {
    if (!activeElement) return;

    if (activeElement.isContentEditable) {
      activeElement.textContent = text;
    } else {
      const start = activeElement.selectionStart;
      const end = activeElement.selectionEnd;
      if (start !== undefined && end !== undefined && end > start) {
        // Replace selected text
        const before = activeElement.value.substring(0, start);
        const after = activeElement.value.substring(end);
        activeElement.value = before + text + after;
      } else {
        activeElement.value = text;
      }
      // Trigger input event
      activeElement.dispatchEvent(new Event('input', { bubbles: true }));
    }

    hideSuggestion();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  // --- Focus/Blur Handlers ---
  function onFocus(e) {
    const el = e.target;
    if (!isEditable(el)) return;

    // Small delay to ensure element is fully focused
    setTimeout(() => showToolbar(el), 100);
  }

  function onBlur(e) {
    // Delay hiding to allow button clicks
    setTimeout(() => {
      if (toolbar && toolbar.matches(':hover')) return;
      if (suggestionPanel && suggestionPanel.matches(':hover')) return;
      if (document.activeElement === activeElement) return;
      hideToolbar();
    }, 300);
  }

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input' && ['text', 'search', 'url', 'email'].includes(el.type)) return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // --- Scroll handler ---
  function onScroll() {
    if (activeElement && toolbar && toolbar.style.display !== 'none') {
      positionToolbar(activeElement);
    }
    if (suggestionPanel && activeElement) {
      positionSuggestion();
    }
  }

  function onResize() {
    if (activeElement && toolbar && toolbar.style.display !== 'none') {
      positionToolbar(activeElement);
    }
  }

  // --- Keyboard shortcut ---
  function onKeydown(e) {
    if (e.key === 'Escape') {
      if (suggestionPanel) {
        hideSuggestion();
        return;
      }
      if (toolbar && toolbar.style.display !== 'none') {
        hideToolbar();
        return;
      }
    }
  }

  // --- Initialize ---
  function init() {
    createToolbar();
    toolbar.style.display = 'none';

    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', onBlur);
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKeydown);

    // Monitor DOM changes for dynamically added textareas
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && isEditable(node)) {
            node.addEventListener('focusin', onFocus);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();