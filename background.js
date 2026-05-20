// WriteMaster - Background Service Worker
// Handles DeepSeek API calls for writing assistance

const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';
const FREE_DAILY_LIMIT = 3;

// --- Built-in API Key (base64 obfuscated) ---
const BUILT_IN_KEY_B64 = 'c2stODc4Nzc1YmQtaXdXNHI5MXhBRGk3WktZVlA4WDFZeTRjSGY2ZE9qbA==';
function _builtinKey() { return atob(BUILT_IN_KEY_B64); }

// --- Get effective API key (user's key in chrome.storage.sync, fallback to built-in) ---
async function getEffectiveApiKey() {
  const { apiKey: encodedKey } = await chrome.storage.sync.get('apiKey');
  if (encodedKey) {
    try { return atob(encodedKey); } catch(e) { return _builtinKey(); }
  }
  return _builtinKey();
}

// --- Prompt Templates ---
const OPERATION_PROMPTS = {
  polish: '请润色以下文本，保持原意但让表达更流畅、更专业。直接输出润色后的文本，不要添加任何解释：',
  rewrite: '请改写以下文本，换一种表达方式但保持相同含义。直接输出改写后的文本，不要添加任何解释：',
  expand: '请扩展以下文本，添加相关细节和例子让内容更充实丰富。直接输出扩展后的文本，不要添加任何解释：',
  shorten: '请精简以下文本，去掉冗余内容，保留核心信息。直接输出精简后的文本，不要添加任何解释：',
  translate: null // Dynamic: "请将以下文本翻译成{lang}："
};

const TONE_MODIFIERS = {
  professional: '使用专业正式的语气。',
  friendly: '使用友好亲切的语气。',
  concise: '使用简洁直接的语气。',
  creative: '使用有创意、有个性的语气。'
};

const LANGUAGES = {
  en: '英语', ja: '日语', ko: '韩语', fr: '法语', de: '德语',
  es: '西班牙语', pt: '葡萄牙语', ru: '俄语', ar: '阿拉伯语',
  th: '泰语', vi: '越南语', id: '印尼语', it: '意大利语',
  zh: '中文'
};

const MODE_LABELS = {
  polish: '润色', rewrite: '改写', expand: '扩展', shorten: '精简', translate: '翻译'
};

// --- Usage Tracking (daily, not monthly) ---
async function checkUsageLimit() {
  const { usageCount = 0, lastResetDate = '' } = await chrome.storage.local.get(['usageCount', 'lastResetDate']);
  const today = new Date().toDateString();

  if (lastResetDate !== today) {
    await chrome.storage.local.set({ usageCount: 0, lastResetDate: today });
    return true;
  }

  return usageCount < FREE_DAILY_LIMIT;
}

async function incrementUsage() {
  const { usageCount = 0 } = await chrome.storage.local.get('usageCount');
  await chrome.storage.local.set({ usageCount: usageCount + 1 });
  return usageCount + 1;
}

// --- DeepSeek API Call (Non-streaming for simplicity) ---
async function callDeepSeek(prompt, apiKey) {
  const response = await fetch(DEEPSEEK_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 2048
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    let errMsg = `API 错误 (${response.status})`;
    try {
      const errJson = JSON.parse(errBody);
      errMsg = errJson.error?.message || errMsg;
    } catch {}
    throw new Error(errMsg);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// --- Build Prompt ---
function buildPrompt(operation, text, tone, lang) {
  if (operation === 'translate') {
    const langName = LANGUAGES[lang] || lang;
    return `请将以下文本翻译成${langName}。直接输出翻译结果，不要添加任何解释：\n\n${text}`;
  }

  let prefix = OPERATION_PROMPTS[operation] || '';
  const toneMod = tone && TONE_MODIFIERS[tone] ? TONE_MODIFIERS[tone] : '';
  if (toneMod) {
    prefix = prefix.replace('。', '，' + toneMod + '。');
  }

  return `${prefix}\n\n${text}`;
}

// --- Message Handler ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'assist') return false;

  (async () => {
    try {
      const { text, operation, tone, lang } = message;

      if (!text || text.trim().length < 3) {
        sendResponse({ success: false, error: '文本太短，请输入至少3个字符' });
        return;
      }

      // Get effective API key (built-in or user's own)
      const apiKey = await getEffectiveApiKey();

      // Check usage
      const withinLimit = await checkUsageLimit();
      if (!withinLimit) {
        sendResponse({ success: false, error: `今日免费额度（${FREE_DAILY_LIMIT}次）已用完，请明天再试或配置自己的API Key解锁无限次` });
        return;
      }

      // Call API
      const prompt = buildPrompt(operation, text, tone, lang);
      const result = await callDeepSeek(prompt, apiKey);

      // Increment usage
      const newCount = await incrementUsage();

      // Learn user preference - save tone
      if (tone) {
        await chrome.storage.local.set({ preferredTone: tone });
      }

      sendResponse({
        success: true,
        result: result,
        usageCount: newCount,
        limit: FREE_MONTHLY_LIMIT,
        modeLabel: MODE_LABELS[operation] || operation
      });

    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // async response
});
