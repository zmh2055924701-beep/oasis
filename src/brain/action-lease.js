// Global active-action lease: passive bodies may run concurrently; only one
// active/visible action may hold the slot. File-based so bridge + plugin share it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ACTIVE_ACTIONS = Object.freeze(new Set([
  'qq_send', 'qq_reply', 'qq_voice', 'qq_poke', 'cross_window', 'pet_speak',
  'bili_comment', 'bili_share', 'bili_dynamic', 'bili_reply', 'bili_like', 'bili_share_qq',
  'desktop_action', 'notify_owner',
]));
export const PASSIVE_ACTIONS = Object.freeze(new Set([
  'watch', 'browse', 'live', 'journal', 'read', 'recall', 'idle', 'listen',
]));

export function classifyAction(action) {
  const a = String(action || '').toLowerCase();
  if (ACTIVE_ACTIONS.has(a)) return 'active';
  if (PASSIVE_ACTIONS.has(a)) return 'passive';
  // Unknown external actions are treated as active by default; never let a new
  // outbound action silently bypass the single-active slot.
  if (/send|reply|share|comment|dynamic|publish|post|speak|notify|action|poke/.test(a)) return 'active';
  return 'internal';
}

function paths(stateDir) {
  const dir = path.resolve(stateDir);
  return {
    dir,
    lease: path.join(dir, 'oasis-active-lease.json'),
    lock: path.join(dir, 'oasis-active-lease.lock'),
  };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(16).slice(2, 8) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function sleepMs(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

function acquireMutex(lockPath, timeoutMs = 2500) {
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
      try {
        const st = fs.statSync(lockPath);
        if (Date.now() - st.mtimeMs > 5000) { try { fs.rmdirSync(lockPath); } catch {} continue; }
      } catch {}
      if (Date.now() - started > timeoutMs) return false;
    }
  }
}
function releaseMutex(lockPath) { try { fs.rmdirSync(lockPath); } catch {} }

export function readActiveLease(stateDir, now = Date.now()) {
  const p = paths(stateDir);
  const lease = readJson(p.lease);
  if (!lease || !lease.token) return null;
  if (Number(lease.expiresAt) > 0 && Number(lease.expiresAt) <= now) return null;
  return lease;
}

export async function acquireActiveLease({ stateDir, owner = 'unknown', action = 'active', ttlMs = 60000, waitMs = 0, now = Date.now() } = {}) {
  const p = paths(stateDir);
  fs.mkdirSync(p.dir, { recursive: true });
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
  while (true) {
    const locked = acquireMutex(p.lock);
    if (!locked) { if (Date.now() < deadline) { await sleepMs(50); continue; } return { ok: false, reason: 'lease-lock-timeout' }; }
    try {
      const current = readActiveLease(p.dir, Date.now());
      if (current && current.owner !== owner) {
        if (Date.now() < deadline) { releaseMutex(p.lock); await sleepMs(100); continue; }
        return { ok: false, reason: 'active-busy', lease: current };
      }
      const token = crypto.randomBytes(8).toString('hex');
      const at = Date.now();
      const lease = { token, owner: String(owner), action: String(action), acquiredAt: at, expiresAt: at + Math.max(5000, Number(ttlMs) || 60000) };
      writeJson(p.lease, lease);
      return { ok: true, lease };
    } finally { releaseMutex(p.lock); }
  }
}

export function releaseActiveLease({ stateDir, token = '', owner = '' } = {}) {
  const p = paths(stateDir);
  const locked = acquireMutex(p.lock);
  if (!locked) return { ok: false, reason: 'lease-lock-timeout' };
  try {
    const current = readJson(p.lease);
    if (!current || !current.token) return { ok: true, released: false };
    if (token && current.token !== token) return { ok: false, reason: 'token-mismatch' };
    if (!token && owner && current.owner !== owner) return { ok: false, reason: 'owner-mismatch' };
    try { fs.unlinkSync(p.lease); } catch {}
    return { ok: true, released: true };
  } finally { releaseMutex(p.lock); }
}

export async function withActiveLease({ stateDir, owner, action, ttlMs = 60000, waitMs = 0 }, fn) {
  const acquired = await acquireActiveLease({ stateDir, owner, action, ttlMs, waitMs });
  if (!acquired.ok) return { ok: false, leaseDenied: true, reason: acquired.reason, lease: acquired.lease };
  try { return await fn(acquired.lease); }
  finally { releaseActiveLease({ stateDir, token: acquired.lease.token }); }
}
