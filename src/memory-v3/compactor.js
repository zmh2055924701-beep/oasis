// MP-2 compaction shadow primitives. This module NEVER retires a session.
// It only decides whether a handoff *would* be built and produces a deterministic draft.
import fs from 'node:fs';
import path from 'node:path';

export const COMPACTION_VERSION = 1;

export function normalizeCompactionConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: src.enabled === true,
    shadow: src.shadow !== false,
    maxTurns: Math.max(4, Number(src.maxTurns) || 24),
    maxTokens: Math.max(1000, Number(src.maxTokens) || 30000),
    keepTurns: Math.max(2, Number(src.keepTurns) || 8),
    minTurns: Math.max(1, Number(src.minTurns) || 8),
    maxHandoffChars: Math.max(200, Number(src.maxHandoffChars) || 1200),
  };
}

export function evaluateCompaction({ turnCount = 0, totalTokens = 0, lastCompactedTurn = 0, lastCompactedAt = 0, busy = false, approvalPending = false, now = Date.now(), config = {} } = {}) {
  const c = normalizeCompactionConfig(config);
  const turns = Math.max(0, Number(turnCount) || 0);
  const tokens = Math.max(0, Number(totalTokens) || 0);
  const since = turns - Math.max(0, Number(lastCompactedTurn) || 0);
  if (busy || approvalPending) return { due: false, reason: 'busy-or-approval', shadow: c.shadow };
  if (turns < c.maxTurns && tokens < c.maxTokens) return { due: false, reason: 'below-threshold', turns, tokens, shadow: c.shadow };
  if (since < c.minTurns) return { due: false, reason: 'min-turns', since, shadow: c.shadow };
  if (lastCompactedAt && now - Number(lastCompactedAt) < 30 * 60 * 1000) return { due: false, reason: 'cooldown', shadow: c.shadow };
  return { due: true, reason: turns >= c.maxTurns ? 'max-turns' : 'max-tokens', turns, tokens, shadow: c.shadow };
}

export function recordCompactionShadow({ file, key = '', evaluation = null, handoff = null, now = Date.now(), maxSamples = 100 } = {}) {
  if (!file) return null;
  const record = {
    at: new Date(now).toISOString(),
    key: String(key || ''),
    shadow: true,
    evaluation,
    handoff: handoff ? { chars: handoff.chars, preview: String(handoff.text || '').slice(0, 400) } : null,
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf8');
    // Keep the shadow log bounded; this is only a sample log, not raw memory.
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
    if (lines.length > maxSamples) fs.writeFileSync(file, lines.slice(-maxSamples).join('\n') + '\n', 'utf8');
  } catch {}
  return record;
}

export function buildHandoff({ messages = [], facts = [], commitments = [], unfinished = [], maxChars = 1200, now = Date.now() } = {}) {
  const lines = ['# 会话交接（handoff）', '生成时间：' + new Date(now).toISOString(), '', '## 稳定事实 / 承诺'];
  const coreFacts = Array.isArray(facts) ? facts.filter((f) => /promise|relationship|identity|约定|关系|身份|承诺/.test(String(f.kind || '') + String(f.tags || ''))).slice(-8) : [];
  const coreCommit = (Array.isArray(commitments) ? commitments : []).filter(Boolean).slice(0, 8);
  for (const x of [...coreFacts.map((f) => f.text || f.summary || f.object || ''), ...coreCommit.map((x) => x.text || x)]) {
    const s = String(x || '').trim();
    if (s) lines.push('- ' + s.slice(0, 160));
  }
  if (lines.length <= 4) lines.push('- （无明确事实/承诺）');
  lines.push('', '## 未完成话题');
  for (const x of (Array.isArray(unfinished) ? unfinished : []).slice(-8)) {
    const s = String(x.text || x.summary || x || '').trim();
    if (s) lines.push('- ' + s.slice(0, 160));
  }
  if (lines[lines.length - 1] === '## 未完成话题') lines.push('- （无）');
  lines.push('', '## 最近对话摘录');
  for (const m of (Array.isArray(messages) ? messages : []).slice(-8)) {
    const who = m.isSelf ? '她' : (m.sender || m.name || '对方');
    const text = String(m.text || m.plain || '').replace(/\s+/g, ' ').trim();
    if (text) lines.push('- ' + who + '：' + text.slice(0, 140));
  }
  lines.push('', '> 这是摘要，不是全文；原始消息与 Memory v3 仍在，可回查。');
  return { text: lines.join('\n').slice(0, maxChars), chars: Math.min(maxChars, lines.join('\n').length), messageCount: (messages || []).length };
}
