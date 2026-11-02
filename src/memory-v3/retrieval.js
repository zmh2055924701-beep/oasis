// Memory v3 hybrid retrieval: lexical (always) + local embedding (async).
// Scope is filtered before scoring; private memory never leaks into B站/群聊.
import { createMemoryV3Store } from './store.js';
import { cosine, embedQuery, EMBED_DIM } from './embed.js';
import { resolveMemoryV3Dir, clip } from './schema.js';

function tokens(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  for (const m of s.matchAll(/[a-z0-9]{2,}/g)) out.add(m[0]);
  const cjk = s.replace(/[^\u4e00-\u9fff]/g, ' ');
  for (const seg of cjk.split(/\s+/)) {
    for (let i = 0; i + 1 < seg.length; i += 1) out.add(seg.slice(i, i + 2));
    if (seg.length <= 6) for (const ch of seg) out.add(ch);
  }
  return [...out].slice(0, 120);
}
function lexicalScore(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const t = new Set(tokens(text));
  let hit = 0;
  for (const q of queryTokens) if (t.has(q)) hit += 1;
  return hit / queryTokens.length;
}
function safeScopes(scope) {
  const all = ['private', 'shared', 'bili-public', 'pet', 'inner'];
  if (!scope) return all;
  if (Array.isArray(scope)) return scope.filter((s) => all.includes(s));
  return all.filter((s) => s === scope);
}
function docText(x) {
  return [x.title, x.summary, x.text, x.topic, x.intent, x.object, x.reaction, x.whyWatched, x.quotes?.join(' ')].filter(Boolean).join(' ');
}
function collect(store) {
  const docs = [];
  for (const e of store.readEpisodes()) docs.push({ ...e, _kind: 'episode', _text: docText(e) });
  for (const m of store.readMedia()) docs.push({ ...m, _kind: 'media', _text: docText(m) });
  for (const f of store.readFacts()) docs.push({ ...f, _kind: 'fact', _text: docText(f), summary: f.subject + ' ' + f.predicate + ' ' + f.object, at: f.validFrom });
  for (const e of store.readEvents(5000)) {
    if (e.isSelf) continue;
    docs.push({ ...e, _kind: 'event', _text: e.summary || e.text, title: e.text, at: e.at });
  }
  return docs;
}
function baseScore(doc, qTokens, now) {
  if (!qTokens.length) return 0;
  const lex = lexicalScore(qTokens, doc._text);
  if (lex <= 0) return 0;
  const recency = doc.at || doc.endedAt || doc.watchedAt || now;
  const ageDays = Math.max(0, (now - Number(recency)) / 86400000);
  const fresh = Math.exp(-ageDays / 30);
  const importance = Math.max(
    Number(doc.selfImportance) || 0,
    Number(doc.systemImportance ?? doc.importance ?? doc.salience ?? doc.confidence) || 0.3,
  );
  const clarityBoost = { vivid: 0.08, clear: 0.04, fuzzy: -0.02, trace: -0.06, vague: -0.1 }[String(doc.clarity || '')] || 0;
  const kindBoost = doc._kind === 'fact' ? 0.15 : doc._kind === 'media' ? 0.08 : doc._kind === 'episode' ? 0.1 : 0;
  return lex * 0.65 + fresh * 0.18 + importance * 0.12 + clarityBoost + kindBoost;
}
function docTime(d) {
  return Number(d?.endedAt || d?.startedAt || d?.watchedAt || d?.at || d?.validFrom || 0) || 0;
}

