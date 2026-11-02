// 电脑操作体 · 结构化反思（P5 基础版）：成功/失败/拒绝都形成可检索的经验。
// 不冒充 LLM 自省；这里先做确定性归因，后续可接模型生成更丰富的反思。
import fs from 'node:fs';
import path from 'node:path';

export function classifyActionError(error = '') {
  const s = String(error || '');
  if (/受保护|系统目录|拒绝操作/.test(s)) return 'protected-path';
  if (/不存在|not found|ENOENT/i.test(s)) return 'not-found';
  if (/权限|denied|EPERM|EACCES/i.test(s)) return 'permission';
  if (/超时|timeout|timed out/i.test(s)) return 'timeout';
  if (/审批|授权|拒绝/.test(s)) return 'approval';
  if (/路径|path/i.test(s)) return 'path';
  return 'unknown';
}

export function buildReflection({ action = {}, ok = false, denied = false, error = '', result = null } = {}) {
  const type = String(action.type || '动作');
  const target = String(action.target || '').slice(0, 120);
  if (denied) {
    return {
      outcome: 'denied',
      insight: '主人拒绝了这次' + type + (target ? '（' + target + '）' : '') + '。不要换个说法重复申请；先确认主人的真实意图或换更安全的方案。',
      next: '先问清楚/缩小范围；下次仍需逐次授权。',
      errorClass: 'approval',
    };
  }
  if (ok) {
    return {
      outcome: 'success',
      insight: '成功完成' + type + (target ? '（' + target + '）' : '') + '。这个步骤可以在相似安全场景复用，但每次仍要重新申请授权。',
      next: '复用成功的路径/参数；若目标变化，重新评估风险。',
      errorClass: '',
    };
  }
  const cls = classifyActionError(error);
  const hints = {
    'protected-path': '目标落在受保护目录：不要碰系统/凭据目录，换用户目录。',
    'not-found': '目标不存在：先观察窗口/文件列表，确认路径或窗口标题。',
    permission: '权限不足：不要尝试提权；请主人手动处理或换路径。',
    timeout: '操作超时：不要连续重试；先确认应用是否卡住。',
    approval: '授权流程未完成：先检查是否收到批准；不要绕过。',
    path: '路径有问题：确认绝对路径、引号和父目录。',
    unknown: '未知失败：先只读观察当前状态，再决定是否重试。',
  };
  return {
    outcome: 'failure',
    insight: type + (target ? '（' + target + '）' : '') + '失败：' + String(error || '未知错误').slice(0, 200) + '。' + (hints[cls] || hints.unknown),
    next: '不要重复同一失败动作；先观察，再重新申请。',
    errorClass: cls,
  };
}

export function recordReflection({ stateDir, action = {}, ok = false, denied = false, error = '', result = null, at = new Date().toISOString() } = {}) {
  const dir = stateDir;
  const file = path.join(dir, 'reflections.jsonl');
  const reflection = buildReflection({ action, ok, denied, error, result });
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify({
    at,
    action: { type: action.type || '', target: String(action.target || '').slice(0, 300), risk: Number(action.risk) || 0 },
    ok, denied, error: String(error || '').slice(0, 500), ...reflection,
  }) + '\n', 'utf8');
  return reflection;
}
