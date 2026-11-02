// 大脑分区（2026-10-30）：把记忆图谱/状态映射到“前额叶/海马体/杏仁核…”等脑区，供 UI 和后续认知层使用。
import { sanitizeText } from './schema.js';

export const BRAIN_REGIONS = [
  { id: 'prefrontal', name: '前额叶', en: 'Prefrontal', desc: '目标、计划、自控', types: ['self', 'goal', 'plan', 'promise'], color: '#ffd166' },
  { id: 'hippocampus', name: '海马体', en: 'Hippocampus', desc: '记忆编码与回放', types: ['episode'], color: '#63e2ff' },
  { id: 'amygdala', name: '杏仁核', en: 'Amygdala', desc: '情绪与威胁', types: ['emotion'], color: '#ff7b9c' },
  { id: 'insula', name: '岛叶', en: 'Insula', desc: '生理状态与需求', types: ['need', 'physiology'], color: '#8affc1' },
  { id: 'dmn', name: '默认模式网络', en: 'DMN', desc: '发呆、走神、自我叙事', types: ['thought', 'self'], color: '#b28cff' },
  { id: 'temporal', name: '颞叶', en: 'Temporal', desc: '语义、知识、话题', types: ['topic'], color: '#7cc4ff' },
  { id: 'social', name: '社会认知', en: 'Social', desc: '关系、心智理论', types: ['person'], color: '#f5c56b' },
  { id: 'parietal', name: '顶叶', en: 'Parietal', desc: '注意力与空间', types: [], color: '#9fb7d9' },
  { id: 'occipital', name: '枕叶', en: 'Occipital', desc: '视觉画面与 B 站', types: ['media'], color: '#9ee37d' },
  { id: 'broca', name: '布罗卡区', en: "Broca's", desc: '表达与说话风格', types: ['expression'], color: '#ffb86b' },
  { id: 'cerebellum', name: '小脑', en: 'Cerebellum', desc: '习惯与节奏', types: ['habit'], color: '#5fd6c0' },
  { id: 'brainstem', name: '脑干', en: 'Brainstem', desc: '基础唤醒与精力', types: ['wake'], color: '#8fa3c7' },
];

export function regionMeta(regionId) {
  return BRAIN_REGIONS.find((r) => r.id === regionId) || BRAIN_REGIONS[0];
}

function nodeTags(node) {
  const tags = Array.isArray(node?.tags) ? node.tags : [];
  return tags.map((t) => String(t).toLowerCase());
}

/** 节点 → 脑区。记忆按 scope 分到海马体/枕叶（B站画面），人等按类型分。 */
export function regionOfNode(node) {
  const type = String(node?.type || 'episode');
  if (type === 'episode') {
    const scope = String(node?.scope || '').toLowerCase();
    const tags = nodeTags(node);
    if (scope === 'bili' || tags.includes('bili') || tags.includes('b站')) return 'occipital';
    return 'hippocampus';
  }
  if (type === 'person') return 'social';
  if (type === 'topic') return 'temporal';
  if (type === 'emotion') return 'amygdala';
  if (type === 'self') return 'prefrontal';
  if (type === 'goal' || type === 'plan' || type === 'promise') return 'prefrontal';
  if (type === 'thought') return 'dmn';
  if (type === 'media') return 'occipital';
  if (type === 'need' || type === 'physiology') return 'insula';
  if (type === 'expression') return 'broca';
  if (type === 'habit') return 'cerebellum';
  if (type === 'wake') return 'brainstem';
  return 'hippocampus';
}

export function decorateGraph(graph) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []).map((node) => ({ ...node, region: regionOfNode(node) }));
  return { ...graph, nodes };
}

export function regionNodes(graph, regionId) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : []).filter((node) => regionOfNode(node) === regionId);
  const ids = new Set(nodes.map((n) => n.id));
  const edges = (Array.isArray(graph?.edges) ? graph.edges : []).filter((e) => ids.has(e.from) || ids.has(e.to));
  return { nodes, edges };
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0) / values.length;
}

