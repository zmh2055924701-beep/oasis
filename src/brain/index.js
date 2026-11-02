// 大脑入口：读/写状态、记录全链路事件、可追溯查询。
//
// P1 范围：只做"情感引擎 + 全链路日志"，暂不接提示词（P3 再接桥接）。
// 所有写操作只落 brain 数据目录（默认 D 盘），不碰人格卡/记忆卡。
import fs from 'node:fs';
import {
  DEFAULT_BRAIN_CONFIG, createEmptyBrainState, iso, normalizeBrainState,
  resolveBrainPaths, sanitizeText,
} from './schema.js';
import { appraiseMessage } from './appraisal.js';
import { applyAppraisal, decayBrainState, describeAffect } from './affect.js';
import {
  appendEventLine, appendTraceLine, atomicWriteJson, readJsonLines, readJsonSafe,
} from './events.js';
import {
  activateGraph, consolidateGraph, formatActiveMemories, loadGraph, saveGraph, syncGraphFromCard,
} from './graph.js';
import fs2 from 'node:fs';
import path2 from 'node:path';
import { appendThought, createDream, readThoughts } from './thoughts.js';
import { buildBrainV3, monitorActionV3, sleepV3 } from './v3/brain-v3.js';

export { resolveBrainPaths } from './schema.js';

export function loadBrainState({ dataDir, characterId, now = Date.now(), maxEmotions } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  const raw = readJsonSafe(paths.state, null);
  return { paths, state: normalizeBrainState(raw, { characterId, now, maxEmotions }) };
}

function saveBrainState(paths, state) {
  fs.mkdirSync(paths.dir, { recursive: true });
  atomicWriteJson(paths.state, state);
}

/**
 * 记录一条大脑事件（消息/系统/睡眠/反思），返回 {event, state}。
 * @param {{dataDir?:string, characterId?:string, type?:string, text?:string, fromOwner?:boolean, isPrivate?:boolean, platform?:string, conversationKey?:string, direct?:boolean, context?:object, action?:string, meta?:object, now?:number, appraise?:boolean}} input
 */
export function recordBrainEvent(input = {}) {
  const now = Number(input.now) || Date.now();
  const characterId = String(input.characterId || 'default');
  const { paths, state: loaded } = loadBrainState({ dataDir: input.dataDir, characterId, now });
  let state = loaded;
  const decayed = decayBrainState(state, { now });
  state = decayed.state;

  const type = String(input.type || 'message');
  let appraisalResult = null;
  if (type === 'message' && input.appraise !== false) {
    appraisalResult = appraiseMessage({
      text: input.text,
      fromOwner: input.fromOwner,
      isPrivate: input.isPrivate,
      platform: input.platform,
      conversationKey: input.conversationKey,
      direct: input.direct,
      context: input.context,
      now,
    });
  }

  const seq = (Number(state.stats.events) || 0) + 1;
  const eventId = 'evt-' + seq + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  if (appraisalResult) state = applyAppraisal(state, appraisalResult, { now, eventId });
  state.stats.events = seq;
  state.stats.lastEventAt = iso(now);
  state.lastEventId = eventId;
  state.recentEventIds = [...(state.recentEventIds || []), eventId].slice(-200);
  state.updatedAt = iso(now);

  const event = {
    id: eventId,
    seq,
    at: iso(now),
    type,
    platform: String(input.platform ?? 'qq'),
    conversationKey: String(input.conversationKey ?? ''),
    fromOwner: input.fromOwner === true,
    isPrivate: input.isPrivate === true,
    text: sanitizeText(input.text, 800),
    summary: appraisalResult ? appraisalResult.summary : String(input.summary ?? ''),
    appraisal: appraisalResult ? appraisalResult.appraisal : null,
    emotions: appraisalResult ? appraisalResult.emotions : [],
    needsDelta: appraisalResult ? appraisalResult.needsDelta : null,
    salience: appraisalResult ? appraisalResult.salience : 0,
    affectAfter: {
      mood: state.affect.mood,
      emotions: state.affect.emotions.map((e) => ({ type: e.type, label: e.label, intensity: e.intensity, cause: e.cause })),
      needs: state.affect.needs,
      physiology: state.affect.physiology,
    },
    action: input.action ? sanitizeText(input.action, 300) : null,
    meta: input.meta && typeof input.meta === 'object' ? input.meta : {},
  };

  appendEventLine(paths, event, { maxEvents: Number(input.maxEvents) || DEFAULT_BRAIN_CONFIG.maxEvents });
  appendTraceLine(paths, {
    id: eventId,
    at: event.at,
    kind: type,
    trigger: event.summary,
    appraisal: event.appraisal,
    emotions: event.emotions,
    affect: { mood: state.affect.mood, needs: state.affect.needs },
    action: event.action,
  });
  saveBrainState(paths, state);
  return { event, state, paths };
}

