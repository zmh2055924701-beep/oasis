// 电脑操作体 · 一次性审批挑战（P2）。
// 授权只覆盖一个 actionHash；动作内容变化/过期/重放/非主人回复全部拒绝。
import crypto from 'node:crypto';
import { actionHash, normalizeAction } from './policy.js';

const DEFAULT_TTL_MS = 120000;

export function createApprovalChallenge({ action, now = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  const normalized = normalizeAction(action);
  if (!normalized.ok) return { ok: false, error: normalized.error, forbidden: normalized.forbidden === true };
  const a = normalized.action;
  const actionId = 'act-' + now.toString(36) + '-' + crypto.randomBytes(4).toString('hex');
  const code = crypto.randomBytes(2).toString('hex').toUpperCase();
  return {
    ok: true,
    challenge: {
      actionId,
      code,
      actionHash: actionHash(a),
      action: a,
      createdAt: now,
      expiresAt: now + Math.max(10000, Number(ttlMs) || DEFAULT_TTL_MS),
      status: 'pending',
      approvedAt: null,
      deniedAt: null,
      usedAt: null,
    },
  };
}

export function parseApprovalReply(text = '') {
  const s = String(text ?? '').trim();
  const m = s.match(/^(?:我)?(允许|同意|批准|拒绝|不同意|不允许)\s*[:：]?\s*([A-Fa-f0-9]{4,12})\s*$/);
  if (!m) return null;
  const kind = m[1];
  return { approve: ['允许', '同意', '批准'].includes(kind), code: m[2].toUpperCase() };
}

export function verifyApprovalReply({ challenge, text = '', fromQQ = '', ownerQQ = '', now = Date.now() } = {}) {
  if (!challenge) return { ok: false, status: 'missing', error: '没有待审批动作' };
  if (String(fromQQ) !== String(ownerQQ)) return { ok: false, status: 'forbidden', error: '只有主人可以审批' };
  const parsed = parseApprovalReply(text);
  if (!parsed) return { ok: false, status: 'ignored', error: '不是审批回复' };
  if (parsed.code !== challenge.code) return { ok: false, status: 'wrong-code', error: '审批短码不匹配' };
  if (challenge.status !== 'pending') return { ok: false, status: challenge.status, error: '这个审批已经处理过了' };
  if (now > challenge.expiresAt) return { ok: false, status: 'expired', error: '审批已过期' };
  if (parsed.approve) return { ok: true, status: 'approved', challenge: { ...challenge, status: 'approved', approvedAt: now } };
  return { ok: true, status: 'denied', challenge: { ...challenge, status: 'denied', deniedAt: now } };
}

export function markApprovalUsed(challenge, now = Date.now()) {
  if (!challenge) return null;
  if (challenge.status !== 'approved' || challenge.usedAt) return challenge;
  return { ...challenge, status: 'used', usedAt: now };
}

export function isExpired(challenge, now = Date.now()) {
  return !challenge || challenge.status === 'pending' && now > challenge.expiresAt;
}
