// Self-model consistency + unified body arbitration helpers.
import { arbitrateActions } from '../oasis-arbiter.js';
import { monitorAction } from '../brain/v3/map-monitor.js';

export function checkActionAgainstSelfModel(selfModel = {}, action = {}) {
  const text = String(action.text || action.intent || action.action || '');
  const commitments = Array.isArray(selfModel.commitments) ? selfModel.commitments : [];
  const conflict = commitments.find((c) => c && c.text && /不要|别|不能|禁止/.test(String(c.text)) && text.includes(String(c.text).slice(0, 8)));
  if (conflict) return { ok: false, reason: 'self-commitment-conflict', commitment: conflict.text };
  return { ok: true };
}
export function arbitrateBodyCandidates({ brain = {}, candidates = [], caps = {}, now = Date.now(), temperature = 0.35, rng = Math.random, workspace = null, v3 = null } = {}) {
  const result = arbitrateActions({ candidates, affect: brain?.affect || {}, needs: brain?.affect?.needs || {}, caps, now, temperature, rng });
  const self = brain?.self || {};
  const chosen = result?.chosen || {};
  const check = checkActionAgainstSelfModel(self, chosen);
  // WP-02 MAP Monitor: independent gate. Default shadow; only enforce when v3.mapMonitor=enforce.
  const monitor = monitorAction({
    action: chosen, workspace, state: brain, selfModel: self,
    confidence: Number(v3?.meta?.confidence) || 0.5,
    mode: String(v3?.flags?.mapMonitor || 'shadow'),
  });
  return { ...result, consistency: check, monitor };
}
