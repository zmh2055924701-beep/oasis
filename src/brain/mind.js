// Tier2 内心独白 / Tier3 行动闸门（纯逻辑，副作用在 bridge）。
export const DEFAULT_MIND_CONFIG = Object.freeze({
  enabled: true,
  intervalMinMs: 900000,
  hourlyMax: 6,
  dailyMax: 40,
  idleMinMs: 300000,
  quietStart: '23:30',
  quietEnd: '08:00',
  urgeThreshold: 0.72,
  proactiveDailyMax: 4,
  proactiveCooldownMin: 2700000,
  allowProactive: true,
  preset: '',
  maxPromptChars: 12000,
});

export function normalizeMindConfig(raw = {}) {
  const cfg = { ...DEFAULT_MIND_CONFIG, ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const k of ['intervalMinMs', 'hourlyMax', 'dailyMax', 'idleMinMs', 'proactiveDailyMax', 'proactiveCooldownMin', 'maxPromptChars']) {
    const n = Number(cfg[k]);
    cfg[k] = Number.isFinite(n) && n > 0 ? Math.round(n) : DEFAULT_MIND_CONFIG[k];
  }
  cfg.urgeThreshold = Math.max(0.2, Math.min(1, Number(cfg.urgeThreshold) || DEFAULT_MIND_CONFIG.urgeThreshold));
  cfg.enabled = cfg.enabled !== false;
  cfg.allowProactive = cfg.allowProactive !== false;
  return cfg;
}

function parseClock(value, fallback) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!m) return parseClock(fallback, '00:00');
  return { hh: Number(m[1]), mm: Number(m[2]) };
}

export function inQuietHours(now, cfg = DEFAULT_MIND_CONFIG) {
  const s = parseClock(cfg.quietStart, '23:30');
  const e = parseClock(cfg.quietEnd, '08:00');
  if (s.hh === e.hh && s.mm === e.mm) return false;
  const d = new Date(now);
  const m = d.getHours() * 60 + d.getMinutes();
  const sm = s.hh * 60 + s.mm;
  const em = e.hh * 60 + e.mm;
  return sm < em ? (m >= sm && m < em) : (m >= sm || m < em);
}

export function parseThoughtJson(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const brace = /\{[\s\S]*\}/.exec(raw);
  const candidate = brace ? brace[0] : raw;
  try {
    const obj = JSON.parse(candidate.trim());
    if (!obj || typeof obj !== 'object') return null;
    const thought = String(obj.thought ?? '').trim();
    if (!thought) return null;
    return {
      thought: thought.slice(0, 500),
      emotion: String(obj.emotion ?? '').slice(0, 40),
      urge: Math.max(0, Math.min(1, Number(obj.urge) || 0)),
      desire: ['none', 'message', 'share', 'ask'].includes(obj.desire) ? obj.desire : 'none',
      message: String(obj.message ?? '').slice(0, 300),
      topic: String(obj.topic ?? '').slice(0, 60),
    };
  } catch {
    return null;
  }
}

export function shouldThinkNow({ now = Date.now(), mindState = {}, lastHumanAt = 0, cfg = DEFAULT_MIND_CONFIG, busy = false, paused = false, dshReady = true } = {}) {
  if (!cfg.enabled) return { due: false, reason: 'disabled' };
  if (!dshReady) return { due: false, reason: 'dsh' };
  if (paused) return { due: false, reason: 'paused' };
  if (busy) return { due: false, reason: 'busy' };
  if (inQuietHours(now, cfg)) return { due: false, reason: 'quiet' };
  if (lastHumanAt && now - lastHumanAt < cfg.idleMinMs) return { due: false, reason: 'recent-human' };
  if (Number(mindState.lastRunAt) && now - Number(mindState.lastRunAt) < cfg.intervalMinMs) return { due: false, reason: 'interval' };
  return { due: true, reason: 'due' };
}

export function buildMindPrompt({ persona = '', memoryBlock = '', timeBlock = '', recentThoughts = [], config = DEFAULT_MIND_CONFIG } = {}) {
  const lines = [
    '你现在不在和任何人聊天，这是你自己的内心时间。',
    timeBlock,
    '【你是谁】',
    String(persona || '').slice(0, 3500),
    '【你此刻的状态/记忆】',
    String(memoryBlock || '').slice(0, 5000),
    '【最近想过的事】',
    ...(Array.isArray(recentThoughts) && recentThoughts.length
      ? recentThoughts.slice(-3).map((t) => '- ' + String(t.text || '').slice(0, 160))
      : ['- 最近没想什么']),
    '',
    '请以第一人称写 1~3 句你此刻真正在想的东西（可以发呆、走神、回忆、惦记未完成的事），不要复述设定，不要讨好任何人。',
    '只输出一个 JSON 对象，不要 markdown：',
    '{"thought":"1~3句内心独白","emotion":"一个情绪词","urge":0~1,"desire":"none|message|share|ask","message":"如果真想发消息，写一句自然的话；不想发就空字符串","topic":"一句话主题"}',
    '注意：你只是想想，不一定发；想发也不一定真的发得出去。',
  ].filter(Boolean);
  return lines.join('\n').slice(0, Math.max(1000, Number(config?.maxPromptChars) || 12000));
}

export function decideAction({ thought = null, now = Date.now(), mindState = {}, lastHumanAt = 0, cfg = DEFAULT_MIND_CONFIG } = {}) {
  if (!cfg.allowProactive) return { send: false, reason: 'disabled' };
  if (!thought) return { send: false, reason: 'no-thought' };
  if (inQuietHours(now, cfg)) return { send: false, reason: 'quiet' };
  if (Number(thought.urge) < cfg.urgeThreshold) return { send: false, reason: 'urge-low' };
  if (!['message', 'share', 'ask'].includes(thought.desire)) return { send: false, reason: 'desire-none' };
  const text = String(thought.message || '').trim();
  if (text.length < 2 || text.length > 200) return { send: false, reason: 'message-invalid' };
  if (lastHumanAt && now - lastHumanAt < 3 * 60 * 1000) return { send: false, reason: 'human-active' };
  if (now - (Number(mindState.lastSentAt) || 0) < cfg.proactiveCooldownMin) return { send: false, reason: 'cooldown' };
  const day = new Date(now).toISOString().slice(0, 10);
  const sentToday = String(mindState.sentDay || '') === day ? Number(mindState.sentToday) || 0 : 0;
  if (sentToday >= cfg.proactiveDailyMax) return { send: false, reason: 'daily-max' };
  return { send: true, text, target: 'owner' };
}
