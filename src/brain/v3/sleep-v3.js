// WP-07/08 sleep v2 + CMR replay. Derived graph only; raw Memory v3 is never deleted.
function edgeAgeHours(edge, now) {
  const t = Date.parse(edge.lastUsedAt || edge.createdAt || '');
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3600000) : 0;
}

export function predictiveForget(graph, { now = Date.now(), floor = 0.02 } = {}) {
  let changed = 0;
  for (const edge of graph?.edges || []) {
    const age = edgeAgeHours(edge, now);
    const weight = Number(edge.weight) || 0.2;
    if (age > 24 * 7 && weight < 0.08) { edge.weight = floor; changed += 1; }
    else if (age > 24 * 3) { edge.weight = Math.max(floor, weight * 0.985); changed += 1; }
  }
  return { changed };
}

export function distillHubs(graph, { limit = 8 } = {}) {
  const degree = new Map();
  for (const edge of graph?.edges || []) {
    degree.set(edge.from, (degree.get(edge.from) || 0) + (Number(edge.weight) || 0.2));
    degree.set(edge.to, (degree.get(edge.to) || 0) + (Number(edge.weight) || 0.2));
  }
  const nodes = new Map((graph?.nodes || []).map((n) => [n.id, n]));
  return [...degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, weight]) => ({ id, label: nodes.get(id)?.label || id, weight: Number(weight.toFixed(2)) }));
}

export function selectReplay({ graph, episodes = [], now = Date.now(), limit = 8 } = {}) {
  const hubs = distillHubs(graph, { limit: 12 });
  const hubIds = new Set(hubs.map((h) => h.id));
  const candidates = [];
  for (const node of graph?.nodes || []) {
    if (node.type !== 'episode' && !hubIds.has(node.id)) continue;
    const recent = Date.parse(node.lastActivatedAt || node.createdAt || '') || 0;
    const fresh = Math.exp(-Math.max(0, now - recent) / (60 * 86400000));
    const score = (Number(node.importance) || 0.2) * 0.35 + (hubIds.has(node.id) ? 0.35 : 0) + fresh * 0.2;
    candidates.push({ id: node.id, label: node.label, score: Number(score.toFixed(3)), type: node.type });
  }
  for (const ep of episodes.slice(-40)) {
    candidates.push({ id: String(ep.id || ''), label: String(ep.summary || ep.topic || '').slice(0, 100), score: Number(ep.selfImportance || ep.importance || 0.3), type: 'episode' });
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}

export function sleepV2({ graph, episodes = [], now = Date.now() } = {}) {
  const forget = predictiveForget(graph, { now });
  const hubs = distillHubs(graph);
  const replay = selectReplay({ graph, episodes, now, limit: 8 });
  return { forget, hubs, replay, note: '只衰减派生图/边，raw Memory v3 不删除' };
}

export function sleepPromptBlock({ hubs = [], replay = [] } = {}, { maxChars = 500 } = {}) {
  const lines = ['【睡眠整理 · 只作内部参考】'];
  if (hubs.length) lines.push('反复出现的东西：' + hubs.slice(0, 3).map((h) => h.label).join('、'));
  if (replay.length) lines.push('被重放的情景：' + replay.slice(0, 3).map((r) => r.label).join('；'));
  return lines.join('\n').slice(0, maxChars);
}
