// Oasis Brain v3 feature flags / phase gates.
// Phase A is intentionally safe: prompt/context only, no forced action.
export const DEFAULT_V3_CONFIG = Object.freeze({
  enabled: true,
  hela: true,
  workspace: true,
  mirror: true,
  metaAwareness: true,
  mapMonitor: 'shadow', // off | shadow | enforce
  plan: false,
  composition: false,
  sleepV2: false,
  cmrReplay: false,
  maxWorkspace: 5,
  maxNarrativeChars: 900,
  confidenceFloor: 0.45,
});

export function normalizeV3Config(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const cfg = { ...DEFAULT_V3_CONFIG, ...src };
  cfg.enabled = src.enabled !== false;
  for (const key of ['hela', 'workspace', 'mirror', 'metaAwareness', 'plan', 'composition', 'sleepV2', 'cmrReplay']) {
    if (src[key] !== undefined) cfg[key] = src[key] !== false;
  }
  cfg.mapMonitor = ['off', 'shadow', 'enforce'].includes(String(src.mapMonitor)) ? String(src.mapMonitor) : DEFAULT_V3_CONFIG.mapMonitor;
  cfg.maxWorkspace = Math.min(12, Math.max(2, Math.round(Number(src.maxWorkspace) || DEFAULT_V3_CONFIG.maxWorkspace)));
  cfg.maxNarrativeChars = Math.min(2000, Math.max(300, Number(src.maxNarrativeChars) || DEFAULT_V3_CONFIG.maxNarrativeChars));
  cfg.confidenceFloor = Math.min(0.95, Math.max(0.2, Number(src.confidenceFloor) || DEFAULT_V3_CONFIG.confidenceFloor));
  return cfg;
}