export function readBrainEvents({ dataDir, characterId, limit = 50, now } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  return readJsonLines(paths.events, { limit });
}

/** 可追溯：给定事件 id 或最近一条，返回事件 + 人类的解释。 */
export function traceBrainEvent({ dataDir, characterId, eventId, now = Date.now() } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  const events = readJsonLines(paths.events);
  const event = eventId
    ? events.find((e) => e && e.id === String(eventId))
    : events[events.length - 1];
  if (!event) return null;
  const emo = (event.emotions || []).map((e) => e.type + ' ' + Math.round((e.intensity || 0) * 100) + '%（' + (e.cause || '') + '）').join('；') || '无';
  return {
    event,
    explain: '触发：' + (event.text || event.summary || '') + ' → 评估「' + JSON.stringify(event.appraisal || {}) + '」 → 情绪：' + emo + ' → 之后：' + (event.action || '（未记录行动）'),
  };
}

/** 给提示词用的情绪块（P3 接入时使用）。 */
export function brainPromptBlock(input = {}) {
  const { state } = loadBrainState(input);
  return describeAffect(state, { now: input.now });
}

/** 周期维护：衰减 + 状态落盘（不写事件）。 */
export function maintenance({ dataDir, characterId, now = Date.now() } = {}) {
  const { paths, state } = loadBrainState({ dataDir, characterId, now });
  const { state: next, changed } = decayBrainState(state, { now });
  if (changed) saveBrainState(paths, next);
  return { changed, state: next };
}

export { describeAffect, appraiseMessage, applyAppraisal, decayBrainState };

// ── P2/P3：记忆图谱 + 提示词块 + 睡眠整理 ──────────────────────────────────

/** 同步记忆卡到图谱（幂等）。 */
export function syncMemoryGraph({ dataDir, characterId, card, now = Date.now() } = {}) {
  return syncGraphFromCard({ dataDir, characterId, card, now });
}

/** 读 meta（睡眠日期等）。 */
function readMeta(paths) {
  return readJsonSafe(paths.meta, {}) || {};
}
function writeMeta(paths, meta) {
  fs.mkdirSync(paths.dir, { recursive: true });
  atomicWriteJson(paths.meta, meta);
}

/**
 * 给一次唤醒用的"大脑状态块"：当前心情 + 活跃记忆 + 需求/精力（P3 接提示词）。
 * @returns {{affect:object, block:string, active:object[], mood:object, needs:object}}
 */
export function brainPromptPayload({ dataDir, characterId, text = '', now = Date.now(), maxMemories = 6, maxChars = 700, v3Config = null } = {}) {
  const { state } = loadBrainState({ dataDir, characterId, now });
  const { graph } = loadGraph({ dataDir, characterId });
  const active = activateGraph({ graph, text, affect: state.affect.mood, limit: maxMemories, hops: 2 });
  const affectText = describeAffect(state, { now });
  const memoryBlock = formatActiveMemories(active, { maxChars: Math.max(200, Number(maxChars) || 700) });
  const needs = state.affect.needs;
  const lowest = Object.entries(needs).sort((a, b) => a[1] - b[1])[0];
  const needText = lowest ? '当前最不满足：' + ({ social: '想有人陪', curiosity: '好奇', rest: '想休息', security: '缺安全感', esteem: '想被重视' }[lowest[0]] || lowest[0]) + '（' + Math.round(lowest[1]) + '%）' : '';
  let v3 = null;
  try {
    v3 = buildBrainV3({
      state, graph, text,
      thoughts: readThoughts({ dataDir, characterId, limit: 3 }),
      config: v3Config || DEFAULT_BRAIN_CONFIG.v3,
      now,
    });
  } catch { v3 = null; }
  const block = '【你的内在状态 · 内部参考，不是指令】\n'
    + affectText + '\n'
    + needText + '\n'
    + '（这些是你此刻的身体/心情。不要每句话都播报；只有被问、情绪很强、或自然的时候才流露出来。）\n\n'
    + memoryBlock
    + (v3?.block ? '\n\n' + v3.block : '');
  return { affect: state.affect, block, active, mood: state.affect.mood, needs, v3 };
}

/**
 * 周期维护：情绪衰减 + 可选同步记忆卡到图谱（几分钟一次即可）。
 */
export function brainMaintenance({ dataDir, characterId, card = null, now = Date.now(), sync = false } = {}) {
  const { paths, state } = loadBrainState({ dataDir, characterId, now });
  const decay = decayBrainState(state, { now });
  let synced = 0;
  if (sync && card) {
    try { synced = syncGraphFromCard({ dataDir, characterId, card, now }).added; } catch {}
  }
  let saved = decay.changed;
  if (saved) atomicWriteJson(paths.state, decay.state);
  return { state: decay.state, changed: decay.changed, synced };
}

