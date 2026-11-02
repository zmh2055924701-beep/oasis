// 情绪动力学：瞬时情绪衰减、心境基线漂移、需求/生理状态更新。
//
// 情绪不是"标签"，而是带强度/半衰期/来源的状态；心境是慢变量。
// 纯函数：输入 state + 评估结果，返回新 state（不写盘，由 index.js 负责）。
import {
  DEFAULT_BRAIN_CONFIG, EMOTION_TYPES, NEED_KEYS, clamp01, clampSigned, iso,
} from './schema.js';

function hourMs(hours) { return Math.max(60000, Number(hours) * 3600000); }

/** 按半衰期衰减情绪；强度低于 0.03 的移除。 */
export function decayEmotions(emotions, now = Date.now(), { keepThreshold = 0.03 } = {}) {
  const at = Number(now) || Date.now();
  const out = [];
  for (const raw of Array.isArray(emotions) ? emotions : []) {
    const meta = EMOTION_TYPES[raw?.type];
    if (!meta) continue;
    const created = Date.parse(String(raw.createdAt ?? '')) || at;
    const halfLife = Math.max(60000, Number(raw.halfLifeMs) || hourMs(3));
    const age = Math.max(0, at - created);
    const intensity = clamp01(raw.intensity, 0) * Math.pow(0.5, age / halfLife);
    if (intensity < keepThreshold) continue;
    out.push({ ...raw, valence: clampSigned(raw.valence, meta.valence), arousal: clamp01(raw.arousal, meta.arousal), intensity: Math.round(intensity * 1000) / 1000 });
  }
  return out;
}

