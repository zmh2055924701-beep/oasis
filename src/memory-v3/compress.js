// MP-7 extractive compression for memory/reference blocks only.
// Fixed blocks (persona/relations/security) must never be passed here.
function sentences(text) {
  return String(text || '').split(/(?<=[。！？；\n])/u).map((s) => s.trim()).filter(Boolean);
}
export function compressExtractive(text, { query = '', maxChars = 600 } = {}) {
  const src = String(text || '');
  if (!src || src.length <= maxChars) return src;
  const qTokens = String(query || '').toLowerCase().split(/\s+/).filter((x) => x.length >= 1);
  const ss = sentences(src);
  const scored = ss.map((s, i) => {
    const low = s.toLowerCase();
    let score = 0;
    for (const q of qTokens) if (low.includes(q)) score += 2;
    if (/\d|承诺|约定|关系|不要|没有|没|不/.test(s)) score += 1.5;
    if (i === 0 || i === ss.length - 1) score += 0.5;
    return { s, i, score };
  });
  const ordered = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  let out = '';
  const chosen = new Set();
  for (const x of ordered) {
    if (out.length + x.s.length > maxChars) continue;
    chosen.add(x.i);
    out += x.s;
  }
  const rebuilt = ss.map((s, i) => (chosen.has(i) ? s : '…')).join('');
  return rebuilt.slice(0, maxChars);
}
