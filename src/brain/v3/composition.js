// WP-10 Nat Neurosci composition layer: recombine active concepts into candidates.
// It is deliberately conservative: composition is a hypothesis, never a fact.
export function composeConcepts({ workspace = null, associations = [], limit = 4 } = {}) {
  const winners = workspace?.winners || [];
  const out = [];
  for (let i = 0; i < winners.length; i += 1) {
    for (let j = i + 1; j < winners.length; j += 1) {
      const a = String(winners[i].label || winners[i].text || '').slice(0, 40);
      const b = String(winners[j].label || winners[j].text || '').slice(0, 40);
      if (!a || !b || a === b) continue;
      out.push({ a, b, text: a + ' × ' + b, novelty: Math.min(1, 0.35 + (Number(winners[i].score) || 0) * 0.3 + (Number(winners[j].score) || 0) * 0.3), type: 'composition' });
    }
  }
  for (const x of associations.slice(0, 6)) {
    if (out.length >= limit * 2) break;
    out.push({ a: x.from, b: x.to, text: x.type + '：' + x.from + ' ↔ ' + x.to, novelty: Math.min(1, Number(x.weight) || 0.3), type: 'association' });
  }
  return out.sort((a, b) => b.novelty - a.novelty).slice(0, Math.max(1, limit));
}

export function compositionPromptBlock(items, { maxChars = 400 } = {}) {
  if (!Array.isArray(items) || !items.length) return '';
  return ('【组合想象 · 只是假设，不当事实】\n' + items.slice(0, 3).map((x) => '- ' + x.text).join('\n')).slice(0, maxChars);
}
