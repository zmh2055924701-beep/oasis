// MP-5 HippoRAG-style personalized PageRank over the derived memory graph.
// Read-only: returns activation scores, never mutates graph or raw memory.
export function personalizedPageRank({ nodes = [], edges = [], seeds = [], damping = 0.85, iterations = 20, maxHops = 2 } = {}) {
  const ids = new Set((nodes || []).map((n) => String(n.id)).filter(Boolean));
  const adj = new Map([...ids].map((id) => [id, []]));
  for (const e of edges || []) {
    const from = String(e.from || ''), to = String(e.to || '');
    if (!ids.has(from) || !ids.has(to)) continue;
    const w = Math.max(0.01, Math.min(5, Number(e.weight) || 0.2));
    adj.get(from).push({ to, w });
    adj.get(to).push({ to: from, w });
  }
  const seedIds = [...new Set((seeds || []).map(String).filter((id) => ids.has(id)))];
  if (!seedIds.length) return [];
  const N = Math.max(1, ids.size);
  let rank = new Map([...ids].map((id) => [id, seedIds.includes(id) ? 1 / seedIds.length : 0]));
  for (const id of seedIds) rank.set(id, 1 / seedIds.length);
  for (let it = 0; it < Math.max(1, iterations); it += 1) {
    const next = new Map([...ids].map((id) => [id, 0]));
    for (const [from, score] of rank) {
      const links = adj.get(from) || [];
      if (!links.length) { next.set(from, (next.get(from) || 0) + score); continue; }
      const total = links.reduce((s, l) => s + l.w, 0) || 1;
      for (const l of links) next.set(l.to, (next.get(l.to) || 0) + score * (1 - damping) * (l.w / total));
    }
    for (const id of seedIds) next.set(id, (next.get(id) || 0) + damping / seedIds.length);
    rank = next;
  }
  return [...rank.entries()]
    .filter(([id]) => !seedIds.includes(id))
    .map(([id, score]) => ({ id, score: Number(score.toFixed(6)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(100, nodes.length)));
}

export function graphRecall({ nodes = [], edges = [], seeds = [], limit = 8, ...opts } = {}) {
  return personalizedPageRank({ nodes, edges, seeds, ...opts }).slice(0, limit);
}
