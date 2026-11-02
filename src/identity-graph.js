// 身份知识图（P5）：从身份事件/动作 episode 构建时间感知图；
// 事件是主节点，身体/话题实体/技能是连接节点；用于跨身体检索与 prompt 摘要。
import fs from 'node:fs';
import path from 'node:path';
import { resolveIdentityPaths, loadIdentityState, identityEventAllowed } from './identity-core.js';

const MAX_EVENTS = 600;
const MAX_EPISODES = 300;

function readJsonlTail(file, limit) {
  try {
    if (!fs.existsSync(file)) return [];
    const stat = fs.statSync(file);
    const bytes = Math.min(stat.size, 2 * 1024 * 1024);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, stat.size - bytes);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').filter(Boolean).slice(-Math.max(1, limit)).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

function tokenize(text) {
  const s = String(text || '');
  const tokens = new Set();
  for (const m of s.matchAll(/[A-Za-z][A-Za-z0-9_./:-]{1,40}|[\u4e00-\u9fa5]{2,8}/g)) {
    const t = m[0].trim();
    if (t && t.length >= 2 && !['这个', '那个', '什么', '我们', '你们', '他们', '现在', '已经', '可以', '一个'].includes(t)) tokens.add(t.slice(0, 24));
  }
  return [...tokens].slice(0, 12);
}

function bodyLabel(body) {
  const s = String(body || '');
  if (s.startsWith('group:')) return '群';
  if (s.startsWith('private:')) return '私聊';
  if (s.startsWith('pet')) return '桌宠';
  if (s.startsWith('bili')) return 'B站';
  if (s.startsWith('desktop')) return '电脑';
  return '系统';
}

function actionTargetName(target) {
  const s = String(target || '').replace(/[\\/]+$/, '');
  if (!s) return '';
  const parts = s.split(/[\\/]/);
  return parts[parts.length - 1].slice(0, 60);
}

export function buildIdentityGraph({ dataDir, characterId, operatorDir = null, audience = 'private', now = Date.now(), query = '' } = {}) {
  const paths = resolveIdentityPaths({ dataDir, characterId });
  const state = loadIdentityState({ dataDir, characterId }).state;
  let events = readJsonlTail(paths.events, MAX_EVENTS);
  if (!events.length) events = state.recentEvents || [];
  events = events.filter((e) => identityEventAllowed(e, audience));
  // 电脑动作默认是主人私密记忆；群/B站 audience 不注入。
  const episodes = (audience === 'group' || audience === 'bili')
    ? []
    : readJsonlTail(path.join(operatorDir || path.join(path.dirname(paths.dir), 'operator'), 'action-episodes.jsonl'), MAX_EPISODES);
  const nodes = new Map();
  const edges = [];
  const addNode = (id, type, label, extra = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type, label: String(label || '').slice(0, 160), ...extra });
    return nodes.get(id);
  };
  const addEdge = (from, to, type, extra = {}) => edges.push({ from, to, type, ...extra });
  const entityIndex = new Map();

  let prevEventId = null;
  for (const e of events) {
    const eid = 'event:' + (e.eventId || e.seq);
    addNode(eid, 'event', e.text || e.type, { at: e.at, body: e.body, actor: e.actor, visibility: e.visibility, eventType: e.type, risk: e.risk || 0 });
    addNode('body:' + e.body, 'body', bodyLabel(e.body), { body: e.body });
    addEdge(eid, 'body:' + e.body, 'in_body');
    if (prevEventId) addEdge(prevEventId, eid, 'temporal_next');
    prevEventId = eid;
    for (const t of tokenize(e.text)) {
      const nid = 'entity:' + t;
      addNode(nid, 'entity', t);
      addEdge(eid, nid, 'mentions');
      if (!entityIndex.has(t)) entityIndex.set(t, []);
      entityIndex.get(t).push(eid);
    }
    if (String(e.body || '').startsWith('desktop')) {
      addNode('skill:' + (e.payload?.actionId || eid), 'action', e.text || '电脑操作', { actionId: e.payload?.actionId || null });
    }
  }
  for (const ep of episodes) {
    const a = ep.action || {};
    const eid = 'episode:' + (ep.actionId || ep.at || Math.random());
    const label = (a.label || a.type || '动作') + (a.target ? ' · ' + actionTargetName(a.target) : '') + (ep.ok ? '：成功' : ep.denied ? '：被拒' : '：失败');
    addNode(eid, 'episode', label, { at: ep.at, actionType: a.type, risk: a.risk || 0, ok: !!ep.ok, denied: !!ep.denied, error: ep.error || '' });
    addNode('body:desktop', 'body', '电脑');
    addEdge(eid, 'body:desktop', 'in_body');
    const sk = 'skill:' + (a.type || 'unknown') + '|' + String(a.target || '').slice(0, 80).toLowerCase();
    addNode(sk, 'skill', (a.type || '动作') + (a.target ? ' @ ' + actionTargetName(a.target) : ''), { actionType: a.type || '' });
    addEdge(eid, sk, 'instantiates');
    for (const t of tokenize([a.type, a.target, a.reason].filter(Boolean).join(' '))) {
      const nid = 'entity:' + t;
      addNode(nid, 'entity', t);
      addEdge(eid, nid, 'mentions');
      if (!entityIndex.has(t)) entityIndex.set(t, []);
      entityIndex.get(t).push(eid);
    }
  }
  // A-MEM 式动态关联：共享话题的最近事件互相连边（最多每实体 5 条，避免爆炸）。
  for (const [token, ids] of entityIndex) {
    const recent = ids.slice(-5);
    for (let i = 1; i < recent.length; i++) addEdge(recent[i - 1], recent[i], 'same_entity');
  }
  const q = String(query || '').trim();
  if (q) {
    const qTokens = tokenize(q);
    for (const e of events) {
      if (qTokens.some((t) => String(e.text || '').includes(t))) {
        addNode('query:hit:' + e.eventId, 'query_hit', e.text || '', { at: e.at, body: e.body });
      }
    }
  }
  const summary = {
    version: 1,
    builtAt: new Date(now).toISOString(),
    audience,
    nodes: [...nodes.values()],
    edges,
    stats: {
      events: events.length,
      episodes: episodes.length,
      nodes: nodes.size,
      edges: edges.length,
      bodies: [...new Set(events.map((e) => bodyLabel(e.body)))],
    },
  };
  return summary;
}

export function formatIdentityGraphBlock({ dataDir, characterId, operatorDir = null, audience = 'private', limit = 10 } = {}) {
  const graph = buildIdentityGraph({ dataDir, characterId, operatorDir, audience });
  const events = graph.nodes.filter((n) => n.type === 'event' || n.type === 'episode').sort((a, b) => String(b.at || '').localeCompare(String(a.at || ''))).slice(0, limit);
  if (!events.length) return '';
  const clockOf = (at) => {
    try {
      const d = new Date(String(at || ''));
      if (Number.isNaN(d.getTime())) return '';
      return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    } catch { return ''; }
  };
  const lines = ['【跨身体时间线（图记忆摘要）】'];
  for (const n of events) lines.push('- ' + (n.at ? clockOf(n.at) + ' ' : '') + (n.type === 'episode' ? '[电脑] ' : '[' + bodyLabel(n.body) + '] ') + String(n.label || '').slice(0, 140));
  lines.push('这是从事件/技能图里压缩出来的；需要细节时用身份时间线/记忆检索。');
  return lines.join('\n') + '\n\n';
}

export function graphStats(options = {}) {
  const g = buildIdentityGraph(options);
  return g.stats;
}
