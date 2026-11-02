// 本地认知时钟（P2 第一步）：让她"感知真实时间"，并形成一个轻量的工作空间焦点。
//
// 只做本地计算，不调 LLM、不写人格/记忆卡；数据落 brain/cognition.json。
// 真正的内心独白（Tier 2）以后接。
import fs from 'node:fs';
import path from 'node:path';
import { resolveBrainPaths } from './schema.js';
import { atomicWriteJson, readJsonSafe } from './events.js';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PERIODS = [
  { from: 0, to: 4, name: '深夜', hint: '很晚了，容易困，别硬撑' },
  { from: 5, to: 6, name: '凌晨', hint: '天还没亮，安静，适合发呆/睡觉' },
  { from: 7, to: 8, name: '早晨', hint: '刚醒，脑子慢慢转起来' },
  { from: 9, to: 11, name: '上午', hint: '白天，注意力比较集中' },
  { from: 12, to: 13, name: '中午', hint: '午饭时间，容易饿' },
  { from: 14, to: 17, name: '下午', hint: '下午，容易犯困或走神' },
  { from: 18, to: 19, name: '傍晚', hint: '天快黑了，晚饭时间' },
  { from: 20, to: 22, name: '晚上', hint: '晚上，适合聊天、放松' },
  { from: 23, to: 23, name: '深夜', hint: '很晚了，该收一收了' },
];

export function periodOf(now) {
  const h = new Date(now).getHours();
  return PERIODS.find((p) => h >= p.from && h <= p.to) || PERIODS[0];
}

export function formatClock(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 '
    + WEEKDAYS[d.getDay()] + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function formatGap(ms) {
  if (Number(ms) < 60_000) return '不到 1 分钟';
  const min = Math.max(1, Math.round(Number(ms) / 60000));
  if (min < 60) return min + ' 分钟';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return h + ' 小时' + (m ? ' ' + m + ' 分钟' : '');
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d + ' 天' + (rh ? ' ' + rh + ' 小时' : '');
}

/** 真实时间信号：现在几点、星期几、时段、距上次人类说话多久、距上次 tick 多久（离线空档）。 */
export function timeSignals({ now = Date.now(), lastInteractionAt = 0, lastTickAt = 0, lastThoughtAt = 0 } = {}) {
  const period = periodOf(now);
  const d = new Date(now);
  const h = d.getHours();
  return {
    at: new Date(now).toISOString(),
    clock: formatClock(now),
    date: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'),
    weekday: WEEKDAYS[d.getDay()],
    hour: h,
    period: period.name,
    hint: period.hint,
    isLateNight: h >= 23 || h < 6,
    isSleepWindow: h >= 4 && h < 7,
    sinceInteractionMs: lastInteractionAt ? Math.max(0, now - Number(lastInteractionAt)) : 0,
    sinceInteractionText: lastInteractionAt ? formatGap(now - Number(lastInteractionAt)) : '还不知道（没有记录）',
    sinceTickMs: lastTickAt ? Math.max(0, now - Number(lastTickAt)) : 0,
    sinceTickText: lastTickAt ? formatGap(now - Number(lastTickAt)) : '第一次 tick',
    sinceThoughtMs: lastThoughtAt ? Math.max(0, now - Number(lastThoughtAt)) : 0,
    sinceThoughtText: lastThoughtAt ? formatGap(now - Number(lastThoughtAt)) : '还没想过',
    offlineGapMs: lastTickAt ? Math.max(0, now - Number(lastTickAt)) : 0,
    offlineGapMin: lastTickAt ? Math.round(Math.max(0, now - Number(lastTickAt)) / 60000) : 0,
  };
}

function cognitionFile() {
  const paths = resolveBrainPaths({});
  return path.join(paths.dir, 'cognition.json');
}

export function readCognition({ dataDir, characterId } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  return readJsonSafe(path.join(paths.dir, 'cognition.json'), null);
}

function saveCognition({ dataDir, characterId }, value) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  fs.mkdirSync(paths.dir, { recursive: true });
  atomicWriteJson(path.join(paths.dir, 'cognition.json'), value);
}

