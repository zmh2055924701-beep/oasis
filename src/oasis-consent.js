// Oasis 人格化公共动作审批（P3）。
// 申请的自然语言由人格/记忆/情绪上下文生成；动作内容与短码由这里冻结，模型不能篡改。
import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeConsentCode(length = 4) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}
export function actionHash(action, content) {
  return crypto.createHash('sha256').update(String(action) + '\u0000' + String(content ?? '')).digest('hex');
}
export function createConsentRequest({ id = '', action, content = '', now = Date.now(), ttlMs = 10 * 60_000, kind = 'bili' } = {}) {
  const code = makeConsentCode();
  const actionId = id || ('oc_' + crypto.randomUUID());
  const hash = actionHash(action, content);
  return {
    id: actionId, code, kind, action, content: String(content ?? ''), hash,
    status: 'pending', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ttlMs).toISOString(), ttlMs,
  };
}
export function verifyConsentReply(text, request, now = Date.now()) {
  if (!request || request.status !== 'pending') return { ok: false, reason: 'not-pending' };
  if (Number(now) > Date.parse(request.expiresAt)) return { ok: false, reason: 'expired' };
  const raw = String(text ?? '').trim();
  if (!raw || raw.length > 40) return { ok: false, reason: 'too-long' };
  const code = String(request.code || '');
  // 旧的短码方式仍然兼容；新的自然回复不需要短码，只有主人私聊能到这里。
  if (code && new RegExp('(?:允许|同意|可以|批准|准|approve)\\s*' + code + '\\b', 'i').test(raw)) {
    return { ok: true, approved: true, code, id: request.id };
  }
  if (code && new RegExp('(?:拒绝|不行|不要|不允许|deny|reject)\\s*' + code + '\\b', 'i').test(raw)) {
    return { ok: true, approved: false, code, id: request.id };
  }
  const denyRe = /^(?:拒绝|不行|不要|不可以|不允许|不准|别去|不去|不想|算了|no|nope)(?:[\s，,。.!！~～]|$)/i;
  if (denyRe.test(raw)) return { ok: true, approved: false, id: request.id };
  const approveRe = /^(?:好|行|嗯+|可以|允许|同意|批准|准|去吧|去嘛|去|好的|好呀|好哦|可以呀|可以啊|可以可以|批准了|同意啊|ok|okay|yes)(?:[\s，,。.!！~～]|$)/i;
  if (approveRe.test(raw)) return { ok: true, approved: true, id: request.id };
  return { ok: false, reason: 'no-match' };
}
export function buildConsentBrief({ persona = {}, affect = {}, memory = [], action = '', content = '' } = {}) {
  const name = persona.name || '她';
  const mood = affect.mood || {};
  const valence = Number(mood.valence) || 0;
  const arousal = Number(mood.arousal) || 0.45;
  const feeling = valence > 0.3 ? '有点开心/想分享' : valence < -0.3 ? '有点低落/想找个出口' : '心里有点东西想说出来';
  return [
    '你是' + name + '。现在' + feeling + '（心情 ' + valence.toFixed(2) + ' / 唤醒 ' + arousal.toFixed(2) + '）。',
    '你记得的最近的事：' + (memory.slice(0, 3).map((m) => String(m.text ?? m).slice(0, 80)).join('；') || '（没有特别的事）'),
    '你想做的公开动作：' + action,
    '内容草稿：' + String(content ?? '').slice(0, 300),
    '请用你自己的语气，向对方说明为什么想做、大概会做什么；不要像系统模板，不要叫“主人”。',
  ].join('\n');
}
export function formatConsentMessage({ natural = '', request }) {
  const body = String(natural || '')
    .replace(/主人/g, '你')
    .replace(/^你[，,]\s*/, '')
    .replace(/审批|额度|短码|Oasis|系统通知/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return body;
}
