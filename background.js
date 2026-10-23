// Text Expander Plus — background service worker (MV3)
const DEFAULT_SNIPPETS = [
  { trigger: 'brb', replacement: 'be right back' },
  { trigger: 'omw', replacement: 'on my way!' },
  { trigger: 'tyvm', replacement: 'thank you very much!' },
  { trigger: '@@', replacement: 'you@example.com' },
];

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    const cur = await chrome.storage.sync.get({ snippets: null, enabled: true });
    if (!cur.snippets) await chrome.storage.sync.set({ snippets: DEFAULT_SNIPPETS, enabled: true });
    await setupMenus();
  } else {
    await setupMenus();
  }
});

chrome.runtime.onStartup.addListener(setupMenus);

async function setupMenus() {
  try { await chrome.contextMenus.removeAll(); } catch { /* ignore */ }
  const items = [
    { id: 'count-words', title: 'Count words & letters in selection' },
    { id: 'sep0', type: 'separator' },
    { id: 'reverse-chars', title: 'Reverse characters (abc → cba)' },
    { id: 'reverse-word-order', title: 'Reverse word order' },
    { id: 'scramble', title: 'Scramble selection' },
    { id: 'scramble-words', title: 'Scramble letters in each word' },
    { id: 'sep1', type: 'separator' },
    { id: 'upper', title: 'UPPERCASE selection' },
    { id: 'lower', title: 'lowercase selection' },
    { id: 'title', title: 'Title Case selection' },
  ];
  for (const it of items) {
    try {
      if (it.type === 'separator') {
        chrome.contextMenus.create({ id: 'sep-' + Date.now() + Math.random(), type: 'separator', contexts: ['selection'] });
      } else {
        chrome.contextMenus.create({ id: it.id, title: it.title, contexts: ['selection'] });
      }
    } catch { /* duplicate */ }
  }
}

async function runTransform(tabId, kind) {
  try {
    if (kind === 'count-words') {
      await chrome.tabs.sendMessage(tabId, { type: 'count-selection' });
      return;
    }
    await chrome.tabs.sendMessage(tabId, { type: 'transform-selection', kind });
  } catch {
    // content script not injected (e.g. chrome:// pages) — try injecting then retry
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      if (kind === 'count-words') {
        await chrome.tabs.sendMessage(tabId, { type: 'count-selection' });
        return;
      }
      await chrome.tabs.sendMessage(tabId, { type: 'transform-selection', kind });
    } catch (e) {
      console.warn('transform failed', e);
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id != null && typeof info.menuItemId === 'string') {
    runTransform(tab.id, info.menuItemId);
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) runTransform(tab.id, command);
});
