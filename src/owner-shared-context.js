// 私聊 → 家庭群 Owner Shared Context（P1：规则提取 + FULL 注入 + 家庭群白名单）
// 数据独立于人格/记忆卡，不把私聊原文写进记忆；只给家庭群 prompt 内部参考。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveIdentityPaths } from './identity-core.js';

export const DEFAULT_OWNER_SHARE = Object.freeze({
  enabled: true,
  mode: 'full', // family only
  familyGroups: [],
  maxPrivateMessages: 8,
  maxFacts: 4,
  ttlMinutes: 180,
  privateWindowMinutes: 360,
});

function fileOf({ dataDir, characterId }) {
  const paths = resolveIdentityPaths({ dataDir, characterId });
  return path.join(paths.dir, 'owner-shared.json');
}
function readStore(options) {
  try {
    const raw = fs.readFileSync(fileOf(options), 'utf8');
    const obj = JSON.parse(raw);
    return {
      version: 1,
      recentPrivate: Array.isArray(obj.recentPrivate) ? obj.recentPrivate : [],
      facts: Array.isArray(obj.facts) ? obj.facts : [],
    };
  } catch {
    return { version: 1, recentPrivate: [], facts: [] };
  }
}
function writeStore(options, store) {
  const file = fileOf(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify({ ...store, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function localTime(at) {
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(at));
  } catch { return ''; }
}
function redact(text) {
  return String(text || '')
    .replace(/(密码|验证码|身份证|银行卡|住址|地址|工资|token|secret)\s*[:：]?\s*\S+/gi, '$1：***')
    .slice(0, 500);
}
function isSensitive(text) {
  return /(密码|验证码|身份证|银行卡|住址|家庭地址|工资|token|secret|私钥)/i.test(String(text || ''));
}
function classify(text) {
  const s = String(text || '');
  const kinds = [];
  if (/(健身|锻炼|运动|跑步|练完|撸铁)/.test(s)) kinds.push('activity');
  if (/(吃饭|晚饭|午饭|早饭|食堂|做饭|外卖|下厨|吃啥|吃什么)/.test(s)) kinds.push('food');
  if (/(回家|下班|加班|上班|到公司|出门)/.test(s)) kinds.push('schedule');
  if (/(睡觉|睡了|休息|困)/.test(s)) kinds.push('rest');
  if (/(电影|游戏|学习|看书|逛街|买菜)/.test(s)) kinds.push('activity');
  return kinds.length ? [...new Set(kinds)] : ['note'];
}
function ttlFor(kinds, baseMinutes) {
  const base = Math.max(30, Number(baseMinutes) || 180);
  if (kinds.includes('rest')) return base * 2;
  if (kinds.includes('food')) return Math.min(base, 120);
  return base;
}
function factId(sourceEventId, text) {
  return 'fact-' + crypto.createHash('sha1').update(String(sourceEventId || '') + '|' + String(text || '')).digest('hex').slice(0, 12);
}
function factSummary(text) {
  const raw = String(text || '').trim();
  return raw.length > 220 ? raw.slice(0, 219) + '…' : raw;
}
export function extractOwnerFacts({ text, at = Date.now(), sourceEventId = '' } = {}) {
  const raw = String(text || '').trim();
  if (!raw || raw.length < 2) return [];
  if (isSensitive(raw)) return [];
  const kinds = classify(raw);
  const ttlMinutes = ttlFor(kinds, DEFAULT_OWNER_SHARE.ttlMinutes);
  const cancel = /(不去|不去了|取消|改主意|算了不|不练了|不吃了)/.test(raw);
  return [{
    id: factId(sourceEventId, raw),
    kind: kinds.includes('activity') ? 'activity' : kinds.includes('food') ? 'food' : kinds.includes('schedule') ? 'schedule' : kinds.includes('rest') ? 'rest' : 'note',
    kinds,
    summary: factSummary(raw),
    subject: 'owner',
    startAt: new Date(at).toISOString(),
    validUntil: new Date(at + ttlMinutes * 60000).toISOString(),
    sourceEventId: String(sourceEventId || ''),
    status: cancel ? 'cancelled' : 'active',
    sensitivity: 'safe',
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
  }];
}
function mergeFacts(facts, incoming) {
  const next = Array.isArray(facts) ? facts.slice() : [];
  for (const f of incoming || []) {
    if (!f || !f.id) continue;
    const idx = next.findIndex((x) => x.id === f.id);
    if (idx >= 0) next[idx] = { ...next[idx], ...f };
    else next.push(f);
  }
  return next.slice(-80);
}
function prune(store, now, config) {
  const windowMs = (Number(config?.privateWindowMinutes) || DEFAULT_OWNER_SHARE.privateWindowMinutes) * 60000;
  const recent = (store.recentPrivate || []).filter((m) => now - Date.parse(m.at) < windowMs).slice(-(Number(config?.maxPrivateMessages) || 8));
  const facts = (store.facts || []).filter((f) => {
    if (f.status === 'cancelled') return false;
    const until = Date.parse(f.validUntil);
    return Number.isFinite(until) ? until > now : true;
  }).slice(-80);
  store.recentPrivate = recent;
  store.facts = facts;
}

export function ingestOwnerPrivate({ dataDir, characterId, text, key = '', now = Date.now(), sourceEventId = '', config = DEFAULT_OWNER_SHARE } = {}) {
  if (config?.enabled === false) return { ok: false, reason: 'disabled' };
  if (!String(key || '').startsWith('private:')) return { ok: false, reason: 'not-private' };
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, reason: 'empty' };
  const store = readStore({ dataDir, characterId });
  prune(store, now, config);
  const safeText = isSensitive(raw) ? '[敏感私聊，未共享]' : redact(raw);
  store.recentPrivate.push({ at: new Date(now).toISOString(), text: safeText, eventId: String(sourceEventId || '') });
  const facts = extractOwnerFacts({ text: raw, at: now, sourceEventId });
  // 取消类消息要覆盖同话题旧 fact
  if (facts.some((f) => f.status === 'cancelled')) {
    for (const f of store.facts) f.status = 'cancelled';
  }
  store.facts = mergeFacts(store.facts, facts);
  prune(store, now, config);
  writeStore({ dataDir, characterId }, store);
  return { ok: true, facts: facts.length, recentPrivate: store.recentPrivate.length };
}

export function ingestOwnerFacts({ dataDir, characterId, facts = [], now = Date.now(), config = DEFAULT_OWNER_SHARE } = {}) {
  const store = readStore({ dataDir, characterId });
  prune(store, now, config);
  store.facts = mergeFacts(store.facts, facts);
  prune(store, now, config);
  writeStore({ dataDir, characterId }, store);
  return { ok: true, facts: store.facts.length };
}

export function ownerShareEnabledForGroup(groupKey, config = DEFAULT_OWNER_SHARE) {
  if (!config || config.enabled === false) return false;
  if (config.mode !== 'full' && config.mode !== 'safe') return false;
  const m = String(groupKey || '').match(/^group:(\d+)$/);
  if (!m) return false;
  const groups = (Array.isArray(config.familyGroups) ? config.familyGroups : []).map(String);
  return groups.includes(m[1]);
}

export function buildOwnerSharedBlock({ dataDir, characterId, groupKey, now = Date.now(), config = DEFAULT_OWNER_SHARE } = {}) {
  if (!ownerShareEnabledForGroup(groupKey, config)) return '';
  const store = readStore({ dataDir, characterId });
  prune(store, now, config);
  const hasPrivate = store.recentPrivate.length > 0;
  const facts = (store.facts || []).filter((f) => f.status === 'active' && Date.parse(f.validUntil) > now).slice(-(Number(config.maxFacts) || 4));
  if (!hasPrivate && !facts.length) return '';
  const lines = ['【主人私聊状态（家庭群内部参考 · FULL）】'];
  lines.push('这些是主人在私聊里最近自己说的话，只有这个家庭群可以看到；不要逐字复述，不要暴露敏感信息，只在自然的时候用来关心他。');
  if (hasPrivate) {
    lines.push('最近私聊：');
    for (const m of store.recentPrivate.slice(-(Number(config.maxPrivateMessages) || 8))) lines.push('- [' + localTime(m.at) + '] 主人：' + redact(m.text).slice(0, 220));
  }
  if (facts.length) {
    lines.push('可参考的状态：');
    for (const f of facts) lines.push('- [' + localTime(f.startAt) + '] ' + String(f.summary || '').slice(0, 220) + '（有效至 ' + localTime(f.validUntil) + '）');
  }
  lines.push('如果当前群话题和这些状态相关（例如饭点、健身、回家），可以自然关心一句；不要写成“根据私聊记录”，也不要暴露其他群/其他人的私聊。');
  return lines.join('\n') + '\n\n';
}

export function ownerShareSnapshot({ dataDir, characterId, now = Date.now(), config = DEFAULT_OWNER_SHARE } = {}) {
  const store = readStore({ dataDir, characterId });
  prune(store, now, config);
  return { enabled: config.enabled !== false, mode: config.mode, familyGroups: config.familyGroups, recentPrivate: store.recentPrivate, facts: store.facts };
}