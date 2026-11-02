// Oasis 行动仲裁器（P3）：把 QQ/B站/桌宠/电脑的候选动作放到同一张桌子上选。
// 纯函数；安全/额度/审批由外层提供，这里只做排序与选择。
export const OASIS_BODIES = Object.freeze(['qq', 'bili', 'pet', 'desktop', 'inner']);

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number(n) || 0)); }

export function arbitrateActions({ candidates = [], needs = {}, affect = {}, caps = {}, now = Date.now(), temperature = 0.35, rng = Math.random } = {}) {
  const energy = clamp(affect.physiology?.energy ?? needs.energy ?? 70, 0, 100);
  const fatigue = clamp(affect.physiology?.fatigue ?? needs.fatigue ?? 20, 0, 100);
  const valence = clamp(affect.mood?.valence ?? 0, -1, 1);
  const arousal = clamp(affect.mood?.arousal ?? 0.45, 0, 1);
  const prepared = candidates.map((c) => {
    const utility = Number(c.utility) || 0;
    const bodyBoost = c.body === 'inner' ? -2 : 0;
    const moodBoost = c.body === 'qq' ? valence * 3 + arousal * 2 : c.body === 'bili' ? Math.max(0, valence) * 2 : 0;
    const energyPenalty = Number(c.energyCost) || 0;
    const fatiguePenalty = fatigue * (Number(c.fatigueSensitivity) || 0.02);
    const capBlocked = c.available === false || (c.capRemaining != null && Number(c.capRemaining) <= 0);
    const requiresApproval = c.publicAction === true && c.requiresApproval === true;
    return { ...c, score: capBlocked ? -Infinity : utility + bodyBoost + moodBoost - energyPenalty - fatiguePenalty, available: !capBlocked, requiresApproval };
  }).filter((c) => c.available);
  if (!prepared.length) return { ok: true, chosen: { body: 'inner', action: 'idle', reason: 'nothing-available' }, ranked: [] };
  const t = Math.max(0.05, Number(temperature) || 0.35);
  const weights = prepared.map((c) => Math.exp(Math.max(-20, Math.min(20, c.score / t))));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = (typeof rng === 'function' ? rng() : Math.random()) * sum;
  let chosen = prepared[prepared.length - 1];
  for (let i = 0; i < prepared.length; i += 1) { r -= weights[i]; if (r <= 0) { chosen = prepared[i]; break; } }
  const ranked = [...prepared].sort((a, b) => b.score - a.score).map((c, i) => ({ rank: i + 1, body: c.body, action: c.action, score: Math.round(c.score * 100) / 100, requiresApproval: c.requiresApproval }));
  return { ok: true, at: new Date(now).toISOString(), chosen: { body: chosen.body, action: chosen.action, reason: chosen.reason || 'utility', requiresApproval: chosen.requiresApproval, score: Math.round(chosen.score * 100) / 100, payload: chosen.payload }, ranked };
}