/** 合并同类型情绪（强度取较高者 + 少量叠加，保持可解释的 cause）。 */
function mergeEmotion(list, incoming) {
  const meta = EMOTION_TYPES[incoming.type];
  if (!meta) return list;
  const existing = list.find((e) => e.type === incoming.type);
  if (existing) {
    existing.intensity = Math.min(1, Math.max(Number(existing.intensity) || 0, Number(incoming.intensity) || 0) + 0.08);
    existing.createdAt = iso(Date.now());
    if (incoming.cause) existing.cause = incoming.cause;
    return list;
  }
  list.push({
    id: incoming.id || (incoming.type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
    type: incoming.type,
    label: meta.label,
    valence: clampSigned(incoming.valence, meta.valence),
    arousal: clamp01(incoming.arousal, meta.arousal),
    intensity: clamp01(incoming.intensity, 0),
    halfLifeMs: Math.max(60000, Number(incoming.halfLifeMs) || hourMs(3)),
    createdAt: iso(Date.now()),
    sourceEventId: String(incoming.sourceEventId ?? ''),
    cause: String(incoming.cause ?? '').slice(0, 200),
    appraisal: incoming.appraisal && typeof incoming.appraisal === 'object' ? incoming.appraisal : {},
  });
  return list;
}

/** 心情目标值：按当前情绪强度加权；没有情绪时回落到当前心境。 */
function moodTarget(emotions, mood) {
  const total = emotions.reduce((sum, e) => sum + (Number(e.intensity) || 0), 0);
  if (total <= 0.02) return { valence: 0, arousal: 0.45, dominance: mood.dominance };
  const valence = emotions.reduce((sum, e) => sum + (Number(e.valence) || 0) * (Number(e.intensity) || 0), 0) / total;
  const arousal = emotions.reduce((sum, e) => sum + (Number(e.arousal) || 0) * (Number(e.intensity) || 0), 0) / total;
  return { valence, arousal, dominance: mood.dominance };
}

/** 应用一次评估结果：更新情绪/心境/需求/生理。 */
export function applyAppraisal(state, result, { now = Date.now(), eventId = '' } = {}) {
  const at = Number(now) || Date.now();
  const next = JSON.parse(JSON.stringify(state));
  const affect = next.affect;
  affect.emotions = decayEmotions(affect.emotions, at);
  for (const item of (result?.emotions ?? [])) {
    mergeEmotion(affect.emotions, { ...item, sourceEventId: eventId, appraisal: result?.appraisal ?? {} });
  }
  affect.emotions = affect.emotions
    .sort((a, b) => (Number(b.intensity) || 0) - (Number(a.intensity) || 0))
    .slice(0, Math.max(1, Number(DEFAULT_BRAIN_CONFIG.maxEmotions) || 12));

  const mood = affect.mood;
  const target = moodTarget(affect.emotions, mood);
  const smoothing = Number(DEFAULT_BRAIN_CONFIG.moodSmoothing) || 0.12;
  const recovery = Number(DEFAULT_BRAIN_CONFIG.moodRecovery) || 0.02;
  mood.valence = clampSigned(mood.valence * (1 - smoothing) + target.valence * smoothing, 0);
  mood.valence = clampSigned(mood.valence + (mood.valence > 0 ? -recovery : recovery) * (Math.abs(mood.valence) > 0.15 ? 1 : 0.3), 0);
  mood.arousal = clamp01(mood.arousal * (1 - smoothing) + target.arousal * smoothing, 0.45);
  mood.dominance = clamp01(mood.dominance * (1 - smoothing * 0.5) + (0.5 + (result?.appraisal?.control || 0.5) * 0.2) * smoothing * 0.5, 0.5);
  mood.attachment = clamp01(mood.attachment + (Number(result?.appraisal?.relationship) || 0) * 0.03, 0.55);

  const drift = Number(DEFAULT_BRAIN_CONFIG.needDrift) || 0.5;
  for (const key of NEED_KEYS) {
    const delta = Math.max(-6, Math.min(6, Number(result?.needsDelta?.[key]) || 0));
    affect.needs[key] = Math.min(100, Math.max(0, affect.needs[key] + delta * drift));
  }
  // 生理：每次交互消耗一点精力、累积一点疲劳；睡眠会恢复（后续模块负责）。
  affect.physiology.energy = Math.max(0, affect.physiology.energy - 0.3);
  affect.physiology.fatigue = Math.min(100, affect.physiology.fatigue + 0.4);

  next.updatedAt = iso(at);
  next.stats.lastMoodAt = iso(at);
  return next;
}

/** 周期性衰减（每分钟/每小时调用即可，不用每次事件都全量重算）。 */
export function decayBrainState(state, { now = Date.now() } = {}) {
  const at = Number(now) || Date.now();
  const next = JSON.parse(JSON.stringify(state));
  const before = next.affect.emotions.length;
  const beforeValence = Number(next.affect.mood.valence) || 0;
  const beforeArousal = Number(next.affect.mood.arousal) || 0.45;
  const beforeNeeds = { ...(next.affect.needs || {}) };
  const beforePhysiology = { ...(next.affect.physiology || {}) };
  next.affect.emotions = decayEmotions(next.affect.emotions, at);
  next.affect.mood.valence = clampSigned(next.affect.mood.valence * 0.98, 0);
  next.affect.mood.arousal = clamp01(next.affect.mood.arousal * 0.99 + 0.45 * 0.01, 0.45);

  // 同态调节：按距上次衰减的小时数向基线回落；夜晚让 rest 更高、social/curiosity 更低。
  const lastAt = Date.parse(String(next.stats?.lastDecayAt || next.updatedAt || '')) || at;
  const hours = Math.max(0, Math.min(72, (at - lastAt) / 3600000));
  const h = new Date(at).getHours();
  const night = h >= 22 || h < 7;
  const setpoints = DEFAULT_BRAIN_CONFIG.needSetpoints || {};
  const rates = DEFAULT_BRAIN_CONFIG.needRecoveryPerHour || {};
  const circ = DEFAULT_BRAIN_CONFIG.needCircadian || {};
  const needs = next.affect.needs || {};
  for (const key of NEED_KEYS) {
    const base = Number(setpoints[key] ?? 55);
    const target = base + (night ? Number(circ[key + 'Night'] || 0) : 0);
    const rate = Math.max(0.01, Number(rates[key] ?? 0.2));
    const alpha = 1 - Math.exp(-rate * hours);
    const cur = Number(needs[key] ?? base);
    needs[key] = Math.max(0, Math.min(100, cur + (target - cur) * alpha));
  }
  next.affect.needs = needs;
  const phys = next.affect.physiology || {};
  phys.energy = Math.max(0, Math.min(100, Number(phys.energy ?? 80) + 0.18 * hours));
  phys.fatigue = Math.max(0, Math.min(100, Number(phys.fatigue ?? 20) - 0.22 * hours));
  phys.hunger = Math.max(0, Math.min(100, Number(phys.hunger ?? 10) + 0.12 * hours));
  next.affect.physiology = phys;

  // 情绪数量不变也可能有强度/心境在衰减；只按数量判断会导致 maintenance 永不落盘。
  const changed = before !== next.affect.emotions.length
    || Math.abs(Number(next.affect.mood.valence) - beforeValence) > 1e-4
    || Math.abs(Number(next.affect.mood.arousal) - beforeArousal) > 1e-4
    || NEED_KEYS.some((k) => Math.abs(Number(needs[k]) - Number(beforeNeeds[k])) > 0.01)
    || Math.abs(Number(phys.energy) - Number(beforePhysiology.energy)) > 0.01
    || Math.abs(Number(phys.fatigue) - Number(beforePhysiology.fatigue)) > 0.01;
  next.stats.lastDecayAt = iso(at);
  next.updatedAt = iso(at);
  return { state: next, changed };
}

/** 给提示词/调试看的情绪摘要（中文、带原因）。 */
export function describeAffect(state, { now = Date.now() } = {}) {
  const at = Number(now) || Date.now();
  const emotions = decayEmotions(state?.affect?.emotions ?? [], at)
    .filter((e) => e.intensity >= 0.05)
    .slice(0, 4);
  const mood = state?.affect?.mood ?? { valence: 0, arousal: 0.45 };
  const emotionsText = emotions.length
    ? emotions.map((e) => (EMOTION_TYPES[e.type]?.label || e.type) + ' ' + Math.round(e.intensity * 100) + '%' + (e.cause ? '（' + e.cause + '）' : '')).join('；')
    : '暂时平静';
  const moodText = mood.valence > 0.2 ? '心境不错' : mood.valence < -0.2 ? '心境偏低' : '心境平稳';
  return '此刻心情：' + moodText + '；' + emotionsText;
}
