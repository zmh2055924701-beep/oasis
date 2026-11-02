// WP-09 Hippo experience layer adapter: Memory v3 episodes -> experience candidates.
// No second memory store; this is a view over the same episodes.
export function episodesToExperience(episodes = [], { limit = 8 } = {}) {
  return (Array.isArray(episodes) ? episodes : [])
    .filter((e) => e && (e.summary || e.topic))
    .slice(-limit)
    .map((e) => ({
      id: String(e.id || ''),
      at: Number(e.endedAt || e.startedAt) || 0,
      day: String(e.day || ''),
      summary: String(e.summary || e.topic || '').slice(0, 300),
      emotionalArc: String(e.emotionalArc || ''),
      selfImportance: Number(e.selfImportance) || 0,
      clarity: String(e.clarity || 'clear'),
      sourceIds: Array.isArray(e.sourceEventIds) ? e.sourceEventIds.slice(0, 20) : [],
    }));
}

export function experiencePromptBlock(items, { maxChars = 450 } = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  return ('【经历 · 不是聊天流水账】\n' + items.slice(0, 3).map((x) => '- ' + x.summary.slice(0, 100)).join('\n')).slice(0, maxChars);
}
