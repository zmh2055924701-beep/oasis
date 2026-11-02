// Oasis Brain v3 orchestrator. Phase A is prompt/context safe; B/C layers are gated.
import { normalizeV3Config } from './flags.js';
import { coActivate, dualRetrieve, decayAssociations } from './hela.js';
import { buildWorkspace, workspacePromptBlock } from './workspace.js';
import { buildNarrative, mirrorPromptBlock } from './mirror.js';
import { estimateConfidence, metaPromptBlock } from './meta-awareness.js';
import { monitorAction, monitorPromptBlock } from './map-monitor.js';
import { buildPlan, planPromptBlock } from './planning.js';
import { composeConcepts, compositionPromptBlock } from './composition.js';
import { sleepV2, sleepPromptBlock } from './sleep-v3.js';
import { episodesToExperience } from './experience.js';
import { planReplay } from './cmr.js';

export function buildBrainV3({
  state = {}, graph = null, text = '', memoryItems = [], thoughts = [], episodes = [],
  config = null, now = Date.now(),
} = {}) {
  const flags = normalizeV3Config(config || {});
  if (!flags.enabled) return { flags, block: '', active: [], workspace: null, narrative: '', meta: null, plan: null, composition: [], evidenceCount: 0 };
  const hela = dualRetrieve({ graph, text, affect: state?.affect?.mood || null, memoryItems, limit: flags.maxWorkspace + 3 });
  const workspace = flags.workspace ? buildWorkspace({ active: hela.graph, state, capacity: flags.maxWorkspace, now }) : { winners: [], candidates: [], entropy: 0 };
  const meta = flags.metaAwareness
    ? estimateConfidence({ workspace, state, evidenceCount: (hela.graph.length + hela.memory.length) })
    : { confidence: 0.5, support: 0, conflict: false };
  const narrative = flags.mirror ? buildNarrative({ state, workspace, thoughts }) : '';
  const plan = flags.plan ? buildPlan({ workspace, goals: state?.goals || [], state, now }) : null;
  const composition = flags.composition ? composeConcepts({ workspace, associations: hela.associations }) : [];
  const block = [
    workspacePromptBlock(workspace, { maxChars: 600 }),
    mirrorPromptBlock({ narrative }),
    metaPromptBlock(meta),
    plan ? planPromptBlock(plan) : '',
    composition.length ? compositionPromptBlock(composition) : '',
  ].filter(Boolean).join('\n');
  return {
    flags,
    active: hela.graph,
    associations: hela.associations,
    memory: hela.memory,
    workspace,
    narrative,
    meta,
    plan,
    composition,
    evidenceCount: hela.graph.length + hela.memory.length,
    block,
  };
}

export function monitorActionV3(args = {}) { return monitorAction(args); }
export function monitorBlockV3(result) { return monitorPromptBlock(result); }
export function sleepV3({ graph, episodes = [], now = Date.now() } = {}) { return sleepV2({ graph, episodes, now }); }
export function sleepBlockV3(result) { return sleepPromptBlock(result); }
export { episodesToExperience, planReplay, decayAssociations };
