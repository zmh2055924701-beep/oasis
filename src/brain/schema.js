// 她的大脑：共享 schema / 默认值 / 路径。
//
// 数据放 D 盘（用户 C 盘紧张）：默认 state/brain/<characterId>/
//   brain-state.json   当前快照（情绪/心境/需求/生理/统计）
//   brain-events.jsonl 全链路事件（感知→评估→情绪→行动→反思，可追溯）
// 这个模块本身不写真实记忆卡，也不改人格卡；只是给大脑层提供状态定义。
import fs from 'node:fs';
import path from 'node:path';

export const BRAIN_VERSION = 1;

export const DEFAULT_BRAIN_CONFIG = Object.freeze({
  enabled: false, // 集成到桥接前默认关闭；P3 接入后再打开
  dataDir: 'state/brain',
  maxEvents: 20000, // 事件日志超过这个条数时截断尾部（保留最近）
  maxEmotions: 12,
  moodSmoothing: 0.12, // 心境基线 EMA 系数
  moodRecovery: 0.02, // 每次更新向 0 回归的步长
  needDrift: 0.5, // 每次事件需求脉冲上限
  // 需求不是只涨不跌的进度条：每个需求有基线，并按小时回到基线。
  needSetpoints: { social: 58, curiosity: 60, rest: 48, security: 70, esteem: 56 },
  needRecoveryPerHour: { social: 0.22, curiosity: 0.28, rest: 0.35, security: 0.16, esteem: 0.18 },
  needCircadian: { restNight: 10, socialNight: -6, curiosityNight: -8 },
  traceLimit: 200,
  // Brain v3 Phase A: prompt/context layers, no forced action.
  v3: {
    enabled: true, hela: true, workspace: true, mirror: true, metaAwareness: true,
    mapMonitor: 'shadow', plan: false, composition: false, sleepV2: false, cmrReplay: false,
    maxWorkspace: 5, maxNarrativeChars: 900, confidenceFloor: 0.45,
  },
});

export const EMOTION_TYPES = Object.freeze({
  joy: { label: '开心', valence: 1, arousal: 0.6 },
  warm: { label: '温暖', valence: 0.85, arousal: 0.35 },
  shy: { label: '害羞', valence: 0.7, arousal: 0.55 },
  pride: { label: '得意', valence: 0.8, arousal: 0.5 },
  curiosity: { label: '好奇', valence: 0.4, arousal: 0.65 },
  calm: { label: '安心', valence: 0.6, arousal: 0.2 },
  lonely: { label: '孤单', valence: -0.6, arousal: 0.35 },
  sad: { label: '失落', valence: -0.75, arousal: 0.3 },
  wronged: { label: '委屈', valence: -0.7, arousal: 0.5 },
  angry: { label: '生气', valence: -0.6, arousal: 0.8 },
  anxious: { label: '紧张', valence: -0.5, arousal: 0.75 },
  hurt: { label: '心疼', valence: -0.4, arousal: 0.5 },
});

export const NEED_KEYS = Object.freeze(['social', 'curiosity', 'rest', 'security', 'esteem']);
export const NEED_LABEL = Object.freeze({ social: '陪伴', curiosity: '好奇', rest: '休息', security: '安全感', esteem: '被重视' });

export function clamp01(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback;
}

export function clampSigned(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(-1, n)) : fallback;
}

export function iso(now = Date.now()) {
  return new Date(Number(now) || Date.now()).toISOString();
}

/** 数据目录解析：显式 dataDir > 环境变量 OASIS_BRAIN_DIR > 默认 D 盘。 */
export function resolveBrainDir({ dataDir, characterId } = {}) {
  const root = String(dataDir || process.env.OASIS_BRAIN_DIR || DEFAULT_BRAIN_CONFIG.dataDir).trim()
    || DEFAULT_BRAIN_CONFIG.dataDir;
  const id = String(characterId || 'default').replace(/[^\w.-]/g, '_').slice(0, 80);
  return path.join(root, id);
}

export function resolveBrainPaths(options = {}) {
  const dir = resolveBrainDir(options);
  return {
    dir,
    state: path.join(dir, 'brain-state.json'),
    events: path.join(dir, 'brain-events.jsonl'),
    trace: path.join(dir, 'brain-trace.jsonl'),
    meta: path.join(dir, 'brain-meta.json'),
  };
}

