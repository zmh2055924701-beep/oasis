// MP-3 tiers: derived index only. Raw episodes/facts are never moved or deleted.
export const TIERS_VERSION = 1;

const CORE_KINDS = /promise|relationship|identity|commitment|约定|关系|身份|承诺|称呼|计划/;
const CORE_TAGS = /owner|core|承诺|约定|关系|身份/;

function tsOf(x) {
  const n = Number(x?.endedAt || x?.startedAt || x?.at || Date.parse(x?.createdAt || '') || 0);
  return Number.isFinite(n) ? n : 0;
}
function importanceOf(x) { return Number(x?.selfImportance ?? x?.importance ?? x?.salience ?? 0.3) || 0.3; }
function isCoreFact(f) {
  return CORE_KINDS.test(String(f?.kind || '')) || CORE_KINDS.test(String(f?.predicate || ''))
    || CORE_TAGS.test(String(f?.tags || '')) || importanceOf(f) >= 0.85 || f?.pinned === true;
}

export function buildTiers({ episodes = [], facts = [], now = Date.now(), config = {} } = {}) {
  const coreMax = Math.max(5, Math.min(200, Number(config.coreMaxItems) || 40));
  const workingDays = Math.max(1, Math.min(365, Number(config.workingDays) || 14));
  const archiveAfterDays = Math.max(workingDays, Math.min(3650, Number(config.archiveAfterDays) || 30));
  const core = [];
  const working = [];
  const archival = [];
  for (const f of Array.isArray(facts) ? facts : []) {
    if (isCoreFact(f)) core.push({ ...f, tier: 'core', _i: importanceOf(f), _t: tsOf(f) });
    else working.push({ ...f, tier: 'working', _i: importanceOf(f), _t: tsOf(f) });
  }
  for (const ep of Array.isArray(episodes) ? episodes : []) {
    const ageDays = Math.max(0, (now - tsOf(ep)) / 86400000);
    if (ageDays <= workingDays) working.push({ ...ep, tier: 'working', _i: importanceOf(ep), _t: tsOf(ep) });
    else if (ageDays <= archiveAfterDays) archival.push({ ...ep, tier: 'archival', _i: importanceOf(ep), _t: tsOf(ep) });
    else archival.push({ ...ep, tier: 'archival', _i: importanceOf(ep), _t: tsOf(ep) });
  }
  core.sort((a, b) => b._i - a._i || b._t - a._t);
  while (core.length > coreMax) working.push({ ...core.pop(), tier: 'working' });
  for (const list of [working, archival]) list.sort((a, b) => b._i - a._i || b._t - a._t);
  const clean = (x) => { const { _i, _t, ...rest } = x; return rest; };
  return {
    version: TIERS_VERSION,
    generatedAt: new Date(now).toISOString(),
    core: core.map(clean),
    working: working.map(clean),
    archival: archival.map(clean),
    stats: { core: core.length, working: working.length, archival: archival.length, rawDeleted: 0 },
  };
}
