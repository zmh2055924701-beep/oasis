// 身份内核（P1）：所有身体共享的实时身份/事件/记忆快照。
// 单一写者：桥接进程写入；插件/桌宠/B站通过桥接 HTTP 写入；文件在 D 盘。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { atomicWriteJson, readJsonSafe } from './brain/events.js';
import { iso } from './brain/schema.js';

export const IDENTITY_VERSION = 1;
export const DEFAULT_IDENTITY_CONFIG = Object.freeze({
  enabled: true,
  dataDir: 'state/identity',
  maxEvents: 20000,
  recentLimit: 80,
  promptEvents: 14,
});

export function resolveIdentityPaths({ dataDir, characterId } = {}) {
  const root = String(dataDir || process.env.OASIS_IDENTITY_DIR || DEFAULT_IDENTITY_CONFIG.dataDir).trim()
    || DEFAULT_IDENTITY_CONFIG.dataDir;
  const id = String(characterId || 'default').replace(/[^\w.-]/g, '_').slice(0, 80);
  const dir = path.join(root, id);
  return {
    dir,
    state: path.join(dir, 'identity-state.json'),
    events: path.join(dir, 'identity-events.jsonl'),
    context: path.join(dir, 'identity-context.md'),
  };
}

function emptyState(characterId) {
  const now = iso();
  return {
    version: IDENTITY_VERSION,
    characterId: String(characterId || 'default'),
    createdAt: now,
    updatedAt: now,
    seq: 0,
    bodies: {},
    recentEvents: [],
    claims: {},
  };
}

export function loadIdentityState({ dataDir, characterId } = {}) {
  const paths = resolveIdentityPaths({ dataDir, characterId });
  const raw = readJsonSafe(paths.state, null);
  if (!raw || typeof raw !== 'object') return { paths, state: emptyState(characterId) };
  const state = {
    ...emptyState(characterId),
    ...raw,
    seq: Number(raw.seq) || 0,
    bodies: raw.bodies && typeof raw.bodies === 'object' ? raw.bodies : {},
    recentEvents: Array.isArray(raw.recentEvents) ? raw.recentEvents.slice(-DEFAULT_IDENTITY_CONFIG.recentLimit) : [],
    claims: raw.claims && typeof raw.claims === 'object' ? raw.claims : {},
  };
  return { paths, state };
}

function saveState(paths, state) {
  fs.mkdirSync(paths.dir, { recursive: true });
  atomicWriteJson(paths.state, state);
}

