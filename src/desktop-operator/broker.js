// 电脑操作体 · 本地 Broker（P2）：观察直接读；有外部影响的动作先发一次性 QQ 审批。
// P2 只执行观察类；写/删/执行动作只生成审批，执行器在 P3 接入。
import fs from 'node:fs';
import path from 'node:path';
import { normalizeAction, actionHash } from './policy.js';
import { createApprovalChallenge, markApprovalUsed, verifyApprovalReply } from './approval.js';
import { observe } from './observer.js';
import { recordActionEpisode, formatLearningBlock, learningHints } from './learning.js';
import { recordReflection } from './reflection.js';

function readJson(file, fallback) {
  try { const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function createOperatorBroker({
  stateDir,
  ownerQQ = '',
  sendApproval = null,
  observer = observe,
  executor = null,
  allowShell = false,
  autoExecute = false,
  audit = null,
  ttlMs = 120000,
} = {}) {
  const stateFile = path.join(stateDir, 'operator-approvals.json');
  const auditFile = path.join(stateDir, 'operator-audit.jsonl');
  const pending = new Map();
  const autoRunning = new Set();
  let loaded = false;

  function load() {
    if (loaded) return;
    loaded = true;
    const raw = readJson(stateFile, { approvals: [] });
    for (const c of Array.isArray(raw?.approvals) ? raw.approvals : []) {
      if (c && c.actionId) pending.set(c.actionId, c);
    }
  }
  function save() {
    const approvals = [...pending.values()].slice(-100);
    writeJson(stateFile, { version: 1, updatedAt: new Date().toISOString(), approvals });
  }
  function auditEvent(event) {
    try {
      fs.mkdirSync(path.dirname(auditFile), { recursive: true });
      fs.appendFileSync(auditFile, JSON.stringify({ at: new Date().toISOString(), ...event }) + '\n', 'utf8');
    } catch {}
    if (typeof audit === 'function') { try { audit(event); } catch {} }
  }
  function prune(now = Date.now()) {
    let changed = false;
    for (const [id, c] of pending) {
      if (c.status === 'pending' && now > c.expiresAt) { c.status = 'expired'; changed = true; }
      if (c.status !== 'pending' && now - (c.deniedAt || c.approvedAt || c.usedAt || c.createdAt) > 7 * 86400000) { pending.delete(id); changed = true; }
    }
    if (changed) save();
  }

  async function requestAction(action = {}) {
    load(); prune();
    const normalized = normalizeAction(action);
    if (!normalized.ok) return { ok: false, error: normalized.error, forbidden: normalized.forbidden === true };
    const a = normalized.action;
    if (!a.approvalRequired) {
      try {
        const result = await observer(a.type, { dataDir: path.join(stateDir, 'screens'), limit: 120 });
        auditEvent({ type: 'observe', action: a, ok: true });
        try { recordActionEpisode({ stateDir, episode: { action: a, ok: true, result } }); } catch {}
        try { recordReflection({ stateDir, action: a, ok: true, result }); } catch {}
        return { ok: true, observed: true, action: a, result };
      } catch (error) {
        auditEvent({ type: 'observe', action: a, ok: false, error: String(error?.message ?? error) });
        return { ok: false, error: String(error?.message ?? error) };
      }
    }
    const created = createApprovalChallenge({ action: a, ttlMs });
    if (!created.ok) return { ok: false, error: created.error, forbidden: created.forbidden === true };
    const challenge = created.challenge;
    pending.set(challenge.actionId, challenge);
    save();
    auditEvent({ type: 'request', action: a, actionId: challenge.actionId, actionHash: challenge.actionHash });
    if (typeof sendApproval === 'function') {
      try { await sendApproval(challenge); } catch (error) { auditEvent({ type: 'send-approval-failed', actionId: challenge.actionId, error: String(error?.message ?? error) }); }
    }
    return {
      ok: true,
      pending: true,
      actionId: challenge.actionId,
      code: challenge.code,
      expiresAt: challenge.expiresAt,
      action: a,
      actionHash: challenge.actionHash,
      autoExecute: Boolean(autoExecute && executor),
      note: '把短码发给主人；主人批准后系统会自动执行一次，可用 pc_action_status 查看结果。',
    };
  }

  function findPendingByCode(code, now = Date.now()) {
    const c = String(code || '').toUpperCase();
    for (const ch of pending.values()) if (ch.code === c && ch.status === 'pending') return ch;
    return null;
  }

  function handleReply({ text = '', fromQQ = '', now = Date.now() } = {}) {
    load(); prune(now);
    const m = String(text || '').match(/^(?:我)?(允许|同意|批准|拒绝|不同意|不允许)\s*[:：]?\s*([A-Fa-f0-9]{4,12})\s*$/);
    if (!m) return { ok: false, ignored: true };
    const ch = findPendingByCode(m[2], now);
    if (!ch) return { ok: false, error: '没有这个待审批动作' };
    const verified = verifyApprovalReply({ challenge: ch, text, fromQQ, ownerQQ, now });
    if (!verified.ok) {
      auditEvent({ type: 'approval-rejected', actionId: ch.actionId, status: verified.status, error: verified.error });
      if (verified.status === 'denied') {
        try { recordActionEpisode({ stateDir, episode: { action: ch.action, actionId: ch.actionId, denied: true, error: '主人拒绝' } }); } catch {}
        try { recordReflection({ stateDir, action: ch.action, denied: true, error: '主人拒绝' }); } catch {}
      }
      return { ok: false, status: verified.status, error: verified.error };
    }
    const next = verified.challenge;
    pending.set(next.actionId, next);
    save();
    auditEvent({ type: 'approval', actionId: next.actionId, status: next.status, fromQQ: String(fromQQ) });
    // 批准后自动执行一次：用户已经明确同意这个 actionHash，不再要求她额外猜“要不要 execute”。
    // 执行仍是一次性、TTL、动作内容不可变；autoExecute 默认关，桥接显式开启。
    if (next.status === 'approved' && autoExecute && executor) {
      setTimeout(() => {
        if (autoRunning.has(next.actionId)) return;
        autoRunning.add(next.actionId);
        void executeApproved(next.actionId).finally(() => autoRunning.delete(next.actionId));
      }, 0);
    }
    return { ok: true, status: next.status, actionId: next.actionId, action: next.action, autoExecute: Boolean(autoExecute && executor) };
  }

  function getApproval(actionId) {
    load(); prune();
    const c = pending.get(String(actionId || ''));
    return c ? { ...c } : null;
  }

  function listPending() {
    load(); prune();
    return [...pending.values()].filter((c) => c.status === 'pending').map((c) => ({
      actionId: c.actionId, code: c.code, action: c.action, expiresAt: c.expiresAt,
    }));
  }

  /** P2：批准后只读不回写；P3 接入执行器时在这里挂 executeApproved。 */
  async function executeApproved(actionId) {
    load(); prune();
    const c = pending.get(String(actionId || ''));
    if (!c) return { ok: false, error: '审批不存在' };
    if (c.status !== 'approved') return { ok: false, error: '审批未通过（' + c.status + '）' };
    if (c.usedAt) return { ok: false, error: '审批已使用（不可重放）' };
    if (Date.now() > c.expiresAt) return { ok: false, error: '审批已过期' };
    const next = markApprovalUsed(c);
    pending.set(next.actionId, next); save();
    if (!executor) return { ok: false, error: 'P3 执行器未接入；只保存审批状态', action: c.action };
    let result;
    try {
      result = await executor(c.action, { stateDir, allowShell });
      auditEvent({ type: 'execute', actionId: c.actionId, action: c.action, ok: true, result });
      try { recordActionEpisode({ stateDir, episode: { action: c.action, actionId: c.actionId, approved: true, ok: true, result } }); } catch {}
      try { recordReflection({ stateDir, action: c.action, ok: true, result }); } catch {}
      return { ok: true, executed: true, actionId: c.actionId, action: c.action, result };
    } catch (error) {
      const message = String(error?.message ?? error);
      auditEvent({ type: 'execute', actionId: c.actionId, action: c.action, ok: false, error: message });
      try { recordActionEpisode({ stateDir, episode: { action: c.action, actionId: c.actionId, approved: true, ok: false, error: message } }); } catch {}
      try { recordReflection({ stateDir, action: c.action, ok: false, error: message }); } catch {}
      return { ok: false, error: message, actionId: c.actionId, action: c.action };
    }
  }

  return {
    requestAction, handleReply, getApproval, listPending, executeApproved,
    learningBlock: () => { try { return formatLearningBlock({ stateDir, limit: 5 }); } catch { return ''; } },
    learningHints: () => { try { return learningHints({ stateDir, limit: 8 }); } catch { return []; } },
    status: () => ({ pending: listPending().length, stateFile, skills: (() => { try { return learningHints({ stateDir, limit: 8 }).length; } catch { return 0; } })() }),
  };
}
