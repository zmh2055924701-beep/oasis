// Memory v4 derived-index orchestrator. Pure over supplied episodes/facts.
// Writes nothing; callers may persist the returned JSON under memory-v3/derived/.
import { buildTiers } from './tiers.js';
import { buildNotes } from './notes.js';
import { buildHierarchy } from './hierarchy.js';
import { planForgetting } from './forgetting.js';

export function buildDerived({ episodes = [], facts = [], now = Date.now(), config = {} } = {}) {
  const tiers = buildTiers({ episodes, facts, now, config: config.tiering || {} });
  const notes = buildNotes({ episodes, facts, now });
  const hierarchy = buildHierarchy({ episodes, now, clusterSize: Number(config.hierarchy?.clusterSize) || 8 });
  const forgetting = planForgetting(episodes, { now, threshold: Number(config.forgetting?.archiveThreshold) || 0.15 });
  const evalInfo = {
    episodes: episodes.length,
    facts: facts.length,
    notes: notes.stats.total,
    links: notes.stats.links,
    hierarchyLevels: hierarchy.stats.levels,
    archiveCandidates: forgetting.archive.length,
    rawDeleted: 0,
  };
  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    tiers: { stats: tiers.stats, core: tiers.core.slice(0, 40) },
    notes: { stats: notes.stats, sample: notes.notes.slice(-8) },
    hierarchy: { stats: hierarchy.stats },
    forgetting: { archive: forgetting.archive.slice(0, 40), deleted: 0 },
    eval: evalInfo,
    rawDeleted: 0,
  };
}
