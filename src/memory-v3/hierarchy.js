// MP-5 deterministic hierarchy (RAPTOR-lite). Derived summaries only.
export function buildHierarchy({ episodes = [], clusterSize = 8, now = Date.now() } = {}) {
  const list = (Array.isArray(episodes) ? episodes : []).filter((e) => e && (e.summary || e.topic));
  const size = Math.max(2, Math.min(32, Number(clusterSize) || 8));
  const leaves = list.map((e) => ({ id: 'leaf-' + String(e.id || ''), level: 0, at: Number(e.endedAt || e.startedAt) || 0, text: String(e.summary || e.topic || '').slice(0, 220), sourceIds: [String(e.id || '')] }));
  const levels = [leaves];
  while (levels.at(-1).length > size) {
    const prev = levels.at(-1);
    const next = [];
    for (let i = 0; i < prev.length; i += size) {
      const group = prev.slice(i, i + size);
      next.push({
        id: 'sum-' + (levels.length) + '-' + i,
        level: levels.length,
        at: Math.max(...group.map((x) => x.at || 0)),
        text: group.map((x) => x.text.split(/[。！？]/)[0]).filter(Boolean).join('；').slice(0, 300),
        sourceIds: group.flatMap((x) => x.sourceIds),
      });
    }
    levels.push(next);
  }
  return { version: 1, generatedAt: new Date(now).toISOString(), levels, stats: { leaves: leaves.length, levels: levels.length, rawDeleted: 0 } };
}

export function hierarchySearch(hierarchy, query, { limit = 5 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];
  return (hierarchy?.levels || []).flat()
    .filter((n) => String(n.text || '').includes(q))
    .slice(0, limit);
}
