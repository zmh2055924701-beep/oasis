// Memory / Context v4 · MP-0 baseline & MP-1 budget primitives.
// Pure, deterministic; no network, no LLM, no mutation of raw memory.
import fs from 'node:fs';
import path from 'node:path';

export const MEMORY_V4_VERSION = 1;

export const DEFAULT_MEMORY_V4_CONFIG = Object.freeze({
  enabled: true,              // MP-0 audit only; behavior stays unchanged
  budget: {
    enabled: false,           // MP-1: shadow first
    shadow: true,
    totalTokens: 12000,
    fixedTokens: 4500,
    coreTokens: 900,
    historyTokens: 5000,
    retrievalTokens: 700,
    brainTokens: 500,
    handoffTokens: 600,
  },
  compaction: { enabled: false, shadow: true, maxTurns: 24, maxTokens: 30000, keepTurns: 8, minTurns: 8 },
  tiering: { enabled: false },
  notes: { enabled: false },
  temporal: { enabled: false },
  graph: { enabled: false },
  hierarchy: { enabled: false },
  compression: { enabled: false },
  forgetting: { enabled: false },
  eval: { enabled: false, sampleRate: 0.05 },
});

export function normalizeMemoryV4Config(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const base = DEFAULT_MEMORY_V4_CONFIG;
  const merged = {
    ...base,
    ...src,
    budget: { ...base.budget, ...(src.budget || {}) },
    compaction: { ...base.compaction, ...(src.compaction || {}) },
    tiering: { ...base.tiering, ...(src.tiering || {}) },
    notes: { ...base.notes, ...(src.notes || {}) },
    temporal: { ...base.temporal, ...(src.temporal || {}) },
    graph: { ...base.graph, ...(src.graph || {}) },
    hierarchy: { ...base.hierarchy, ...(src.hierarchy || {}) },
    compression: { ...base.compression, ...(src.compression || {}) },
    forgetting: { ...base.forgetting, ...(src.forgetting || {}) },
    eval: { ...base.eval, ...(src.eval || {}) },
  };
  merged.enabled = src.enabled !== false;
  merged.budget.enabled = merged.budget.enabled === true;
  merged.compaction.enabled = merged.compaction.enabled === true;
  return merged;
}

const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff]/g;
const LATIN_WORD_RE = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
const DIGIT_GROUP_RE = /\d+(?:[.,:/-]\d+)*/g;

/** Cheap token estimate. Chinese ~0.6 token/char, English ~1.3 token/word. */
export function estimateTokens(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  const cjk = (s.match(CJK_RE) || []).length;
  const latin = (s.match(LATIN_WORD_RE) || []).length;
  const digits = (s.match(DIGIT_GROUP_RE) || []).length;
  const punctuation = (s.match(/[^\s\p{L}\p{N}]/gu) || []).length;
  const whitespace = (s.match(/\s+/g) || []).length;
  return Math.max(0, Math.ceil(cjk * 0.6 + latin * 1.3 + digits * 0.7 + punctuation * 0.35 + whitespace * 0.05));
}

export const BLOCK_PRIORITIES = Object.freeze({
  fixed: 0,
  core: 1,
  history: 2,
  retrieval: 3,
  brain: 4,
  optional: 5,
});

/** Segment a built prompt by its 【...】 headings, for baseline accounting. */
export function segmentPromptBlocks(text) {
  const s = String(text ?? '');
  const matches = [...s.matchAll(/【([^】]{1,40})】/g)];
  if (!matches.length) return [{ name: 'all', text: s, tokens: estimateTokens(s) }];
  const out = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? s.length) : s.length;
    const body = s.slice(start, end);
    const name = matches[i][1].trim().slice(0, 24);
    out.push({ name, text: body, tokens: estimateTokens(body) });
  }
  return out;
}

export function makeBlock(name, text, { priority = 'optional', maxTokens = 0, compressible = true, fixed = false } = {}) {
  const body = String(text ?? '');
  const tokens = estimateTokens(body);
  return {
    name: String(name || 'block'),
    text: body,
    tokens,
    priority: fixed ? BLOCK_PRIORITIES.fixed : (BLOCK_PRIORITIES[priority] ?? BLOCK_PRIORITIES.optional),
    maxTokens: Number(maxTokens) || 0,
    compressible: fixed ? false : compressible !== false,
    fixed: Boolean(fixed),
  };
}

