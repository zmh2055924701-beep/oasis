// 电脑操作体 · 动作策略（P2/P3 共用，纯函数、可测试）。
// 原则：默认拒绝；观察类不需要 QQ 授权；任何外部影响必须逐次授权；
// 永久高危动作即使调用也直接拒绝，不能靠授权放行。

export const ACTION_TYPES = Object.freeze({
  observe_windows: { risk: 0, approval: false, label: '查看窗口列表' },
  observe_screen: { risk: 0, approval: false, label: '截屏' },
  observe_uia: { risk: 0, approval: false, label: '读取界面控件' },
  observe_processes: { risk: 0, approval: false, label: '查看进程列表' },
  app_launch: { risk: 1, approval: true, label: '启动应用' },
  app_focus: { risk: 1, approval: true, label: '切换窗口' },
  ui_click: { risk: 1, approval: true, label: '鼠标点击' },
  ui_type: { risk: 1, approval: true, label: '键盘输入' },
  file_read: { risk: 1, approval: true, label: '读取文件内容' },
  file_write: { risk: 2, approval: true, label: '写入/修改文件' },
  file_delete: { risk: 3, approval: true, label: '删除文件' },
  file_move: { risk: 2, approval: true, label: '移动文件' },
  process_kill: { risk: 3, approval: true, label: '结束进程' },
  shell_run: { risk: 3, approval: true, label: '执行命令' },
  window_close: { risk: 2, approval: true, label: '关闭窗口' },
});

// 永久禁止：不进入审批队列；只能用户手动操作。
export const FORBIDDEN_TYPES = new Set([
  'payment', 'credentials', 'security_settings', 'format_disk', 'system_account',
  'registry_write', 'disable_antivirus', 'install_driver', 'uac_bypass',
]);

export const FORBIDDEN_COMMAND_PATTERNS = [
  /format(\.com)?\s+[a-z]:/i, /diskpart/i, /bcdedit/i, /remove-item\s+.*(?:c:\\windows|system32)/i,
  /reg(?:\.exe)?\s+(?:add|delete)/i, /net\s+user\s+.*\/add/i, /shutdown\s+\/s/i,
  /cipher\s+\/w/i, /vssadmin\s+delete/i, /takeown\s+\/f\s+.*windows/i, /icacls\s+.*\/grant/i,
  /Invoke-Expression|IEX\s*\(/i, /DownloadString|Invoke-WebRequest|curl\s+.*\|\s*(?:sh|bash|powershell)/i,
];

export function isForbiddenAction(action = {}) {
  const type = String(action.type || '').trim();
  if (FORBIDDEN_TYPES.has(type)) return { forbidden: true, reason: '该动作类型永久禁止' };
  const text = [action.command, action.target, action.path].filter(Boolean).join(' ');
  for (const re of FORBIDDEN_COMMAND_PATTERNS) if (re.test(text)) return { forbidden: true, reason: '命中永久禁止命令模式' };
  return { forbidden: false, reason: '' };
}

export function normalizeAction(action = {}) {
  const type = String(action.type || '').trim();
  const def = ACTION_TYPES[type];
  if (!def) return { ok: false, error: '未知动作类型：' + type };
  const forbidden = isForbiddenAction(action);
  if (forbidden.forbidden) return { ok: false, error: forbidden.reason, forbidden: true };
  const target = String(action.target ?? '').slice(0, 500);
  let command = String(action.command ?? '').slice(0, 2000);
  let params = action.params && typeof action.params === 'object' ? { ...action.params } : {};
  if (!String(params.content ?? '') && typeof action.content === 'string') params.content = action.content;
  // 兼容旧版 pc_action_request 工具：它没有 content 参数，用户/她把内容放进了 command。
  // file_write 的 command 一律当作文件内容，避免「只建出空文件」。
  if (type === 'file_write' && !String(params.content ?? '') && command) {
    params.content = command;
    command = '';
  }
  if (type === 'shell_run' && !command) return { ok: false, error: 'shell 动作必须提供 command' };
  if (type === 'file_write' && !String(params.content ?? '')) return { ok: false, error: 'file_write 必须提供 content（写文件内容）' };
  if ((type === 'file_write' || type === 'file_delete' || type === 'file_move') && !target) return { ok: false, error: '文件动作必须提供 target 路径' };
  return {
    ok: true,
    action: {
      type,
      target,
      command,
      params,
      reason: String(action.reason ?? '').slice(0, 500),
      risk: def.risk,
      approvalRequired: def.approval,
      label: def.label,
      intentId: String(action.intentId ?? '').slice(0, 100),
    },
  };
}

export function canonicalAction(action = {}) {
  const keys = ['type', 'target', 'command', 'params', 'intentId'];
  const obj = {};
  for (const k of keys) obj[k] = action[k] ?? null;
  return JSON.stringify(obj);
}

export function actionHash(action = {}) {
  // 不依赖 crypto 的简单稳定哈希；审批只要求动作内容不变，不需要密码学强度。
  const s = canonicalAction(action);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).toUpperCase();
}
