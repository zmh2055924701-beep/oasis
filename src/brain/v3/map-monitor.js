// WP-02 MAP Monitor: independent gate between candidate action and execution.
// It never executes; it only returns allow | review | block with reasons.
import { clamp01 } from '../schema.js';

const ACTIVE = new Set(['qq_send', 'qq_reply', 'qq_speak', 'pet_speak', 'bili_comment', 'bili_share', 'bili_dynamic', 'bili_reply', 'desktop_action']);

export function monitorAction({ action = {}, workspace = null, state = {}, selfModel = null, confidence = 0.5, mode = 'shadow' } = {}) {
  const reasons = [];
  const type = String(action.type || action.action || '');
  const active = action.class === 'active' || ACTIVE.has(type);
  const workspaceWinners = workspace?.winners || [];
  const support = workspaceWinners.length ? Math.max(...workspaceWinners.map((x) => Number(x.score) || 0)) : 0;
  if (active && Number(confidence) < 0.45) reasons.push('low-confidence');
  if (active && support < 0.25) reasons.push('not-in-workspace');
  const mood = state?.affect?.mood || {};
  if (active && Number(mood.valence) < -0.45) reasons.push('negative-mood');
  const commitments = Array.isArray(selfModel?.commitments) ? selfModel.commitments : [];
  if (active && commitments.some((c) => /不要主动|别发|不打扰/.test(String(c.text || c || '')))) reasons.push('self-commitment-conflict');
  let decision = 'allow';
  if (reasons.includes('self-commitment-conflict')) decision = 'block';
  else if (reasons.length) decision = active ? 'review' : 'allow';
  if (mode === 'enforce' && decision === 'review') decision = 'block';
  if (mode === 'off') return { decision: 'allow', mode, reasons: [], active, support: Number(support.toFixed(3)) };
  return { decision, mode, reasons, active, support: Number(support.toFixed(3)), confidence: clamp01(confidence) };
}

export function monitorPromptBlock(result, { maxChars = 300 } = {}) {
  if (!result || result.decision === 'allow') return '';
  return ('【行动闸门 · ' + result.decision + '】' + (result.reasons.join(' / ') || '需要再确认') +
    '。先不要直接做；拿不准就问，或者写进日记。').slice(0, maxChars);
}
