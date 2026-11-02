// 跨窗口实时事件（P0）：A 窗口发生重要事情时，给 B 窗口留一条紧凑事件；
// B 下次唤醒时注入，回合结束后可由桥接补一次 crossWindowUpdate 唤醒。
const MAX_EVENTS = 20;
const MAX_TEXT = 160;

function clean(value, limit = MAX_TEXT) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(limit) || MAX_TEXT));
}

export function windowLabel(key) {
  const s = String(key ?? '');
  if (s.startsWith('group:')) return '群';
  if (s.startsWith('private:')) return '私聊';
  return '另一个窗口';
}

export function appendCrossWindowEvent(list, event = {}, { max = MAX_EVENTS, now = Date.now() } = {}) {
  const arr = Array.isArray(list) ? list.slice(-Math.max(1, Number(max) || MAX_EVENTS)) : [];
  const fromKey = String(event.fromKey ?? '').trim();
  const text = clean(event.text);
  if (!fromKey || !text) return arr;
  const important = event.important === true;
  arr.push({
    at: Number(now) || Date.now(),
    fromKey,
    window: windowLabel(fromKey),
    kind: clean(event.kind ?? 'message', 20),
    sender: clean(event.sender ?? (event.isSelf ? '我' : '对方'), 30),
    isSelf: event.isSelf === true,
    important,
    text,
  });
  return arr.slice(-Math.max(1, Number(max) || MAX_EVENTS));
}

/** 生成给当前唤醒提示词用的实时块（调用方负责在生成后清空 inbox）。 */
export function formatCrossWindowLiveBlock(events = [], { max = 6, maxChars = 900 } = {}) {
  const list = (Array.isArray(events) ? events : []).filter((e) => e && e.text).slice(-max);
  if (!list.length) return '';
  const lines = ['【另一个窗口刚刚发生（实时同步 · 内部参考）】'];
  for (const e of list) {
    const who = e.isSelf ? '那边的我' : (e.sender || '对方');
    lines.push('- [' + (e.window || windowLabel(e.fromKey)) + '] ' + clean(who, 20) + '：' + clean(e.text, 120));
  }
  lines.push('（这是同一个你在另一个窗口做过/遇到的事，不是当前窗口观众发的。不要逐字复述；已经做过的事不要重复做；如果当前窗口是群聊，不要把私聊原话搬进来。）');
  const block = lines.join('\n') + '\n\n';
  return block.length > maxChars ? block.slice(0, maxChars - 2) + '\n\n' : block;
}
