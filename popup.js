// Popup: snippet CRUD + playground transforms
const $ = (id) => document.getElementById(id);

const store = {
  async get() {
    if (chrome?.storage?.sync) {
      return chrome.storage.sync.get({ snippets: [], enabled: true });
    }
    return {
      snippets: JSON.parse(localStorage.getItem('snippets') || '[]'),
      enabled: localStorage.getItem('enabled') !== 'false',
    };
  },
  async set(d) {
    if (chrome?.storage?.sync) await chrome.storage.sync.set(d);
    else {
      if (d.snippets) localStorage.setItem('snippets', JSON.stringify(d.snippets));
      if (d.enabled !== undefined) localStorage.setItem('enabled', String(d.enabled));
    }
  },
};

// --- transforms (same as content.js) ---
const reverseChars = (s) => [...s].reverse().join('');
function scrambleText(s, rand = Math.random) {
  if (s.length < 2) return s;
  const a = [...s];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  const o = a.join('');
  return o === s && s.length > 3 ? scrambleText(s, rand) : o;
}
const scrambleWords = (s, r = Math.random) =>
  s.replace(/\p{L}+/gu, (w) => (w.length < 2 ? w : scrambleText(w, r)));
function reverseWordOrder(s) {
  const tokens = s.split(/\s+/);
  if (tokens.length <= 1) return tokens.reverse().join(' ');
  const seps = s.match(/\s+/g) || [];
  const rev = tokens.slice().reverse();
  let out = '';
  for (let i = 0; i < rev.length; i++) {
    out += rev[i];
    if (i < seps.length) out += seps[i];
  }
  return out;
}
function applyTransform(kind, text) {
  switch (kind) {
    case 'reverse-chars': return reverseChars(text);
    case 'reverse-word-order': return reverseWordOrder(text);
    case 'scramble': return scrambleText(text);
    case 'scramble-words': return scrambleWords(text);
    case 'upper': return text.toUpperCase();
    case 'lower': return text.toLowerCase();
    case 'title': return text.toLowerCase().replace(/(?:^|[\s\-_])\p{L}/gu, (m) => m.toUpperCase());
    default: return text;
  }
}

let snippets = [];

function esc(s) {
  return (s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function render() {
  const ul = $('list');
  ul.innerHTML = '';
  if (!snippets.length) {
    ul.innerHTML = '<li style="border-style:dashed">No shortcuts yet — add one above. Try <b>brb</b> → <b>be right back</b>.</li>';
  }
  for (const sn of snippets) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="t">${esc(sn.trigger)}</span><span class="arrow">→</span><span class="r" title="${esc(sn.replacement)}">${esc(sn.replacement)}</span><button class="del">✕</button>`;
    li.querySelector('.del').onclick = async () => {
      snippets = snippets.filter((x) => x.trigger !== sn.trigger);
      await store.set({ snippets });
      render();
    };
    ul.appendChild(li);
  }
}

async function init() {
  const data = await store.get();
  snippets = Array.isArray(data.snippets) ? data.snippets : [];
  $('enabled').checked = data.enabled !== false;
  render();

  $('enabled').onchange = () => store.set({ enabled: $('enabled').checked });

  $('addForm').onsubmit = async (e) => {
    e.preventDefault();
    const trigger = $('trigger').value.trim();
    const replacement = $('replacement').value;
    if (!trigger || !replacement) return;
    if (/\s/.test(trigger)) { alert('Shortcut cannot contain spaces.'); return; }
    const i = snippets.findIndex((x) => x.trigger.toLowerCase() === trigger.toLowerCase());
    if (i >= 0) snippets[i] = { trigger, replacement };
    else snippets.push({ trigger, replacement });
    await store.set({ snippets });
    $('trigger').value = '';
    $('replacement').value = '';
    render();
  };

  // playground buttons: transform selected part or whole text
  document.querySelectorAll('[data-kind]').forEach((btn) => {
    btn.onclick = () => {
      const ta = $('playground');
      const kind = btn.dataset.kind;
      const s = ta.selectionStart ?? 0;
      const e = ta.selectionEnd ?? 0;
      if (s !== e) {
        const sel = ta.value.slice(s, e);
        ta.value = ta.value.slice(0, s) + applyTransform(kind, sel) + ta.value.slice(e);
      } else {
        ta.value = applyTransform(kind, ta.value);
      }
      ta.focus();
    };
  });

  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText($('playground').value); $('copyBtn').textContent = 'Copied!'; setTimeout(() => ($('copyBtn').textContent = 'Copy result'), 900); }
    catch { alert('Copy failed'); }
  };

  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify({ snippets }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'text-expander-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  $('importFile').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result);
        const arr = Array.isArray(d) ? d : d.snippets;
        if (!Array.isArray(arr)) throw new Error('bad file');
        const map = new Map(snippets.map((x) => [x.trigger, x]));
        for (const x of arr) if (x?.trigger && x?.replacement !== undefined) map.set(x.trigger, { trigger: x.trigger, replacement: x.replacement });
        snippets = [...map.values()];
        await store.set({ snippets });
        render();
      } catch { alert('Invalid JSON file.'); }
    };
    r.readAsText(f);
    e.target.value = '';
  };

  // Apply transform to the real page selection (needs activeTab + content script)
  $('applyPageBtn').onclick = () => { $('pickRow').hidden = !$('pickRow').hidden; };
  $('pickGo').onclick = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.tabs.sendMessage(tab.id, { type: 'transform-selection', kind: $('pickKind').value });
      window.close();
    } catch {
      alert('Could not reach the page. Reload the tab and try again (chrome:// pages are blocked).');
    }
  };
}

init();
