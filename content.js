// Text Expander Plus — content script
// 1. Auto-expands snippets in <input>, <textarea>, and contenteditable.
// 2. Applies selected-text transforms on request (context menu / shortcut / popup).

(() => {
  'use strict';

  let snippets = []; // [{trigger, replacement}]
  let enabled = true;

  async function loadSettings() {
    try {
      const r = await chrome.storage.sync.get({ snippets: [], enabled: true });
      snippets = Array.isArray(r.snippets) ? r.snippets : [];
      enabled = r.enabled !== false;
    } catch { /* page without chrome API in tests */ }
  }

  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.snippets) snippets = changes.snippets.newValue || [];
    if (changes.enabled) enabled = changes.enabled.newValue !== false;
  });

  // ---------- transforms (mirrors transforms.js, self-contained for content-script) ----------
  const reverseChars = (s) => [...s].reverse().join('');
  function scrambleText(s, rand = Math.random) {
    if (s.length < 2) return s;
    const arr = [...s];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    const out = arr.join('');
    if (out === s && s.length > 3) return scrambleText(s, rand);
    return out;
  }
  const scrambleWords = (s, rand = Math.random) =>
    s.replace(/\p{L}+/gu, (w) => (w.length < 2 ? w : scrambleText(w, rand)));
  function reverseWordOrder(s) {
    const tokens = s.split(/\s+/);
    if (tokens.length <= 1) return reverseChars(s) === s ? s : tokens.reverse().join(' ');
    const sepRuns = s.match(/\s+/g) || [];
    let r = '';
    const rev = tokens.slice().reverse();
    for (let i = 0; i < rev.length; i++) {
      r += rev[i];
      if (i < sepRuns.length) r += sepRuns[i];
    }
    return r;
  }

  function applyTransform(kind, text) {
    switch (kind) {
      case 'reverse-chars': return reverseChars(text);
      case 'reverse-word-order': return reverseWordOrder(text);
      case 'scramble': return scrambleText(text);
      case 'scramble-words': return scrambleWords(text);
      case 'upper': return text.toUpperCase();
      case 'lower': return text.toLowerCase();
      case 'title':
        return text.toLowerCase().replace(/(?:^|[\s\-_])\p{L}/gu, (m) => m.toUpperCase());
      default: return text;
    }
  }

  // ---------- selection replacement ----------
  function replaceSelectionInInput(el, newText) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + newText + after;
    const pos = before.length + newText.length;
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  function replaceSelectionInContentEditable(newText) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    // collapse caret after inserted text
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function transformSelection(kind) {
    const active = document.activeElement;
    const selText = window.getSelection()?.toString() ?? '';

    // Case 1: selection inside input/textarea (selected via selectionStart/End)
    if (active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email)$/i.test(active.type || 'text')))) {
      const s = active.selectionStart ?? 0;
      const e = active.selectionEnd ?? 0;
      if (s !== e) {
        const original = active.value.slice(s, e);
        replaceSelectionInInput(active, applyTransform(kind, original));
        return true;
      }
    }
    // Case 2: normal DOM selection (incl. contenteditable)
    if (selText) {
      const transformed = applyTransform(kind, selText);
      // If inside contenteditable, replace via range; otherwise replace via exec? Use range replace.
      if (active && active.isContentEditable) {
        return replaceSelectionInContentEditable(transformed);
      }
      // Try range replacement (works on most pages)
      try {
        if (replaceSelectionInContentEditable(transformed)) return true;
      } catch { /* fall through to clipboard copy */ }
      // Fallback for non-editable pages: copy transformed text + show toast
      navigator.clipboard?.writeText(transformed).catch(() => {});
      toast(`Copied ${labelFor(kind)}: ${truncate(transformed)}`);
      return true;
    }
    return false;
  }

  function labelFor(kind) {
    return {
      'reverse-chars': 'reversed', 'reverse-word-order': 'word-order reversed',
      scramble: 'scrambled', 'scramble-words': 'word-scrambled',
      upper: 'UPPERCASE', lower: 'lowercase', title: 'Title Case',
    }[kind] || kind;
  }
  const truncate = (s, n = 60) => (s.length > n ? s.slice(0, n) + '…' : s);

  // ---------- selection counting (informational, never modifies the page) ----------
  const countWords = (s) => {
    const m = s.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu);
    return m ? m.length : 0;
  };
  const countLetters = (s) => {
    const m = s.match(/\p{L}/gu);
    return m ? m.length : 0;
  };

  // Selection to count: a selection inside a focused input/textarea wins,
  // otherwise the normal DOM/contenteditable selection.
  function selectionTextForCounting() {
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email)$/i.test(active.type || 'text')))) {
      const s = active.selectionStart ?? 0;
      const e = active.selectionEnd ?? 0;
      if (s !== e) return active.value.slice(s, e);
    }
    return window.getSelection()?.toString() ?? '';
  }

  function countSelection() {
    const text = selectionTextForCounting();
    toast(`Words: ${countWords(text)} · Letters: ${countLetters(text)}`);
    return { ok: true, words: countWords(text), letters: countLetters(text) };
  }

  let toastEl = null;
  function toast(msg) {
    if (toastEl) toastEl.remove();
    toastEl = document.createElement('div');
    toastEl.textContent = msg;
    toastEl.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#111;color:#fff;padding:8px 12px;border-radius:8px;font:13px system-ui;opacity:.95';
    document.documentElement.appendChild(toastEl);
    setTimeout(() => toastEl?.remove(), 2500);
  }

  // ---------- auto expander ----------
  // Trigger chars that commit an expansion: space, enter, tab + common punctuation.
  const DELIMITERS = new Set([' ', '\n', '\t', '.', ',', '!', '?', ';', ':', ')', ']', '"', "'"]);

  function findMatch(textBeforeCaret) {
    // Match the longest trigger that ends exactly at caret.
    // textBeforeCaret = full text up to caret (delimiter NOT included for keydown path).
    let best = null;
    for (const sn of snippets) {
      if (!sn || !sn.trigger) continue;
      const t = sn.trigger;
      if (textBeforeCaret.endsWith(t)) {
        const idx = textBeforeCaret.length - t.length;
        const prevChar = idx > 0 ? textBeforeCaret[idx - 1] : '';
        // require word boundary before trigger (start, whitespace, or punctuation)
        if (idx === 0 || /[\s(\[{'"`]/.test(prevChar)) {
          if (!best || t.length > best.trigger.length) best = sn;
        }
      }
    }
    return best;
  }

  function expandInInput(el, delimiter) {
    const caret = el.selectionStart ?? el.value.length;
    const endIdx = caret; // caret is before the delimiter char was inserted (keydown path)
    const before = el.value.slice(0, endIdx);
    const match = findMatch(before);
    if (!match) return false;
    const startIdx = endIdx - match.trigger.length;
    el.value = el.value.slice(0, startIdx) + match.replacement + delimiter + el.value.slice(endIdx);
    const pos = startIdx + match.replacement.length + delimiter.length;
    el.setSelectionRange(pos, pos);
    el.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return true;
  }

  function expandInContentEditable(delimiter) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return false;
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return false;
    const textBefore = node.textContent.slice(0, range.startOffset);
    const match = findMatch(textBefore);
    if (!match) return false;
    const startIdx = range.startOffset - match.trigger.length;
    node.textContent =
      node.textContent.slice(0, startIdx) + match.replacement + delimiter + node.textContent.slice(range.startOffset);
    const newOffset = startIdx + match.replacement.length + delimiter.length;
    const r = document.createRange();
    r.setStart(node, newOffset);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }

  // Intercept BEFORE the delimiter is inserted so caret math is exact.
  document.addEventListener('keydown', (e) => {
    if (!enabled || snippets.length === 0) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    const isDelim = key === ' ' || key === 'Enter' || key === 'Tab' || (key.length === 1 && DELIMITERS.has(key));
    if (!isDelim) return;
    const delimiter = key === 'Enter' ? '\n' : key === 'Tab' ? '\t' : key;
    const active = document.activeElement;
    let expanded = false;
    if (active && (active.tagName === 'TEXTAREA' ||
        (active.tagName === 'INPUT' && /^(text|search|url|tel|password|email)$/i.test(active.type || 'text')))) {
      expanded = expandInInput(active, delimiter);
    } else if (active && active.isContentEditable) {
      expanded = expandInContentEditable(delimiter);
    }
    if (expanded) e.preventDefault();
  }, true);

  // ---------- messages from background / popup ----------
  chrome.runtime?.onMessage?.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.kind !== 'string') return;
    if (msg.type === 'transform-selection') {
      const ok = transformSelection(msg.kind);
      sendResponse?.({ ok });
      return true;
    }
    if (msg.type === 'count-selection') {
      sendResponse?.(countSelection());
      return true;
    }
    if (msg.type === 'get-selection') {
      sendResponse?.({ text: window.getSelection()?.toString() ?? '' });
      return true;
    }
  });

  loadSettings();
})();
