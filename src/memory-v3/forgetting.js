// MP-6 MemoryBank-style strength / archive decision.
// IMPORTANT: never deletes. Archive is a derived index; raw events/episodes remain.
export function computeStrength({ importance = 0.3, rehearsal = 0, ageDays = 0, clarity = 0.5 } = {}) {
  const recency = Math.exp(-Math.max(0, Number(ageDays) || 0) / 45);
  const s = 0.35 * Math.max(0, Math.min(1, Number(importance) || 0))
    + 0.25 * Math.max(0, Math.min(1, Number(rehearsal) || 0))
    + 0.25 * recency
    + 0.15 * Math.max(0, Math.min(1, Number(clarity) || 0));
  return Math.max(0, Math.min(1, s));
}

export function shouldArchive(item = {}, { now = Date.now(), tauDays = 45, threshold = 0.15 } = {}) {
  const ageDays = Math.max(0, (now - Number(item.endedAt || item.startedAt || item.at || item.validFrom || now)) / 86400000);
  const clarity = { vivid: 1, clear: 0.8, fuzzy: 0.4, trace: 0.2, vague: 0.1 }[String(item.clarity || '')] ?? 0.5;
  const strength = computeStrength({ importance: item.selfImportance ?? item.importance ?? 0.3, rehearsal: item.rehearsalCount ?? 0, ageDays, clarity });
  return { archive: strength < threshold && !/promise|relationship|identity|承诺|关系|身份|约定/.test(String(item.kind || '') + String(item.tags || '')), strength: Number(strength.toFixed(4)), ageDays: Math.round(ageDays) };
}

export function planForgetting(items = [], { now = Date.now(), tauDays = 45, threshold = 0.15 } = {}) {
  const archive = [];
  for (const item of Array.isArray(items) ? items : []) {
    const r = shouldArchive(item, { now, tauDays, threshold });
    if (r.archive) archive.push({ id: item.id, kind: item.kind || item._kind || '', strength: r.strength, ageDays: r.ageDays });
  }
  return { archive, deleted: 0, note: '只归档派生索引，raw 不删除' };
}
