// Unified Oasis body events: append-only, local, never deleted by time.
// This is the raw layer; Memory v3 ingests semantic summaries/episodes from it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const BODY_IDS = Object.freeze(['qq', 'bili', 'pet', 'inner']);
export const BODY_EVENT_TYPES = Object.freeze([
  'desktop.focus', 'desktop.typing_start', 'desktop.typing_progress', 'desktop.typing_end', 'desktop.away', 'desktop.return',
  'desktop.sensitive_skip', 'pet.approach', 'pet.look', 'pet.walk', 'pet.bubble', 'pet.voice',
  'pet.user_touch', 'pet.presence', 'pet.command', 'attention.switch', 'body.status',
]);

export function resolveBodyDir({ dataDir = '', characterId = 'default' } = {}) {
  const base = String(dataDir || '').trim();
  if (!base) return '';
  return path.join(base, 'characters', String(characterId || 'default'), 'body');
}

export function createBodyEventStore({ dir } = {}) {
  const root = path.resolve(String(dir || '.'));
  const eventFile = path.join(root, 'events.jsonl');
  const pendingFile = path.join(root, 'pending.json');
  const attentionFile = path.join(root, 'attention.json');
  fs.mkdirSync(root, { recursive: true });

  function normalize(input = {}) {
    const at = Number(input.at) || Date.now();
    return {
      id: String(input.id || 'be_' + crypto.randomBytes(8).toString('hex')),
      at,
      body: BODY_IDS.includes(String(input.body)) ? String(input.body) : 'pet',
      type: String(input.type || 'body.status').slice(0, 80),
      durationMs: Math.max(0, Number(input.durationMs) || 0),
      correlationId: String(input.correlationId || ''),
      context: input.context && typeof input.context === 'object' ? input.context : {},
      privacy: String(input.privacy || 'private'),
      scope: String(input.scope || 'pet'),
      memory: input.memory && typeof input.memory === 'object' ? input.memory : {},
      text: String(input.text || '').slice(0, 1000),
      atIso: new Date(at).toISOString(),
    };
  }

  function append(input) {
    const event = normalize(input);
    fs.appendFileSync(eventFile, JSON.stringify(event) + String.fromCharCode(10), 'utf8');
    return event;
  }

  function list(limit = 100) {
    try {
      const lines = fs.readFileSync(eventFile, 'utf8').split(String.fromCharCode(10)).filter(Boolean).slice(-Math.max(1, Number(limit) || 100));
      return lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  function pending() {
    try { return JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch { return []; }
  }
  function savePending(items) {
    const tmp = pendingFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Array.isArray(items) ? items.slice(-40) : [], null, 2) + String.fromCharCode(10), 'utf8');
    fs.renameSync(tmp, pendingFile);
  }
  function addPending(item) {
    const items = pending().filter((x) => x && x.id !== item.id);
    items.push({ ...item, createdAt: Number(item.createdAt) || Date.now(), expiresAt: Number(item.expiresAt) || Date.now() + 24 * 3600_000 });
    savePending(items.filter((x) => Number(x.expiresAt) > Date.now()));
    return items;
  }
  function resolvePending(id) {
    const items = pending();
    const next = items.filter((x) => String(x.id) !== String(id));
    savePending(next.filter((x) => Number(x.expiresAt) > Date.now()));
    return items.find((x) => String(x.id) === String(id)) || null;
  }
  function attention() {
    try { return JSON.parse(fs.readFileSync(attentionFile, 'utf8')); } catch { return { body: 'qq', reason: 'startup', at: Date.now() }; }
  }
  function saveAttention(state) {
    const tmp = attentionFile + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ ...state, at: Number(state?.at) || Date.now() }, null, 2) + String.fromCharCode(10), 'utf8');
    fs.renameSync(tmp, attentionFile);
  }

  return {
    root, eventFile, pendingFile, attentionFile,
    append, list, pending, savePending, addPending, resolvePending, attention, saveAttention,
  };
}
