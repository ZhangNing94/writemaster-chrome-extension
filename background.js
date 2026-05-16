// WriteMaster - Background Service Worker
// Handles DeepSeek API calls for writing assistance

const DEEPSEEK_API_URL = 'https://api.deepseek.com/v1/chat/completions';
const FREE_MONTHLY_LIMIT = 100;

// --- API Key Decoding ---
function decodeApiKey(encoded) {
  if (!encoded) return '';
  return encoded.split(',').map(c => String.fromCharCode(parseInt(c))).join('');
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

// --- Usage Tracking ---
async function checkUsageLimit() {
  const { usageCount = 0, lastResetMonth = '' } = await chrome.storage.local.get(['usageCount', 'lastResetMonth']);
  const currentMonth = `${new Date().getFullYear()}-${new Date().getMonth()}`;

  if (lastResetMonth !== currentMonth) {
    await chrome.storage.local.set({ usageCount: 0, lastResetMonth: currentMonth });
    return true;
  }

  return usageCount < FREE_MONTHLY_LIMIT;
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

      // Retrieve and decode API key
      const { apiKey: encodedKey } = await chrome.storage.sync.get('apiKey');
      if (!encodedKey) {
        sendResponse({ success: false, error: '请先设置 DeepSeek API Key' });
        return;
      }

      const apiKey = decodeApiKey(encodedKey);

      // Check usage
      const withinLimit = await checkUsageLimit();
      if (!withinLimit) {
        sendResponse({ success: false, error: `本月免费额度（${FREE_MONTHLY_LIMIT}次）已用完` });
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