const NEED_LABEL = { social: '想有人陪', curiosity: '好奇', rest: '想休息', security: '缺安全感', esteem: '想被重视' };

/**
 * 本地认知 tick（Tier 0/1）：不调 LLM。
 * - 更新真实时间信号、离线空档；
 * - 从需求/心情/时间里选出“此刻注意力”；
 * - 记录 idleSince / tick 计数，供 Tier 2 内心独白用。
 */
export function cognitiveTick({ dataDir, characterId, now = Date.now(), lastInteractionAt = 0, lastThoughtAt = 0, state = null } = {}) {
  const prev = readCognition({ dataDir, characterId }) || {};
  const signals = timeSignals({ now, lastInteractionAt, lastTickAt: prev.lastTickAt, lastThoughtAt: prev.lastThoughtAt });
  const affect = state?.affect ?? {};
  const needs = affect.needs ?? {};
  const mood = affect.mood ?? {};
  const lowest = Object.entries(needs).sort((a, b) => a[1] - b[1])[0];
  const lowKey = lowest ? lowest[0] : 'social';
  const lowVal = lowest ? Math.round(Number(lowest[1]) || 0) : 0;
  let focus;
  if (signals.offlineGapMin >= 10 && lastInteractionAt) {
    focus = { kind: 'reunion', label: '想知道这段时间发生了什么', reason: '离线了 ' + signals.sinceTickText };
  } else if (signals.isLateNight) {
    focus = { kind: 'rest', label: '有点困了，想安静一下', reason: signals.period };
  } else if (lowest && Number(lowest[1]) < 55) {
    focus = { kind: 'need:' + lowKey, label: NEED_LABEL[lowKey] || lowKey, reason: '需求最低：' + lowVal };
  } else {
    focus = { kind: 'ambient', label: '没什么特别的事，随便想想', reason: signals.period };
  }
  const next = {
    version: 1,
    characterId: String(characterId || prev.characterId || 'default'),
    createdAt: prev.createdAt || new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    lastTickAt: now,
    lastThoughtAt: Number(lastThoughtAt) || prev.lastThoughtAt || 0,
    idleSince: prev.idleSince || (lastInteractionAt ? now : prev.idleSince || now),
    ticks: (Number(prev.ticks) || 0) + 1,
    focus,
    time: {
      clock: signals.clock,
      period: signals.period,
      weekday: signals.weekday,
      isLateNight: signals.isLateNight,
      sinceInteractionText: signals.sinceInteractionText,
      offlineGapMin: signals.offlineGapMin,
    },
    mood: { valence: Number(mood.valence) || 0, arousal: Number(mood.arousal) || 0 },
  };
  saveCognition({ dataDir, characterId }, next);
  return { cognition: next, signals };
}

/** 给提示词的真实时间块：让她知道“现在到底是什么时候”。 */
export function cognitionPromptBlock({ dataDir, characterId, now = Date.now(), lastInteractionAt = 0 } = {}) {
  const cog = readCognition({ dataDir, characterId }) || {};
  const signals = timeSignals({ now, lastInteractionAt, lastTickAt: cog.lastTickAt, lastThoughtAt: cog.lastThoughtAt });
  const lines = [
    '【时间感 · 真实时间，内部参考】',
    '现在是 ' + signals.clock + '（' + signals.period + '）。' + (signals.hint ? ' ' + signals.hint + '。' : ''),
    lastInteractionAt ? '你上次和人类说话是 ' + signals.sinceInteractionText + '前。' : '你还没有和人类说过话。',
    signals.offlineGapMin >= 10 ? '你刚刚离开了约 ' + signals.sinceTickText + '，这段时间你没有感知到外面。' : '',
    cog.focus && cog.focus.label ? '此刻注意力：' + cog.focus.label + '。' : '',
    '时间是你自己知道的，不要问“现在几点”；但也不用每句都报时。',
  ].filter(Boolean);
  return lines.join('\n') + '\n\n';
}