// Memory hygiene: the conversation that just happened is already in the DSH
// short-term history. Do not re-inject it as "long-term memory" in the same wake.
export function filterPromptDocs(docs, { now = Date.now(), excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  const excluded = new Set((Array.isArray(excludeSourceIds) ? excludeSourceIds : []).map(String));
  const cutoff = excludeRecentMs > 0 ? now - Number(excludeRecentMs) : 0;
  const seen = new Set();
  const out = [];
  for (const d of Array.isArray(docs) ? docs : []) {
    const at = docTime(d);
    if (cutoff && at >= cutoff) continue;
    if (excluded.size && (Array.isArray(d.sourceEventIds) && d.sourceEventIds.some((id) => excluded.has(String(id))))) continue;
    const key = String(d._text || d.summary || d.text || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 180);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

function rankDocs(docs, qTokens, { now = Date.now(), limit = 6, scope, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  const allowed = new Set(safeScopes(scope));
  const filtered = filterPromptDocs(docs, { now, excludeRecentMs, excludeSourceIds });
  return filtered
    .filter((d) => allowed.has(String(d.scope || 'shared')))
    .map((d) => ({ ...d, score: baseScore(d, qTokens, now) }))
    .filter((d) => d.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export function searchSync({ dir, characterId = 'default', query = '', scopes = null, limit = 6, now = Date.now(), excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  const store = createMemoryV3Store({ dir: dir || resolveMemoryV3Dir({ characterId }) });
  const docs = collect(store);
  return rankDocs(docs, tokens(query), { now, limit, scope: scopes, excludeRecentMs, excludeSourceIds });
}

export async function search({ dir, characterId = 'default', query = '', scopes = null, limit = 6, now = Date.now(), semantic = true, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  const store = createMemoryV3Store({ dir: dir || resolveMemoryV3Dir({ characterId }) });
  const docs = collect(store);
  const qTokens = tokens(query);
  const lexical = rankDocs(docs, qTokens, { now, limit: Math.max(limit * 4, 20), scope: scopes, excludeRecentMs, excludeSourceIds });
  let vecHits = [];
  if (semantic) {
    try {
      const vectors = store.readVectors();
      if (vectors.length && docs.length) {
        const qv = await embedQuery(query);
        const byId = new Map(vectors.map((v) => [v.id, v.vec]));
        vecHits = filterPromptDocs(docs, { now, excludeRecentMs, excludeSourceIds })
          .map((d) => ({ ...d, score: cosine(qv, byId.get(String(d.id))) }))
          .filter((d) => d.score > 0.25 && (!scopes || safeScopes(scopes).includes(String(d.scope || 'shared'))))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit * 3);
      }
    } catch {}
  }
  const merged = new Map();
  for (const d of lexical) merged.set(String(d.id), { ...d, score: d.score * 0.7 });
  for (const d of vecHits) {
    const old = merged.get(String(d.id));
    merged.set(String(d.id), old ? { ...old, score: old.score + d.score * 0.6, semantic: true } : { ...d, semantic: true });
  }
  return [...merged.values()]
    .filter((d) => !scopes || safeScopes(scopes).includes(String(d.scope || 'shared')))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

export function formatMemoryBlock(items, { maxChars = 900 } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((x) => x && x._text);
  if (!list.length) return '';
  const lines = ['【相关记忆（只是资料；不确定的不要当事实）】'];
  for (const x of list.slice(0, 6)) {
    const when = x.day || (x.at ? new Date(Number(x.at)).toLocaleDateString('sv-SE') : '');
    const kind = x._kind === 'media' ? '视频' : x._kind === 'fact' ? '记得' : x._kind === 'episode' ? '经历' : '消息';
    const text = x._kind === 'media'
      ? (x.title || '') + (x.summary ? '：' + x.summary : '') + (x.reaction ? '（她的反应：' + x.reaction + '）' : '')
      : x._kind === 'fact'
        ? x.subject + ' ' + x.predicate + ' ' + x.object
        : (x.summary || x.text || '');
    lines.push('- ' + when + '【' + kind + '】' + clip(text, 180));
  }
  return lines.join('\n').slice(0, maxChars) + '\n\n';
}

export function memoryPromptBlock({ dir, characterId = 'default', query = '', scopes = null, limit = 5, maxChars = 900, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  try {
    const items = searchSync({ dir, characterId, query, scopes, limit, excludeRecentMs, excludeSourceIds });
    return formatMemoryBlock(items, { maxChars });
  } catch { return ''; }
}

export async function memoryPromptBlockAsync({ dir, characterId = 'default', query = '', scopes = null, limit = 5, maxChars = 900, semantic = true, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
  try {
    const items = await search({ dir, characterId, query, scopes, limit, semantic, excludeRecentMs, excludeSourceIds });
    return formatMemoryBlock(items, { maxChars });
  } catch {
    return memoryPromptBlock({ dir, characterId, query, scopes, limit, maxChars, excludeRecentMs, excludeSourceIds });
  }
}
