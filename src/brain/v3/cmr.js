// WP-08 CMR replay: choose a small set of episodes/associations to replay.
export function planReplay({ graph, episodes = [], now = Date.now(), limit = 6 } = {}) {
  const nodes = (graph?.nodes || []).filter((n) => n.type === 'episode').slice(-80);
  const items = nodes.map((n) => ({
    id: n.id,
    text: String(n.text || n.label || '').slice(0, 120),
    score: (Number(n.importance) || 0.2) * 0.4 + Math.exp(-Math.max(0, now - (Date.parse(n.lastActivatedAt || n.createdAt || '') || now)) / (30 * 86400000)) * 0.3,
  }));
  for (const e of episodes.slice(-30)) items.push({ id: String(e.id || ''), text: String(e.summary || e.topic || '').slice(0, 120), score: Number(e.selfImportance || e.importance || 0.3) });
  return items.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
}

export function replayPromptBlock(items, { maxChars = 400 } = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  return ('【重放 · 旧情景自己浮上来】\n' + items.slice(0, 3).map((x) => '- ' + x.text).join('\n')).slice(0, maxChars);
}
