// 电脑操作体 · 动作记忆与技能学习（P4 基础版）。
// 每次动作都写 episode；成功/失败更新 skill 统计；达到证据阈值后作为提示注入。
// 不做模型自训练；安全规则不进入学习数据。
import fs from 'node:fs';
import path from 'node:path';

function readJson(file, fallback) {
  try { const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function appendJsonl(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', 'utf8');
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function skillKey(action = {}) {
  const type = String(action.type || 'unknown');
  const target = String(action.target || '').replace(/[\\/]+$/, '').slice(0, 120).toLowerCase();
  return type + '|' + target;
}

export function recordActionEpisode({ stateDir, episode = {} } = {}) {
  const dir = stateDir;
  const episodeFile = path.join(dir, 'action-episodes.jsonl');
  const skillFile = path.join(dir, 'skills.json');
  const at = episode.at || new Date().toISOString();
  const action = episode.action && typeof episode.action === 'object' ? episode.action : {};
  const result = episode.result && typeof episode.result === 'object' ? episode.result : null;
  const approved = episode.approved === true;
  const denied = episode.denied === true;
  const ok = result?.ok === true || episode.ok === true;
  const key = skillKey(action);
  const rec = {
    at,
    actionId: episode.actionId || '',
    action: {
      type: action.type || '', target: String(action.target || '').slice(0, 300),
      risk: Number(action.risk) || 0, label: action.label || '',
    },
    approved, denied, ok,
    error: String(episode.error || '').slice(0, 500),
    reason: String(action.reason || '').slice(0, 300),
    result: result ? { ok: result.ok === true, bytes: result.bytes ?? null, quarantine: result.quarantine ?? null } : null,
  };
  appendJsonl(episodeFile, rec);

  const store = readJson(skillFile, { version: 1, skills: {} });
  const skills = store && store.skills && typeof store.skills === 'object' ? store.skills : {};
  const prev = skills[key] || { key, type: action.type || 'unknown', target: String(action.target || '').slice(0, 200), success: 0, failure: 0, denied: 0, lastAt: null, lastError: '' };
  if (ok) prev.success += 1;
  else if (denied) prev.denied += 1;
  else prev.failure += 1;
  prev.lastAt = at;
  prev.lastError = ok ? '' : String(episode.error || '').slice(0, 300);
  prev.confidence = (prev.success + 1) / (prev.success + prev.failure + prev.denied + 2);
  prev.candidate = prev.success >= 2 && prev.success >= prev.failure && prev.success >= prev.denied;
  skills[key] = prev;
  writeJson(skillFile, { version: 1, updatedAt: at, skills });
  return rec;
}

export function learningHints({ stateDir, limit = 5 } = {}) {
  const store = readJson(path.join(stateDir, 'skills.json'), { skills: {} });
  const list = Object.values(store?.skills || {}).filter((s) => s && s.candidate).sort((a, b) => (b.success - a.success) || (b.confidence - a.confidence)).slice(0, limit);
  return list.map((s) => ({ type: s.type, target: s.target, success: s.success, failure: s.failure, denied: s.denied, confidence: s.confidence, lastError: s.lastError || '' }));
}

function readLlmReflections(stateDir, limit = 3) {
  try {
    const file = path.join(stateDir, 'llm-reflections.jsonl');
    const raw = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).slice(-limit);
    const out = [];
    for (const line of raw) {
      try {
        const rec = JSON.parse(line);
        for (const insight of Array.isArray(rec.insights) ? rec.insights : []) out.push(insight);
      } catch {}
    }
    return out.slice(-limit * 2);
  } catch { return []; }
}

export function formatLearningBlock({ stateDir, limit = 5 } = {}) {
  const hints = learningHints({ stateDir, limit });
  const llm = readLlmReflections(stateDir, 2);
  if (!hints.length && !llm.length) return '';
  const lines = ['【电脑操作经验（从过去成功/失败里学到的，仅作参考）】'];
  for (const h of hints) lines.push('- ' + h.type + (h.target ? ' @ ' + h.target : '') + '：成功 ' + h.success + ' / 失败 ' + h.failure + ' / 拒绝 ' + h.denied + (h.lastError ? '；上次错误：' + h.lastError.slice(0, 80) : ''));
  for (const x of llm) lines.push('- 经验：' + String(x.nextTime || x.whatWorked || x.whatFailed || '').slice(0, 160));
  lines.push('这些不是永久规则；仍然每次按当前情况重新判断、重新申请授权。');
  return lines.join('\n') + '\n\n';
}