function trimToTokens(text, maxTokens) {
  if (!maxTokens || estimateTokens(text) <= maxTokens) return text;
  // Extract-ish fallback: keep sentence-ish beginnings; never used for fixed blocks.
  let out = '';
  for (const part of String(text).split(/(?<=[。！？；\n])/u)) {
    if (estimateTokens(out + part) > maxTokens) break;
    out += part;
  }
  return out || String(text).slice(0, Math.max(40, Math.floor(maxTokens * 0.8)));
}

/**
 * MP-1 shadow/assemble. In shadow mode the returned text is the original
 * concatenation; stats explain what *would* be cut.
 */
export function assembleContext({ blocks = [], budget = null, shadow = true, now = Date.now() } = {}) {
  const cfg = { ...DEFAULT_MEMORY_V4_CONFIG.budget, ...(budget || {}) };
  const total = Math.max(1000, Number(cfg.totalTokens) || 12000);
  const normalized = blocks.map((b) => (b && b.name ? b : makeBlock(String(b?.name || 'block'), String(b?.text || ''))));
  const fixed = normalized.filter((b) => b.fixed || b.priority === 0);
  const rest = normalized.filter((b) => !(b.fixed || b.priority === 0));
  const fixedTokens = fixed.reduce((n, b) => n + b.tokens, 0);
  let left = Math.max(0, total - fixedTokens);
  const kept = [];
  const dropped = [];
  const truncated = [];
  for (const b of rest.sort((a, b2) => a.priority - b2.priority)) {
    let text = b.text;
    let tokens = b.tokens;
    if (b.maxTokens > 0 && tokens > b.maxTokens) {
      text = trimToTokens(text, b.maxTokens);
      tokens = estimateTokens(text);
      truncated.push({ name: b.name, from: b.tokens, to: tokens, reason: 'block-max' });
    }
    if (tokens <= left) {
      kept.push({ ...b, text, tokens });
      left -= tokens;
    } else if (b.compressible) {
      const cut = trimToTokens(text, Math.max(0, left));
      if (cut) {
        const cutTokens = estimateTokens(cut);
        kept.push({ ...b, text: cut, tokens: cutTokens });
        truncated.push({ name: b.name, from: b.tokens, to: cutTokens, reason: 'total-budget' });
        left -= cutTokens;
      } else {
        dropped.push({ name: b.name, tokens, reason: 'no-budget' });
      }
    } else {
      dropped.push({ name: b.name, tokens, reason: 'not-compressible' });
    }
  }
  const ordered = [...fixed, ...kept].sort((a, b2) => normalized.indexOf(a) - normalized.indexOf(b2));
  const originalText = normalized.map((b) => b.text).join('');
  const outputText = ordered.map((b) => b.text).join('');
  return {
    at: new Date(now).toISOString(),
    shadow: shadow !== false,
    budgetTokens: total,
    fixedTokens,
    keptTokens: fixedTokens + kept.reduce((n, b) => n + b.tokens, 0),
    originalTokens: normalized.reduce((n, b) => n + b.tokens, 0),
    blocks: ordered.map((b) => ({ name: b.name, tokens: b.tokens, priority: b.priority, fixed: b.fixed })),
    dropped,
    truncated,
    text: shadow === false ? outputText : originalText,
  };
}

/** Record one wake prompt into a bounded rolling JSON file (MP-0). */
export function recordContextBudget({ dir, key = '', reason = '', text = '', now = Date.now(), maxSamples = 300, assembly = null } = {}) {
  if (!dir) return null;
  const file = path.join(dir, 'context-budget.json');
  const blocks = segmentPromptBlocks(text);
  const tokens = blocks.reduce((n, b) => n + b.tokens, 0);
  let prev = { version: MEMORY_V4_VERSION, updatedAt: null, samples: [] };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.samples)) prev = parsed;
  } catch {}
  const sample = {
    at: new Date(now).toISOString(),
    key: String(key || ''),
    reason: String(reason || ''),
    chars: String(text || '').length,
    tokens,
    blocks: blocks.map((b) => ({ name: b.name, tokens: b.tokens, chars: b.text.length })),
    ...(assembly ? {
      budget: {
        shadow: assembly.shadow !== false,
        budgetTokens: assembly.budgetTokens,
        originalTokens: assembly.originalTokens,
        keptTokens: assembly.keptTokens,
        dropped: assembly.dropped,
        truncated: assembly.truncated,
      },
    } : {}),
  };
  prev.version = MEMORY_V4_VERSION;
  prev.updatedAt = sample.at;
  prev.last = sample;
  prev.samples = [...(prev.samples || []), sample].slice(-Math.max(10, Number(maxSamples) || 300));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(prev, null, 2) + '\n', 'utf8');
  return sample;
}
