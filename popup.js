// WriteMaster - Popup Script

// --- API Key Encoding/Decoding (base64) ---
function encodeApiKey(key) {
  try { return btoa(key); } catch(e) { return ''; }
}

function decodeApiKey(encoded) {
  if (!encoded) return '';
  try { return atob(encoded); } catch(e) { return ''; }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  loadUsage();

  // Tab switching
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).style.display = 'block';
    });
  });

  // Toggle API Key visibility
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Save settings (API Key is now optional — built-in key works out of the box)
  document.getElementById('saveBtn').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value.trim();
    const defaultTone = document.getElementById('defaultTone').value;

    if (apiKey && !apiKey.startsWith('sk-')) { showMsg('API Key 格式错误，应以 sk- 开头', 'error'); return; }

    const data = { defaultTone };
    if (apiKey) data.apiKey = encodeApiKey(apiKey); // Optional — user's own key
    chrome.storage.sync.set(data, () => { showMsg('✅ 设置已保存', 'success'); });
  });

  // Reset usage (double-click count)
  document.getElementById('usageCount').addEventListener('dblclick', () => {
    chrome.storage.local.set({ usageCount: 0, lastResetMonth: '' }, () => {
      loadUsage();
      showMsg('✅ 用量已重置', 'success');
    });
  });
});

function loadSettings() {
  chrome.storage.sync.get(['apiKey', 'defaultTone'], (result) => {
    if (result.apiKey) {
      // Decode stored value
      const decodedKey = decodeApiKey(result.apiKey);
      document.getElementById('apiKey').value = decodedKey;
    }
    if (result.defaultTone) {
      document.getElementById('defaultTone').value = result.defaultTone;
    }
  });
}

function loadUsage() {
  chrome.storage.local.get(['usageCount', 'lastResetDate'], (result) => {
    const today = new Date().toDateString();
    const isToday = result.lastResetDate === today;
    const count = isToday ? (result.usageCount || 0) : 0;
    const remaining = Math.max(0, 3 - count);

    document.getElementById('usageCount').textContent = count;
    document.getElementById('usageRemaining').textContent = remaining;
    document.getElementById('progressFill').style.width = `${(count / 3) * 100}%`;
  });
}

function showMsg(text, type) {
  const msgEl = document.getElementById('saveMsg');
  msgEl.textContent = text;
  msgEl.className = `save-msg ${type}`;
  setTimeout(() => { msgEl.textContent = ''; msgEl.className = 'save-msg'; }, 3000);
}