export function ensureBrainDir(paths) {
  fs.mkdirSync(paths.dir, { recursive: true });
  return paths;
}

export function createEmptyBrainState(characterId = 'default', now = Date.now()) {
  return {
    version: BRAIN_VERSION,
    characterId: String(characterId || 'default'),
    createdAt: iso(now),
    updatedAt: iso(now),
    affect: {
      mood: { valence: 0, arousal: 0.45, dominance: 0.5, attachment: 0.55 },
      emotions: [],
      needs: { social: 50, curiosity: 60, rest: 55, security: 70, esteem: 55 },
      physiology: { energy: 80, fatigue: 20, hunger: 10 },
    },
    stats: { events: 0, lastEventAt: null, lastDecayAt: null, lastMoodAt: null },
    lastEventId: null,
    recentEventIds: [],
  };
}

export function normalizeEmotion(raw, now = Date.now()) {
  const type = String(raw?.type ?? '');
  const meta = EMOTION_TYPES[type];
  const intensity = clamp01(raw?.intensity, 0);
  if (!meta || intensity <= 0) return null;
  const createdAt = Date.parse(String(raw?.createdAt ?? '')) || Number(now);
  const halfLifeMs = Math.max(60000, Number(raw?.halfLifeMs) || 3 * 60 * 60 * 1000);
  return {
    id: String(raw?.id ?? type + '-' + createdAt),
    type,
    label: meta.label,
    valence: clampSigned(raw?.valence, meta.valence),
    arousal: clamp01(raw?.arousal, meta.arousal),
    intensity,
    halfLifeMs,
    createdAt: iso(createdAt),
    sourceEventId: String(raw?.sourceEventId ?? ''),
    cause: String(raw?.cause ?? '').slice(0, 200),
    appraisal: raw && typeof raw.appraisal === 'object' && !Array.isArray(raw.appraisal) ? raw.appraisal : {},
  };
}

export function normalizeBrainState(raw, { characterId = 'default', now = Date.now(), maxEmotions = 12 } = {}) {
  const base = createEmptyBrainState(characterId, now);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const affect = raw.affect && typeof raw.affect === 'object' ? raw.affect : {};
  const mood = affect.mood && typeof affect.mood === 'object' ? affect.mood : {};
  const needs = affect.needs && typeof affect.needs === 'object' ? affect.needs : {};
  const physiology = affect.physiology && typeof affect.physiology === 'object' ? affect.physiology : {};
  const emotions = (Array.isArray(affect.emotions) ? affect.emotions : [])
    .map((item) => normalizeEmotion(item, now))
    .filter(Boolean)
    .slice(-Math.max(1, Number(maxEmotions) || 12));
  return {
    ...base,
    ...raw,
    version: BRAIN_VERSION,
    characterId: String(characterId || raw.characterId || 'default'),
    affect: {
      mood: {
        valence: clampSigned(mood.valence, 0),
        arousal: clamp01(mood.arousal, 0.45),
        dominance: clamp01(mood.dominance, 0.5),
        attachment: clamp01(mood.attachment, 0.55),
      },
      emotions,
      needs: Object.fromEntries(NEED_KEYS.map((k) => {
        const value = Number(needs[k]);
        return [k, Math.min(100, Math.max(0, Number.isFinite(value) ? value : base.affect.needs[k]))];
      })),
      physiology: {
        energy: Math.min(100, Math.max(0, Number(physiology.energy ?? base.affect.physiology.energy))),
        fatigue: Math.min(100, Math.max(0, Number(physiology.fatigue ?? base.affect.physiology.fatigue))),
        hunger: Math.min(100, Math.max(0, Number(physiology.hunger ?? base.affect.physiology.hunger))),
      },
    },
    stats: { ...base.stats, ...(raw.stats && typeof raw.stats === 'object' ? raw.stats : {}) },
    lastEventId: raw.lastEventId ? String(raw.lastEventId) : null,
    recentEventIds: Array.isArray(raw.recentEventIds) ? raw.recentEventIds.map(String).slice(-200) : [],
  };
}

export function sanitizeText(value, limit = 600) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(limit) || 1));
}
