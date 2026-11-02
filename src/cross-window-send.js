// 跨窗口发送的严格模式校验（P1）：只允许「主人私聊」把消息交给「白名单群/白名单私聊」。
const KEY_RE = /^(group|private):(\d{5,12})$/;

export function validateCrossWindowSend({ sourceKey = '', targetKey = '', ownerQQ = '', isAllowedTarget = () => false } = {}) {
  const source = String(sourceKey ?? '').trim();
  const target = String(targetKey ?? '').trim();
  const owner = String(ownerQQ ?? '').trim();
  if (!owner) return { ok: false, error: '主人 QQ 未配置，跨窗口发送拒绝' };
  if (!KEY_RE.test(source)) return { ok: false, error: 'sourceKey 必须是 group:群号 或 private:QQ号' };
  if (!KEY_RE.test(target)) return { ok: false, error: 'targetKey 必须是 group:群号 或 private:QQ号' };
  if (source !== 'private:' + owner) return { ok: false, error: '严格模式：只有主人私聊可以跨窗口发送' };
  if (source === target) return { ok: false, error: 'sourceKey 和 targetKey 不能相同；同窗口请用普通发送工具' };
  const [, kind, id] = KEY_RE.exec(target);
  if (typeof isAllowedTarget === 'function' && !isAllowedTarget(kind, id)) {
    return { ok: false, error: '目标窗口不在白名单，跨窗口发送拒绝' };
  }
  return { ok: true, kind, id, targetKey: target, sourceKey: source };
}

export function crossWindowSendPromptLine({ key = '', groups = [] } = {}) {
  const s = String(key ?? '');
  if (!s.startsWith('private:')) return '';
  const targets = (Array.isArray(groups) ? groups : []).filter((g) => g && g.id).slice(0, 6);
  const list = targets.length
    ? targets.map((g) => 'group:' + g.id + (g.name ? '（' + g.name + '）' : '')).join('、')
    : '（以当前白名单为准；不确定就先 qq_get_recent_messages 看当前群）';
  return '【跨窗口发送（严格模式）】\n'
    + '如果你在私聊被要求去某个群/对象窗口说一句，不要用普通发送工具硬发（会被会话令牌隔离拒绝，显示 agent token 无效）。\n'
    + '请调用 qq_send_other_window：sourceKey=当前私聊 key（' + s + '），targetKey=目标窗口，token=本窗口令牌。\n'
    + '可用的白名单群：' + list + '。只允许主人私聊发起，群窗口不能反向当跳板。\n\n';
}