/** 每个脑区的节点数 / 活跃度 / 最近事件数 / 状态指标。 */
export function buildRegionStats({ graph, state, events = [], now = Date.now(), hours = 24 } = {}) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const recentCut = now - Math.max(1, Number(hours) || 24) * 3600_000;
  const recentEvents = (Array.isArray(events) ? events : []).filter((e) => {
    const t = Date.parse(e?.at);
    return Number.isFinite(t) && t >= recentCut;
  });
  const affect = state?.affect ?? {};
  const mood = affect.mood ?? { valence: 0, arousal: 0.3 };
  const needs = affect.needs ?? {};
  const phys = affect.physiology ?? {};
  return BRAIN_REGIONS.map((region) => {
    const list = nodes.filter((node) => regionOfNode(node) === region.id);
    const active = list.filter((node) => Number(node.activation) > 0).length;
    const importance = avg(list.map((node) => Number(node.importance) || 0));
    const values = Object.values(needs).map((v) => Number(v) || 0);
    let eventCount = 0;
    if (region.id === 'hippocampus' || region.id === 'occipital') {
      eventCount = recentEvents.filter((e) => e.type === 'message').length;
    } else if (region.id === 'amygdala') {
      eventCount = recentEvents.filter((e) => Array.isArray(e.emotions) && e.emotions.length).length;
    } else if (region.id === 'dmn') {
      eventCount = recentEvents.filter((e) => e.type === 'thought' || e.type === 'sleep').length;
    }
    const stats = {
      id: region.id,
      name: region.name,
      en: region.en,
      desc: region.desc,
      color: region.color,
      nodeCount: list.length,
      activeCount: active,
      importanceAvg: Math.round(importance),
      eventCount,
      activity: Math.max(0, Math.min(1,
        0.15 + list.length / Math.max(1, nodes.length) * 1.4 + active * 0.02 + eventCount * 0.01)),
      metrics: {},
    };
    if (region.id === 'insula') {
      stats.metrics = {
        陪伴: Math.round(Number(needs.social) || 0),
        好奇: Math.round(Number(needs.curiosity) || 0),
        休息: Math.round(Number(needs.rest) || 0),
        安全感: Math.round(Number(needs.security) || 0),
        被重视: Math.round(Number(needs.esteem) || 0),
      };
    } else if (region.id === 'brainstem') {
      stats.metrics = { 精力: Math.round(Number(phys.energy) || 0), 疲劳: Math.round(Number(phys.fatigue) || 0), 饥饿: Math.round(Number(phys.hunger) || 0) };
    } else if (region.id === 'amygdala') {
      const emotions = (affect.emotions ?? []).filter((e) => Number(e.intensity) >= 0.03);
      stats.metrics = {
        心境: Math.round((Number(mood.valence) || 0) * 100),
        唤醒: Math.round((Number(mood.arousal) || 0) * 100),
        强烈情绪: emotions.length,
      };
      stats.emotionList = emotions.slice(0, 5).map((e) => ({ type: e.type, label: e.label, intensity: e.intensity }));
    } else if (region.id === 'dmn') {
      stats.metrics = { 内心活动: recentEvents.filter((e) => e.type === 'thought').length, 自我节点: list.filter((n) => n.type === 'self').length };
    } else if (region.id === 'prefrontal') {
      stats.metrics = { 目标节点: list.filter((n) => ['goal', 'plan', 'promise'].includes(n.type)).length, 重要记忆: list.filter((n) => Number(n.importance) >= 70).length };
    } else if (region.id === 'temporal') {
      stats.metrics = { 话题数: list.length, 重要度均值: Math.round(importance) };
    } else if (region.id === 'social') {
      stats.metrics = { 认识的人: list.length, 关系节点: list.filter((n) => n.importance >= 70).length };
    } else if (region.id === 'parietal' || region.id === 'cerebellum' || region.id === 'broca') {
      stats.metrics = { 节点数: list.length, 活跃: active };
    }
    return stats;
  });
}

/** 心情时间序列：从 brain-events.jsonl 的 affectAfter 里取点，末点补当前状态。 */
export function buildMoodSeries({ events = [], state = null, hours = 24, maxPoints = 120, now = Date.now() } = {}) {
  const since = now - Math.max(1, Number(hours) || 24) * 3600_000;
  const points = [];
  for (const e of Array.isArray(events) ? events : []) {
    const t = Date.parse(e?.at);
    const mood = e?.affectAfter?.mood;
    if (!Number.isFinite(t) || t < since || !mood) continue;
    points.push({ t, valence: Number(mood.valence) || 0, arousal: Number(mood.arousal) || 0 });
  }
  points.sort((a, b) => a.t - b.t);
  if (!points.length && state?.affect?.mood) {
    points.push({ t: now, valence: Number(state.affect.mood.valence) || 0, arousal: Number(state.affect.mood.arousal) || 0 });
  }
  const limit = Math.max(2, Number(maxPoints) || 120);
  const sampled = [];
  const step = Math.max(1, Math.ceil(points.length / limit));
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  if (points.length && sampled[sampled.length - 1].t !== points[points.length - 1].t) sampled.push(points[points.length - 1]);
  return {
    hours: Math.max(1, Number(hours) || 24),
    points: sampled.map((p) => ({ t: p.t, at: new Date(p.t).toISOString(), valence: Math.round(p.valence * 1000) / 1000, arousal: Math.round(p.arousal * 1000) / 1000 })),
    count: points.length,
  };
}

export function regionPromptLine(state) {
  const needs = state?.affect?.needs ?? {};
  const phys = state?.affect?.physiology ?? {};
  const low = Object.entries(needs).sort((a, b) => a[1] - b[1])[0];
  return sanitizeText('此刻脑区：前额叶/海马体/杏仁核/岛叶/默认模式网络；最低需求 ' + (low ? low[0] + ' ' + Math.round(low[1]) : '未知') + '；精力 ' + Math.round(Number(phys.energy) || 0), 200);
}
