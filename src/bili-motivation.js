import { needsToMotivation } from './brain/motivation.js';

// Oasis B站动机引擎（P2）：情绪/需求/记忆驱动的活动选择。
// 只做纯决策；执行仍由 B站 body 的硬闸门负责。这里不直接发请求。
export const BILI_ACTIONS = Object.freeze([
  'watch', 'browse', 'like', 'comment', 'share', 'dynamic', 'reply', 'share_qq', 'live', 'journal', 'idle',
]);

export const DEFAULT_BILI_DRIVE = Object.freeze({
  enabled: true,
  freePublicPerDay: 6,
  hardCaps: Object.freeze({
    videos: 10,
    comments: 10,
    shares: 2,
    dynamics: 2,
    liveMinutes: 90,
  }),
  quietStart: '23:30',
  quietEnd: '08:00',
  temperature: 0.7,
});

function clamp(n, min, max) { return Math.min(max, Math.max(min, Number(n) || 0)); }
function minutesOf(hhmm) { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function inQuiet(now, start, end) {
  const d = new Date(now);
  const cur = d.getHours() * 60 + d.getMinutes();
  const a = minutesOf(start), b = minutesOf(end);
  if (a === b) return false;
  return a < b ? (cur >= a && cur < b) : (cur >= a || cur < b);
}
function softmaxPick(candidates, temperature, rng) {
  const usable = candidates.filter((c) => c.available !== false);
  if (!usable.length) return null;
  const t = Math.max(0.1, Number(temperature) || 0.7);
  const weights = usable.map((c) => Math.exp(Math.max(-10, Math.min(10, c.score / t))));
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = (typeof rng === 'function' ? rng() : Math.random()) * sum;
  for (let i = 0; i < usable.length; i += 1) { r -= weights[i]; if (r <= 0) return usable[i]; }
  return usable[usable.length - 1];
}

export function planBiliActivity({ now = Date.now(), brain = {}, usage = {}, config = {}, rng = Math.random } = {}) {
  const cfg = { ...DEFAULT_BILI_DRIVE, ...config, hardCaps: { ...DEFAULT_BILI_DRIVE.hardCaps, ...(config.hardCaps ?? {}) } };
  const needs = brain.needs ?? brain.affect?.needs ?? {};
  const mood = brain.affect?.mood ?? brain.mood ?? {};
  const energy = clamp(brain.affect?.physiology?.energy ?? brain.energy ?? 70, 0, 100);
  const fatigue = clamp(brain.affect?.physiology?.fatigue ?? brain.fatigue ?? 20, 0, 100);
  const curiosity = clamp(needs.curiosity ?? 60, 0, 100);
  const social = clamp(needs.social ?? 50, 0, 100);
  const rest = clamp(needs.rest ?? 50, 0, 100);
  const esteem = clamp(needs.esteem ?? 55, 0, 100);
  const valence = clamp(mood.valence ?? 0, -1, 1);
  const arousal = clamp(mood.arousal ?? 0.45, 0, 1);
  const expression = clamp((esteem * 0.5 + social * 0.3 + Math.max(0, valence) * 20) / 100, 0, 1);
  const motivation = needsToMotivation({ needs, mood, physiology: brain.affect?.physiology || brain.physiology || {} });
  const quiet = inQuiet(now, cfg.quietStart, cfg.quietEnd);
  const u = {
    videos: Number(usage.videos) || 0,
    comments: Number(usage.comments) || 0,
    shares: Number(usage.shares) || 0,
    dynamics: Number(usage.dynamics) || 0,
    publicActions: Number(usage.publicActions) || 0,
    liveMinutes: Number(usage.liveMinutes) || 0,
    lastActionAt: Number(usage.lastActionAt) || 0,
  };
  const minGapMs = (Number(cfg.minGapMin) || 0) * 60000;
  const gapBlocked = minGapMs > 0 && u.lastActionAt && now - u.lastActionAt < minGapMs;
  const cap = (used, max) => (Number(max) <= 0 ? true : used < Number(max));
  const publicCap = cfg.hardCaps.comments + cfg.hardCaps.shares + cfg.hardCaps.dynamics;
  const publicUsed = u.publicActions || (u.comments + u.shares + u.dynamics);
  const publicOverFree = publicUsed >= Number(cfg.freePublicPerDay) || publicUsed >= publicCap;
  const candidates = [
    { action: 'watch', score: motivation.play * 42 + motivation.learn * 12 + motivation.consume * 10 + energy * 0.5 - fatigue * 0.55 + Math.max(0, 0.5 - Math.abs(arousal - 0.55)) * 20, available: cap(u.videos, cfg.hardCaps.videos) && energy > 20 },
    { action: 'browse', score: motivation.play * 28 + motivation.consume * 18 + energy * 0.35 - fatigue * 0.45, available: cap(u.videos, cfg.hardCaps.videos) && energy > 20 },
    { action: 'like', score: motivation.share * 30 + motivation.connect * 12 + Math.max(0, valence) * 10, available: !gapBlocked },
    { action: 'comment', score: motivation.share * 46 + motivation.identity * 18 + motivation.connect * 10 + Math.max(0, valence) * 10, available: cap(u.comments, cfg.hardCaps.comments) && !gapBlocked },
    { action: 'share', score: motivation.share * 52 + motivation.identity * 16 + Math.max(0, valence) * 15, available: cap(u.shares, cfg.hardCaps.shares) && !gapBlocked },
    { action: 'dynamic', score: motivation.share * 42 + motivation.create * 22 + Math.max(0, valence) * 15, available: cap(u.dynamics, cfg.hardCaps.dynamics) && !gapBlocked },
    { action: 'reply', score: motivation.connect * 38 + motivation.share * 24 + Math.max(0, valence) * 10, available: cap(u.comments, cfg.hardCaps.comments) && !gapBlocked },
    { action: 'share_qq', score: motivation.share * 50 + motivation.connect * 20 + motivation.create * 10 + Math.max(0, valence) * 18, available: cap(u.shares, cfg.hardCaps.shares) && !gapBlocked },
    { action: 'live', score: motivation.play * 30 + motivation.connect * 25 + energy * 0.2 - fatigue * 0.3, available: cap(u.liveMinutes, cfg.hardCaps.liveMinutes) && energy > 30 },
    { action: 'journal', score: motivation.identity * 25 + motivation.create * 12 + motivation.consume * 8 + Math.max(0, valence) * 5, available: true },
    { action: 'idle', score: (1 - motivation.play) * 12 + fatigue * 0.6 + (quiet ? 80 : 0) + (gapBlocked ? 20 : 0), available: true },
  ].map((c) => {
    const publicAction = ['comment', 'share', 'dynamic', 'reply', 'share_qq'].includes(c.action);
    const needsApproval = publicAction && publicOverFree;
    const available = c.available !== false && !(quiet && c.action !== 'idle');
    return { ...c, publicAction, needsApproval, available, reason: '' };
  });
  const picked = softmaxPick(candidates, cfg.temperature, rng) || candidates.find((c) => c.action === 'idle');
  const reason = picked.action === 'idle'
    ? (quiet ? 'quiet-hours' : fatigue > 60 ? 'fatigue' : 'nothing-worth-doing')
    : picked.needsApproval ? 'public-over-free-quota' : 'drive';
  return {
    ok: true,
    at: new Date(now).toISOString(),
    action: picked.action,
    requiresApproval: Boolean(picked.needsApproval),
    quiet,
    gapBlocked,
    reason,
    candidates: candidates.map(({ action, score, available, publicAction, needsApproval }) => ({ action, score: Math.round(score * 100) / 100, available, publicAction, needsApproval })),
    state: { energy, fatigue, curiosity, social, rest, esteem, valence, arousal, expression, motivation, publicUsed, freePublicPerDay: cfg.freePublicPerDay },
    config: cfg,
  };
}
