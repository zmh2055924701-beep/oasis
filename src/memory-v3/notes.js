// MP-4 structured notes: deterministic derived index over Memory v3.
// No LLM, no mutation of raw episodes/facts.
export const NOTES_VERSION = 1;

function tsOf(x) {
  const n = Number(x?.endedAt || x?.startedAt || x?.at || x?.validFrom || Date.parse(x?.createdAt || '') || 0);
  return Number.isFinite(n) ? n : 0;
}
function words(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  for (const w of s.match(/[a-z0-9]{3,}/g) || []) out.add(w);
  for (const seg of s.replace(/[^\u4e00-\u9fff]/g, ' ').split(/\s+/)) {
    if (seg.length < 2) continue;
    for (let i = 0; i + 1 < seg.length; i += 1) out.add(seg.slice(i, i + 2));
  }
  return [...out].slice(0, 14);
}
function noteOf(x, kind) {
  const text = String(x.summary || x.text || x.topic || (x.subject ? x.subject + ' ' + x.predicate + ' ' + x.object : '') || '').slice(0, 420);
  return {
    id: 'note-' + String(x.id || (kind + '-' + tsOf(x))).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
    kind,
    sourceId: String(x.id || ''),
    text,
    summary: String(x.summary || x.topic || text).slice(0, 180),
    keywords: words(text),
    tags: Array.isArray(x.tags) ? x.tags.slice(0, 8) : [],
    contextDesc: kind === 'fact' ? [x.subject, x.predicate, x.object].filter(Boolean).join(' ') : String(x.topic || ''),
    validFrom: Number(x.validFrom || tsOf(x)) || 0,
    validTo: Number(x.validTo || 0) || 0,
    sourceIds: Array.isArray(x.sourceEventIds) ? x.sourceEventIds.slice(0, 12) : [],
    links: [],
  };
}

export function buildNotes({ episodes = [], facts = [], now = Date.now(), maxLinks = 8 } = {}) {
  const list = [];
  for (const e of Array.isArray(episodes) ? episodes : []) if (e && (e.summary || e.topic || e.text)) list.push(noteOf(e, 'episode'));
  for (const f of Array.isArray(facts) ? facts : []) if (f && (f.object || f.text)) list.push(noteOf(f, 'fact'));
  const byWord = new Map();
  for (const n of list) for (const w of n.keywords) {
    if (!byWord.has(w)) byWord.set(w, []);
    byWord.get(w).push(n.id);
  }
  const map = new Map(list.map((n) => [n.id, n]));
  for (const n of list) {
    const scores = new Map();
    for (const w of n.keywords) for (const id of byWord.get(w) || []) if (id !== n.id) scores.set(id, (scores.get(id) || 0) + 1);
    n.links = [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxLinks).map(([id]) => id).filter((id) => map.has(id));
  }
  return {
    version: NOTES_VERSION,
    generatedAt: new Date(now).toISOString(),
    notes: list,
    stats: { total: list.length, episodes: list.filter((n) => n.kind === 'episode').length, facts: list.filter((n) => n.kind === 'fact').length, links: list.reduce((s, n) => s + n.links.length, 0), rawDeleted: 0 },
  };
}

export function searchNotes(notesDoc, query, { limit = 6 } = {}) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  const qs = new Set(words(q));
  return (notesDoc?.notes || []).map((n) => {
    let score = 0;
    for (const w of qs) if (n.keywords.includes(w) || String(n.text).toLowerCase().includes(w)) score += 1;
    // Single-character CJK queries have no bigram tokens; keep a direct substring fallback.
    if (!qs.size && String(n.text).toLowerCase().includes(q)) score += 1;
    return { ...n, score };
  }).filter((n) => n.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}
