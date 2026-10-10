// Shared pure transforms — duplicated in content.js / background / popup for MV3 isolation.
// Keep logic identical everywhere.

function reverseChars(s) {
  // abc -> cba, handles unicode correctly
  return [...s].reverse().join('');
}

function reverseWordOrder(s) {
  // "hello big world" -> "world big hello"
  const parts = s.split(/(\s+)/);
  const words = parts.filter((_, i) => i % 2 === 0).reverse();
  const seps = parts.filter((_, i) => i % 2 === 1);
  let out = '';
  for (let i = 0; i < words.length; i++) {
    out += words[i];
    if (i < seps.length) out += seps[seps.length - 1 - i] || seps[i] || ' ';
    // Actually preserve separators in reverse too is confusing; simpler:
  }
  // Simpler correct approach: split on whitespace runs and rejoin with single handling below
  // Fallback simple:
  const tokens = s.split(/\s+/);
  if (parts.length <= 1) return tokens.reverse().join(' ');
  // Rebuild preserving original separator sequence reversed:
  let r = '';
  let wi = 0;
  // words reversed, seps kept in original order is most intuitive
  const rev = tokens.slice().reverse();
  const sepRuns = s.match(/\s+/g) || [];
  for (let i = 0; i < rev.length; i++) {
    r += rev[i];
    if (i < sepRuns.length) r += sepRuns[i];
  }
  // preserve leading/trailing whitespace
  const leading = s.match(/^\s+/)?.[0] || '';
  const trailing = s.match(/\s+$/)?.[0] || '';
  void out; void leading; void trailing;
  return r;
}

function scrambleText(s, rand = Math.random) {
  if (s.length < 2) return s;
  const arr = [...s];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  const out = arr.join('');
  // try once more if shuffle returned identical string (for >3 chars)
  if (out === s && s.length > 3) {
    return scrambleText(s, rand);
  }
  return out;
}

function scrambleWords(s, rand = Math.random) {
  // Scramble letters inside each word, keep whitespace/punctuation positions
  return s.replace(/\p{L}+/gu, (word) => {
    if (word.length < 2) return word;
    return scrambleText(word, rand);
  });
}

function toUpper(s) { return s.toUpperCase(); }
function toLower(s) { return s.toLowerCase(); }
function toTitle(s) {
  return s.toLowerCase().replace(/(?:^|[\s\-_])\p{L}/gu, (m) => m.toUpperCase());
}

// Export for Node tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reverseChars, reverseWordOrder, scrambleText, scrambleWords, toUpper, toLower, toTitle };
}
