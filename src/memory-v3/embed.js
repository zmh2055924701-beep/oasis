// Local semantic embedder: vendored bge-small-zh-v1.5 int8 ONNX.
// Fully offline. Falls back to a deterministic hashing vector if ONNX is unavailable,
// so memory retrieval never blocks the chat path.
import crypto from 'node:crypto';
import { Embedder, QUERY_PREFIX } from '../../vendor/semantic/lib/semantic.js';

export const EMBED_DIM = 512;
export const EMBED_MODEL = 'bge-small-zh-v1.5-int8';
let embedder = null;
let loadAttempted = false;
let loadFailed = false;

function getEmbedder() {
  if (embedder) return embedder;
  if (loadFailed) return null;
  try {
    embedder = new Embedder();
    if (!embedder.available) { loadFailed = true; return null; }
    return embedder;
  } catch {
    loadFailed = true;
    return null;
  }
}

export function hashEmbed(text) {
  const vec = new Float32Array(EMBED_DIM);
  const s = String(text || '').toLowerCase();
  const grams = [];
  const chars = Array.from(s);
  for (let i = 0; i < chars.length - 1; i += 1) grams.push(chars[i] + chars[i + 1]);
  for (const g of grams) {
    const h = crypto.createHash('sha1').update(g).digest();
    const idx = h.readUInt32LE(0) % EMBED_DIM;
    vec[idx] += 1;
  }
  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < EMBED_DIM; i += 1) vec[i] /= norm;
  return vec;
}

export async function embedTexts(texts, { query = false } = {}) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || '').slice(0, 1800));
  if (!list.length) return [];
  const e = getEmbedder();
  if (e) {
    try {
      if (!loadAttempted) {
        loadAttempted = true;
        await e.ensureLoaded();
      }
      const prefixed = query ? list.map((t) => QUERY_PREFIX + t) : list;
      const vectors = [];
      for (let i = 0; i < prefixed.length; i += 16) vectors.push(...await e.embedBatch(prefixed.slice(i, i + 16)));
      return vectors;
    } catch {
      loadFailed = true;
    }
  }
  return list.map(hashEmbed);
}

export async function embedQuery(text) {
  const vectors = await embedTexts([text], { query: true });
  return vectors[0] || hashEmbed(text);
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function disposeEmbedder() {
  try { await embedder?.dispose(); } catch {}
  embedder = null; loadAttempted = false; loadFailed = false;
}
