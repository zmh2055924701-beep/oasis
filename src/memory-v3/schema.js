// Memory v3 schema: dialog/video episodic memory + semantic facts + daily reflection.
// Derived layer only; never writes persona/character/memory-card/full archive.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const MEMORY_V3_VERSION = 1;
export const SCOPES = Object.freeze(['private', 'shared', 'bili-public', 'pet', 'inner']);
export const DEFAULT_SCOPE = 'shared';

export function dshHome() {
  return process.env.DSH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.dsh');
}
export function resolveMemoryV3Dir({ dir, characterId = 'default' } = {}) {
  if (dir) return path.resolve(dir);
  return path.join(dshHome(), 'oasis', 'characters', String(characterId || 'default'), 'memory-v3');
}
export function iso(now = Date.now()) { return new Date(Number(now) || Date.now()).toISOString(); }
export function dayKey(now = Date.now()) {
  return new Date(Number(now) || Date.now()).toLocaleDateString('sv-SE');
}
export function hashId(input) {
  return crypto.createHash('sha1').update(String(input ?? '')).digest('hex').slice(0, 16);
}
export function clip(text, max = 500) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '...' : s;
}
export function normalizeScope(scope, fallback = DEFAULT_SCOPE) {
  return SCOPES.includes(String(scope)) ? String(scope) : fallback;
}
export function scopeOfInbox(ev = {}) {
  const platform = String(ev.platform || 'qq');
  if (platform === 'pet') return 'pet';
  if (platform === 'bili') return 'bili-public';
  if (ev.private === true || String(ev.kind || '') === 'private') return 'private';
  return 'shared';
}
export function salienceOf(text = '', ev = {}) {
  const s = String(text ?? '');
  let score = 0.2;
  if (ev.isOwner) score += 0.25;
  if (ev.private) score += 0.12;
  if (ev.direct) score += 0.1;
  if (s.length >= 20) score += 0.08;
  if (s.length >= 80) score += 0.08;
  if (/喜欢|爱|讨厌|难过|开心|生气|担心|怕|想|承诺|答应|约定|以后|明天|永远|分手|吵架|抱抱|亲亲/.test(s)) score += 0.18;
  if (/[?？]|吗|呢|怎么|为什么/.test(s)) score += 0.05;
  return Math.max(0, Math.min(1, Math.round(score * 100) / 100));
}
export function simpleEmotion(text = '') {
  const s = String(text ?? '');
  if (/难过|哭|委屈|伤心|失望|孤独|寂寞|怕/.test(s)) return 'sad';
  if (/生气|烦|讨厌|气死|凶/.test(s)) return 'angry';
  if (/开心|高兴|喜欢|爱|可爱|笑|嘿嘿|哈哈/.test(s)) return 'happy';
  if (/担心|焦虑|紧张|不安|害怕/.test(s)) return 'anxious';
  if (/累|困|饿|冷|热|疼|不舒服/.test(s)) return 'tired';
  return 'neutral';
}
export function makeEvent(ev = {}, now = Date.now()) {
  const at = ev.at ? Date.parse(String(ev.at)) : Number(ev.atMs) || now;
  const text = clip(ev.text || ev.plain || '', 800);
  const key = String(ev.conversationKey || ev.platform || '');
  return {
    id: ev.id || 'ev-' + hashId(key + '|' + at + '|' + text + '|' + String(ev.senderId || '')),
    at,
    day: dayKey(at),
    body: String(ev.platform || 'qq'),
    scope: normalizeScope(ev.scope || scopeOfInbox(ev)),
    kind: String(ev.kind || 'message'),
    actor: String(ev.sender || '').slice(0, 60),
    actorId: String(ev.senderId || ''),
    isOwner: ev.isOwner === true,
    isSelf: ev.isSelf === true,
    conversationKey: String(ev.conversationKey || ''),
    text,
    summary: clip(ev.summary || text, 240),
    salience: Number(ev.salience) || salienceOf(text, ev),
    emotion: String(ev.emotion || simpleEmotion(text)),
    sourceRef: String(ev.sourceRef || ev.id || ''),
    systemImportance: Math.max(0, Math.min(1, Number(ev.systemImportance ?? ev.importance) || 0.3)),
    selfImportance: Math.max(0, Math.min(1, Number(ev.selfImportance) || 0)),
    clarity: String(ev.clarity || 'clear'),
    rehearsalCount: Number(ev.rehearsalCount) || 0,
    lastRecalledAt: Number(ev.lastRecalledAt) || 0,
    privacy: ev.private === true || ev.scope === 'private' ? 'private' : 'public',
  };
}
export function normalizeEpisode(raw = {}) {
  return {
    id: String(raw.id || 'ep-' + hashId(raw.summary || raw.topic || Date.now())),
    version: MEMORY_V3_VERSION,
    startedAt: Number(raw.startedAt) || Date.now(),
    endedAt: Number(raw.endedAt) || Number(raw.startedAt) || Date.now(),
    day: String(raw.day || dayKey(raw.startedAt)),
    body: String(raw.body || 'qq'),
    scope: normalizeScope(raw.scope),
    participants: Array.isArray(raw.participants) ? raw.participants.slice(0, 12) : [],
    topic: clip(raw.topic || '', 80),
    summary: clip(raw.summary || '', 600),
    emotionalArc: clip(raw.emotionalArc || '', 200),
    unresolved: Array.isArray(raw.unresolved) ? raw.unresolved.slice(0, 8) : [],
    sourceEventIds: Array.isArray(raw.sourceEventIds) ? raw.sourceEventIds.slice(0, 80) : [],
    importance: Math.max(0, Math.min(1, Number(raw.importance) || 0.3)),
    systemImportance: Math.max(0, Math.min(1, Number(raw.systemImportance ?? raw.importance) || 0.3)),
    selfImportance: Math.max(0, Math.min(1, Number(raw.selfImportance) || 0)),
    relationalImportance: Math.max(0, Math.min(1, Number(raw.relationalImportance) || 0)),
    selfImportanceReason: clip(raw.selfImportanceReason || '', 300),
    judgedBy: String(raw.judgedBy || 'heuristic'),
    judgedAt: Number(raw.judgedAt) || 0,
    clarity: String(raw.clarity || 'clear'),
    rehearsalCount: Number(raw.rehearsalCount) || 0,
    lastRecalledAt: Number(raw.lastRecalledAt) || 0,
    embeddingId: String(raw.embeddingId || ''),
  };
}
export function normalizeMedia(raw = {}) {
  return {
    id: String(raw.id || 'media-' + hashId(raw.bvid || raw.title || Date.now())),
    version: MEMORY_V3_VERSION,
    bvid: String(raw.bvid || ''),
    title: clip(raw.title || '', 200),
    up: clip(raw.up || '', 80),
    duration: Number(raw.duration) || 0,
    watchedAt: Number(raw.watchedAt) || Date.now(),
    day: String(raw.day || dayKey(raw.watchedAt)),
    mode: String(raw.mode || ''),
    frames: raw.frames === true,
    sheet: String(raw.sheet || ''),
    subs: String(raw.subs || ''),
    whyWatched: clip(raw.whyWatched || '', 300),
    summary: clip(raw.summary || '', 600),
    reaction: clip(raw.reaction || '', 300),
    chapters: Array.isArray(raw.chapters) ? raw.chapters.slice(0, 24) : [],
    keyFrames: Array.isArray(raw.keyFrames) ? raw.keyFrames.slice(0, 12) : [],
    quotes: Array.isArray(raw.quotes) ? raw.quotes.slice(0, 12) : [],
    danmakuThemes: Array.isArray(raw.danmakuThemes) ? raw.danmakuThemes.slice(0, 12) : [],
    linkedEpisodeIds: Array.isArray(raw.linkedEpisodeIds) ? raw.linkedEpisodeIds.slice(0, 12) : [],
    tasteTags: Array.isArray(raw.tasteTags) ? raw.tasteTags.slice(0, 12) : [],
    scope: normalizeScope(raw.scope, 'bili-public'),
    systemImportance: Math.max(0, Math.min(1, Number(raw.systemImportance ?? raw.importance) || 0.3)),
    selfImportance: Math.max(0, Math.min(1, Number(raw.selfImportance) || 0)),
    clarity: String(raw.clarity || 'clear'),
    rehearsalCount: Number(raw.rehearsalCount) || 0,
    lastRecalledAt: Number(raw.lastRecalledAt) || 0,
    embeddingId: String(raw.embeddingId || ''),
  };
}
export function normalizeFact(raw = {}) {
  return {
    id: String(raw.id || 'fact-' + hashId(String(raw.subject || '') + '|' + String(raw.predicate || '') + '|' + String(raw.object || ''))),
    version: MEMORY_V3_VERSION,
    subject: clip(raw.subject || '', 80),
    predicate: clip(raw.predicate || '', 80),
    object: clip(raw.object || '', 200),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0.5)),
    validFrom: Number(raw.validFrom) || Date.now(),
    validTo: Number(raw.validTo) || 0,
    sourceEventIds: Array.isArray(raw.sourceEventIds) ? raw.sourceEventIds.slice(0, 20) : [],
    scope: normalizeScope(raw.scope),
    lastSeenAt: Number(raw.lastSeenAt) || Date.now(),
  };
}
export function createEmptySelfModel(characterId = '') {
  return {
    version: MEMORY_V3_VERSION,
    characterId,
    updatedAt: iso(),
    values: [],
    commitments: [],
    relationships: [],
    narrative: [],
    lastReflectionAt: '',
  };
}
