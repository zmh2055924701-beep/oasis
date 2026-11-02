// Unified motivation mapping: 5 homeostatic needs -> 9 purpose drives.
// One source used by purpose-engine, bili-motivation, and UI projection.
export const MOTIVATION_KEYS = Object.freeze([
  'play', 'learn', 'install', 'connect', 'care', 'share', 'identity', 'create', 'consume',
]);
export const DEFAULT_MOTIVATION = Object.freeze({
  play: 0.2, learn: 0.15, install: 0.12, connect: 0.3, care: 0.22,
  share: 0.22, identity: 0.18, create: 0.1, consume: 0.08,
});
function n(v, fallback = 50) { const x = Number(v); return Number.isFinite(x) ? Math.max(0, Math.min(100, x)) / 100 : fallback / 100; }
function clamp(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

export function needsToMotivation({ needs = {}, mood = {}, physiology = {}, personaBias = {} } = {}) {
  const social = n(needs.social, 58);
  const curiosity = n(needs.curiosity, 60);
  const rest = n(needs.rest, 48);
  const security = n(needs.security, 70);
  const esteem = n(needs.esteem, 56);
  const valence = Math.max(-1, Math.min(1, Number(mood.valence) || 0));
  const arousal = Math.max(0, Math.min(1, Number(mood.arousal) || 0.45));
  const energy = Math.max(0, Math.min(100, Number(physiology.energy) || 70)) / 100;
  const fatigue = Math.max(0, Math.min(100, Number(physiology.fatigue) || 20)) / 100;
  const positive = Math.max(0, valence);
  const out = {
    play: clamp(curiosity * 0.45 + positive * 0.18 + energy * 0.12 + 0.05),
    learn: clamp(curiosity * 0.55 + esteem * 0.12 + 0.03),
    install: clamp(curiosity * 0.42 + esteem * 0.14 + 0.02),
    connect: clamp(social * 0.62 + security * 0.18 + positive * 0.05),
    care: clamp(social * 0.42 + security * 0.28 + positive * 0.08),
    share: clamp(social * 0.38 + esteem * 0.22 + positive * 0.18 + arousal * 0.06),
    identity: clamp(security * 0.38 + esteem * 0.28 + curiosity * 0.12),
    create: clamp(curiosity * 0.32 + esteem * 0.24 + positive * 0.1),
    consume: clamp(curiosity * 0.30 + positive * 0.12 + (1 - rest) * 0.06),
  };
  for (const key of MOTIVATION_KEYS) {
    const bias = Number(personaBias?.[key]);
    if (Number.isFinite(bias) && bias > 0) out[key] = Math.min(1, Math.max(out[key], bias));
    out[key] = out[key] * (0.55 + energy * 0.45 - fatigue * 0.12);
  }
  return out;
}

export function blendMotivation(existing = {}, targeted = {}, ratio = 0.35) {
  const r = Math.max(0, Math.min(1, Number(ratio) || 0.35));
  const out = {};
  for (const key of MOTIVATION_KEYS) {
    const a = clamp(existing[key] ?? DEFAULT_MOTIVATION[key]);
    const b = clamp(targeted[key] ?? DEFAULT_MOTIVATION[key]);
    out[key] = clamp(a * (1 - r) + b * r);
  }
  return out;
}