function appendJsonLine(paths, event, maxEvents = DEFAULT_IDENTITY_CONFIG.maxEvents) {
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.appendFileSync(paths.events, JSON.stringify(event) + '\n', 'utf8');
  try {
    const stat = fs.statSync(paths.events);
    if (stat.size > Math.max(4 * 1024 * 1024, Number(maxEvents) * 400)) {
      const lines = fs.readFileSync(paths.events, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(paths.events, lines.slice(-Math.max(100, Number(maxEvents) || 20000)).join('\n') + '\n', 'utf8');
    }
  } catch {}
}

function clockOf(at) {
  try {
    const d = new Date(String(at || ''));
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  } catch { return ''; }
}

function visibilityFor(body = '') {
  const s = String(body || '');
  if (s.startsWith('group:')) return 'group';
  if (s.startsWith('private:')) return 'private';
  if (s.startsWith('pet')) return 'pet';
  if (s.startsWith('bili')) return 'public';
  if (s.startsWith('desktop')) return 'private';
  return 'system';
}

export function identityEventAllowed(event, audience = 'system') {
  if (!event) return false;
  const v = String(event.visibility || 'system');
  if (v === 'system' || v === 'public') return true;
  if (audience === 'private') return true; // 主人私聊可以看到自己的全部身体
  if (audience === 'pet') return v === 'pet' || v === 'private';
  if (audience === 'group') return v === 'group'; // 群聊只拿 group/public/system，不拿私聊/桌宠（system/public 已在上方放行）
  if (audience === 'bili') return v === 'public' || v === 'system';
  return false;
}

export function appendIdentityEvent({
  dataDir, characterId, body = 'system', actor = 'system', type = 'observe',
  text = '', visibility = '', payload = null, risk = 0, correlationId = '', causationId = '',
  approvalId = null, now = Date.now(), maxEvents,
} = {}) {
  const { paths, state } = loadIdentityState({ dataDir, characterId });
  const seq = state.seq + 1;
  const event = {
    eventId: 'id-' + seq.toString(36) + '-' + crypto.randomBytes(3).toString('hex'),
    seq,
    at: iso(now),
    body: String(body || 'system').slice(0, 80),
    actor: String(actor || 'system').slice(0, 40),
    type: String(type || 'observe').slice(0, 40),
    visibility: visibility || visibilityFor(body),
    text: String(text ?? '').slice(0, 2000),
    payload: payload && typeof payload === 'object' ? payload : null,
    risk: Math.max(0, Math.min(3, Number(risk) || 0)),
    correlationId: String(correlationId || '').slice(0, 80),
    causationId: String(causationId || '').slice(0, 80),
    approvalId: approvalId ? String(approvalId).slice(0, 80) : null,
  };
  appendJsonLine(paths, event, Number(maxEvents) || DEFAULT_IDENTITY_CONFIG.maxEvents);
  state.seq = seq;
  state.updatedAt = iso(now);
  state.bodies[event.body] = {
    ...(state.bodies[event.body] || {}),
    lastAt: event.at,
    lastType: event.type,
    lastText: event.text.slice(0, 120),
  };
  state.recentEvents = [...state.recentEvents, event].slice(-DEFAULT_IDENTITY_CONFIG.recentLimit);
  saveState(paths, state);
  return { event, state };
}

export function readIdentityEvents({ dataDir, characterId, limit = 20 } = {}) {
  const { state } = loadIdentityState({ dataDir, characterId });
  return state.recentEvents.slice(-Math.max(1, Number(limit) || 20));
}

export function identityClaim({ dataDir, characterId, name = 'purpose', owner = '', ttlMs = 5 * 60 * 1000, now = Date.now() } = {}) {
  const { paths, state } = loadIdentityState({ dataDir, characterId });
  const claims = { ...(state.claims || {}) };
  const existing = claims[name];
  if (existing && Number(existing.until) > now) return { ok: false, holder: existing.owner, until: existing.until };
  claims[name] = { owner: String(owner), at: now, until: now + Math.max(1000, Number(ttlMs) || 300000) };
  state.claims = claims;
  saveState(paths, state);
  return { ok: true, until: claims[name].until };
}

export function identityRelease({ dataDir, characterId, name = 'purpose' } = {}) {
  const { paths, state } = loadIdentityState({ dataDir, characterId });
  if (state.claims && state.claims[name]) {
    delete state.claims[name];
    saveState(paths, state);
  }
}

export function buildIdentityPromptBlock({ dataDir, characterId, audience = 'private', limit = DEFAULT_IDENTITY_CONFIG.promptEvents } = {}) {
  const { state } = loadIdentityState({ dataDir, characterId });
  const events = state.recentEvents.filter((e) => identityEventAllowed(e, audience)).slice(-Math.max(1, Number(limit) || 14));
  if (!events.length) return '';
  const lines = ['【实时身份 · 所有身体共享（内部参考）】'];
  lines.push('这些是同一个你最近在 QQ / B站 / 桌宠 / 电脑上看到或做过的事；不是当前窗口观众刚发的消息。不要逐字复述私聊/桌宠内容到群聊。');
  for (const e of events) {
    const t = clockOf(e.at);
    const who = e.actor === 'owner' ? '主人' : e.actor === 'self' ? '我' : (e.actor || '系统');
    const bodyLabel = String(e.body || '').startsWith('group:') ? '群' : String(e.body || '').startsWith('private:') ? '私聊' : String(e.body || '').startsWith('pet') ? '桌宠' : String(e.body || '').startsWith('bili') ? 'B站' : String(e.body || '').startsWith('desktop') ? '电脑' : '系统';
    lines.push('- [' + t + '][' + bodyLabel + '] ' + who + '：' + String(e.text || e.type).slice(0, 160));
  }
  lines.push('');
  return lines.join('\n') + '\n';
}

export function identitySnapshot({ dataDir, characterId } = {}) {
  const { state } = loadIdentityState({ dataDir, characterId });
  return {
    version: state.version,
    characterId: state.characterId,
    updatedAt: state.updatedAt,
    seq: state.seq,
    bodies: state.bodies,
    recent: state.recentEvents.slice(-30),
    claims: state.claims,
  };
}