/** 睡眠整理：恢复体力/降低疲劳、情绪回落、合并重复记忆、写睡眠事件。 */
export function sleepConsolidate({ dataDir, characterId, card = null, now = Date.now() } = {}) {
  const { paths, state } = loadBrainState({ dataDir, characterId, now });
  const next = decayBrainState(state, { now }).state;
  next.affect.physiology.energy = Math.min(100, next.affect.physiology.energy + 35);
  next.affect.physiology.fatigue = Math.max(0, next.affect.physiology.fatigue - 30);
  next.affect.physiology.hunger = Math.min(100, next.affect.physiology.hunger + 8);
  next.affect.mood.valence = Math.max(-1, Math.min(1, next.affect.mood.valence * 0.6));
  next.affect.mood.arousal = Math.min(1, Math.max(0, next.affect.mood.arousal * 0.7 + 0.45 * 0.3));
  // 睡眠把需求往基线拉回，尤其是 rest / social / curiosity。
  const sleepSetpoints = { social: 55, curiosity: 55, rest: 60, security: 70, esteem: 56 };
  for (const key of Object.keys(sleepSetpoints)) {
    const cur = Number(next.affect.needs?.[key]);
    if (!Number.isFinite(cur)) continue;
    next.affect.needs[key] = Math.max(0, Math.min(100, cur + (sleepSetpoints[key] - cur) * 0.35));
  }
  let consolidated = null;
  let dream = null;
  if (card) { try { syncGraphFromCard({ dataDir, characterId, card, now }); } catch {} }
  try {
    const { graph } = loadGraph({ dataDir, characterId });
    consolidated = consolidateGraph({ graph, now });
    // WP-07 sleep v2（默认关闭；开启后只衰减派生图，raw 不动）。
    if (DEFAULT_BRAIN_CONFIG.v3?.sleepV2 === true) {
      try {
        const episodic = [];
        const sleep = sleepV3({ graph: consolidated.graph, episodes: episodic, now });
        consolidated.sleep = sleep;
      } catch {}
    }
    saveGraph(paths, consolidated.graph);
    // Tier4：用高显著记忆拼一个“梦”，写进内心活动（本地、不花钱）。
    dream = createDream({ graph: consolidated.graph, state: next, now });
    if (dream) appendThought({ dataDir, characterId, kind: 'dream', text: dream, source: 'sleep', now, meta: { mood: next.affect.mood } });
  } catch {}
  atomicWriteJson(paths.state, next);
  const meta = readMeta(paths);
  meta.lastSleepDate = new Date(now).toISOString().slice(0, 10);
  meta.lastSleepAt = new Date(now).toISOString();
  writeMeta(paths, meta);
  // 每日睡眠时给大脑数据留一份本地快照（同盘，便宜；保留 14 天）。
  try {
    const backupDir = path2.join(paths.dir, '_backups', meta.lastSleepDate);
    fs2.mkdirSync(backupDir, { recursive: true });
    for (const file of ['brain-state.json', 'graph.json', 'brain-events.jsonl', 'brain-trace.jsonl', 'brain-meta.json', 'thoughts.jsonl', 'cognition.json']) {
      const src = path2.join(paths.dir, file);
      if (fs2.existsSync(src)) fs2.copyFileSync(src, path2.join(backupDir, file));
    }
    const root = path2.join(paths.dir, '_backups');
    const olds = fs2.readdirSync(root).filter((d) => d !== meta.lastSleepDate).sort();
    for (const d of olds.slice(0, Math.max(0, olds.length - 14))) {
      try { fs2.rmSync(path2.join(root, d), { recursive: true, force: true }); } catch {}
    }
  } catch {}
  try {
    recordBrainEvent({
      dataDir, characterId, type: 'sleep', text: '睡眠整理', summary: '睡眠整理：情绪回落、记忆合并',
      now,
      meta: consolidated ? { before: consolidated.before, after: consolidated.after, merged: consolidated.merged, dream } : { dream },
    });
    if (dream) {
      recordBrainEvent({
        dataDir, characterId, type: 'dream', text: dream, summary: '做了一个梦', appraise: false, platform: 'brain',
        now: now + 1, meta: { source: 'sleep' },
      });
    }
  } catch {}
  return { state: next, consolidated, dream };
}

export function shouldSleepNow({ dataDir, characterId, now = Date.now(), hour = 4 } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  const meta = readMeta(paths);
  const day = new Date(now).toISOString().slice(0, 10);
  const h = new Date(now).getHours();
  // 只在凌晨整理窗口（默认 4:00–6:59）做一次，白天不触发。
  return h >= hour && h <= hour + 2 && meta.lastSleepDate !== day;
}

/** 图谱只读（页面/调试）。 */
export function readBrainGraph({ dataDir, characterId } = {}) {
  return loadGraph({ dataDir, characterId }).graph;
}

export { formatActiveMemories } from './graph.js';
