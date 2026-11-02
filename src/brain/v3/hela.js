// WP-01 HeLa-lite: co-activation, associative decay, dual retrieval.
// Graph activation stays local/deterministic; Memory v3 lexical items can be merged.
import { activateGraph } from '../graph.js';

function keyOfPair(a, b) { return [String(a), String(b)].sort().join('|'); }

export function coActivate({ graph, text = '', affect = null, limit = 8, hops = 2 } = {}) {
  const active = activateGraph({ graph, text, affect, limit: Math.max(limit, 6), hops, decay: 0.55 });
  const associations = [];
  const byId = new Map(active.map((x) => [x.node?.id, x]));
  for (const a of active) {
    if (!a.node?.id) continue;
    for (const edge of graph?.edges || []) {
      if (edge.from !== a.node.id && edge.to !== a.node.id) continue;
      const otherId = edge.from === a.node.id ? edge.to : edge.from;
      const other = byId.get(otherId);
      if (!other || other.node.id === a.node.id) continue;
      associations.push({
        pair: keyOfPair(a.node.id, other.node.id),
        from: a.node.id, to: other.node.id,
        weight: Math.min(1, (Number(edge.weight) || 0.2) * (Number(a.activation) || 0.3) * (Number(other.activation) || 0.3) * 2),
        type: String(edge.type || 'association'),
      });
    }
  }
  associations.sort((x, y) => y.weight - x.weight);
  return { active, associations: associations.slice(0, 30) };
}

export function decayAssociations(graph, { now = Date.now(), factor = 0.985 } = {}) {
  if (!graph) return { changed: 0 };
  let changed = 0;
  for (const edge of graph.edges || []) {
    const last = Date.parse(edge.lastUsedAt || edge.createdAt || '');
    const ageHours = Number.isFinite(last) ? Math.max(0, (now - last) / 3600000) : 0;
    if (ageHours < 1) continue;
    const next = Math.max(0.02, (Number(edge.weight) || 0.2) * Math.pow(factor, Math.min(720, ageHours)));
    if (Math.abs(next - Number(edge.weight || 0)) > 0.001) { edge.weight = Number(next.toFixed(4)); changed += 1; }
  }
  return { changed };
}

function tokenSet(text) {
  const s = String(text || '').toLowerCase();
  const out = new Set();
  for (const part of s.split(/[^\p{L}\p{N}]+/u)) {
    if (!part) continue;
    if (part.length <= 6) out.add(part);
    for (let i = 0; i < part.length - 1; i += 1) out.add(part.slice(i, i + 2));
  }
  return out;
}

export function dualRetrieve({ graph, text = '', affect = null, memoryItems = [], limit = 8 } = {}) {
  const graphSide = coActivate({ graph, text, affect, limit });
  const tokens = tokenSet(text);
  const memory = (Array.isArray(memoryItems) ? memoryItems : []).map((item) => {
    const hay = String(item.text || item.summary || item.title || '');
    let lexical = 0;
    for (const token of tokens) if (hay.includes(token)) lexical += token.length >= 2 ? 0.12 : 0.04;
    const fresh = Math.exp(-Math.max(0, Date.now() - (Number(item.at) || 0)) / (30 * 86400000));
    const importance = Number(item.selfImportance || item.systemImportance || item.importance || 0.3);
    return { ...item, score: lexical + fresh * 0.2 + importance * 0.2 };
  }).filter((x) => x.score > 0.04).sort((a, b) => b.score - a.score).slice(0, limit);
  return { graph: graphSide.active, associations: graphSide.associations, memory };
}

export function helaPromptBlock({ active = [], associations = [], memory = [] } = {}, { maxChars = 700 } = {}) {
  const lines = [];
  if (active.length) {
    lines.push('【联想到的旧事 · 不是当前事实】');
    for (const a of active.slice(0, 4)) lines.push('- ' + String(a.node?.label || a.node?.text || '').slice(0, 100));
  }
  if (memory.length) {
    lines.push('【语义召回 · 只作参考】');
    for (const m of memory.slice(0, 3)) lines.push('- ' + String(m.text || m.summary || m.title || '').slice(0, 100));
  }
  return lines.join('\n').slice(0, maxChars);
}
