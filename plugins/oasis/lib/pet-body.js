// Oasis Pet Body runtime: L0 desktop awareness + pet behavior + pending thoughts.
// The pet renderer only renders/executes; all decisions live here (shared brain).
import fs from 'node:fs';
import path from 'node:path';
import { activeMemoryPaths, readCurrentCharacter } from '../../../src/character-persona.js';
import { createBodyEventStore } from '../../../src/body-events.js';
import { createDesktopAwarenessService, classifyActivity } from '../../../src/desktop-awareness.js';
import { withActiveLease } from '../../../src/brain/action-lease.js';

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }

export function createPetBodyService({ stateDir, qqStateDir, pluginLog = () => {}, petService = null, chat = null, dshPet = null, memoryV3 = null, brainState = null, getConfig = null, maxPending = 12 } = {}) {
  const bodyDir = path.join(path.dirname(activeMemoryPaths().dir), 'body');
  const store = createBodyEventStore({ dir: bodyDir });
  let desktop = null;
  let started = false;
  let lastQuestionAt = 0;
  let lastApproachAt = 0;
  let lastContext = null;
  let lastTick = 0;

  function bodyConfig() { try { return getConfig?.() || {}; } catch { return {}; } }
  function cfg() { return brainState?.() || {}; }
  function petOnline() { try { return Boolean(dshPet?.last?.()?.present || chat?.status?.().presence?.online); } catch { return false; } }
  async function rendererStatus() { try { return dshPet?.status ? await dshPet.status() : { ok: false, error: 'no renderer' }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } }
  function brainNeeds() { const b = cfg(); return b?.affect?.needs || {}; }
  function qqActive() {
    try {
      const f = path.join(qqStateDir || '', 'social-v2.json');
      const s = readJson(f, {});
      const at = Number(s?.lastIncomingAt) || 0;
      return at > 0 && Date.now() - at < 2 * 60 * 1000;
    } catch { return false; }
  }
  function activityOf(ctx) {
    if (ctx?.activity && ctx.activity.key) return ctx.activity;
    return classifyActivity({ app: ctx?.app || '', title: ctx?.title || ctx?.windowTitle || '', idleMs: ctx?.idleMs || 0 });
  }
  function isWritingContext(ctx) {
    const a = activityOf(ctx);
    return ['working', 'browsing', 'chatting', 'watching'].includes(a.key);
  }
  function appLabel(ctx) {
    const a = activityOf(ctx);
    if (a.key === 'working') return '写东西';
    if (a.key === 'browsing') return '看网页';
    if (a.key === 'chatting') return '聊天';
    if (a.key === 'watching') return '看视频';
    if (a.key === 'gaming') return '打游戏';
    return a.label || '电脑前';
  }
  function questionFor(ctx) {
    const a = activityOf(ctx);
    if (a.key === 'browsing') return '在看什么呀？我就在旁边，偷偷瞄一眼。';
    if (a.key === 'chatting') return '在跟谁聊呢？我有点好奇。';
    if (a.key === 'watching') return '在看什么呀？我陪你一起看一会儿。';
    return '在' + appLabel(ctx) + '忙这么久，在写什么呀？我就在旁边，偷偷看一眼。';
  }
  function gamePendingText(ctx) {
    const a = activityOf(ctx);
    return '你刚才在' + (a.label || '打游戏') + '，赢了没有呀？';
  }
  function dedupePending() {
    const live = store.pending().filter((x) => x && Number(x.expiresAt) > Date.now());
    const seen = new Set();
    const keep = [];
    for (let i = live.length - 1; i >= 0; i -= 1) {
      const key = String(live[i].text || '').replace(/\s+/g, ' ').trim();
      if (!key || seen.has(key)) continue;
      if (/(?:valorant|league of legends|steam|epic games|cs2|dota|minecraft)/i.test(key)) continue;
      seen.add(key);
      keep.push(live[i]);
    }
    keep.reverse();
    if (keep.length !== live.length) store.savePending(keep);
    return keep;
  }

  function addPending({ text, app = '', sourceEventId, preferredBody = 'qq', reason = '' }) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    const existing = dedupePending().find((x) => String(x.text || '').replace(/\s+/g, ' ').trim() === normalized);
    if (existing) return existing;
    const item = { id: 'pt_' + Date.now().toString(36), text: normalized, app, sourceEventId, preferredBody, reason, createdAt: Date.now() };
    store.addPending(item);
    const items = store.pending();
    if (items.length > maxPending) store.savePending(items.slice(-maxPending));
    return item;
  }

  function record(event) {
    const saved = store.append(event);
    try { memoryV3?.ingestBodyNow?.(); } catch {}
    return saved;
  }

  function attachWindow(ctx) {
    const w = ctx?.window || {};
    const screen = ctx?.screen || {};
    if (!Number(w.width) || !Number(w.height)) return null;
    const sw = Math.max(1, Number(screen.width) || 1920);
    const sh = Math.max(1, Number(screen.height) || 1080);
    const x = Math.max(0, Math.min(sw, Number(w.x) + Number(w.width) - 90));
    const y = Math.max(0, Math.min(sh, Number(w.y) + Number(w.height) - 80));
    return { x, y, nx: Math.max(0.02, Math.min(0.98, x / sw)), ny: Math.max(0.02, Math.min(0.98, y / sh)) };
  }

  async function maybeAsk(ctx, typingDurationMs) {
    if (!ctx || ctx.sensitive) return { ok: false, reason: 'sensitive' };
    try { await dshPet?.status?.(); } catch {}
    const bc = bodyConfig();
    if (bc?.behavior?.enabled === false || bc?.behavior?.allowBubble === false) return { ok: false, reason: 'behavior-disabled' };
    const needs = brainNeeds();
    const curiosity = Number(needs.curiosity) || 0;
    const social = Number(needs.social) || 0;
    if (typingDurationMs < 12_000) return { ok: false, reason: 'too-short' };
    if (curiosity < 45 && social < 45) return { ok: false, reason: 'not-motivated' };
    if (Date.now() - lastQuestionAt < 5 * 60_000) return { ok: false, reason: 'cooldown' };
    const activity = activityOf(ctx);
    if (activity.key === 'sensitive' || activity.key === 'away') return { ok: false, reason: activity.key };
    const target = attachWindow(ctx);
    if (target) {
      record({ body: 'pet', type: 'pet.approach', context: { target, app: ctx.app, windowTitle: ctx.title, activity }, memory: { eligible: true, summary: '她走到' + (activity.label || ctx.app || '当前窗口') + '旁边看了一会儿' } });
      try { await dshPet?.move?.({ x: target.nx, y: target.ny, mode: 'line', duration: 900 }); } catch {}
      try { chat?.emit?.({ type: 'pet-command', command: { type: 'walk_to', ...target, reason: 'curious' } }); } catch {}
      lastApproachAt = Date.now();
    }
    if (activity.key === 'gaming') {
      const item = addPending({ text: gamePendingText(ctx), app: ctx.app, sourceEventId: lastContext?.id || '', preferredBody: 'qq', reason: 'game-curiosity' });
      record({ body: 'pet', type: 'pet.look', context: { pendingId: item.id, app: ctx.app, activity }, memory: { eligible: true, summary: '她在旁边看爸打游戏，没打扰，想等会儿问结果' } });
      lastQuestionAt = Date.now();
      return { ok: true, deferred: true, pending: item, activity: activity.key };
    }
    if (!isWritingContext(ctx)) return { ok: false, reason: 'not-askable-context', activity: activity.key };
    const question = questionFor(ctx);
    const item = addPending({ text: question, app: ctx.app, sourceEventId: lastContext?.id || '', preferredBody: qqActive() ? 'qq' : 'pet', reason: 'desktop-curiosity' });
    record({ body: 'pet', type: 'pet.bubble', text: question, context: { pendingId: item.id, app: ctx.app, activity }, memory: { eligible: true, summary: '她好奇地问：' + question } });
    lastQuestionAt = Date.now();
    if (qqActive() || !petOnline()) return { ok: true, deferred: true, pending: item };
    try {
      const result = await withActiveLease({ stateDir: path.join(qqStateDir || stateDir || ''), owner: 'pet', action: 'pet_speak', ttlMs: 30_000, waitMs: 0 }, async () => {
        try {
          if (dshPet?.say) return await dshPet.say({ text: question, duration: 10000 });
          await chat?.proactive?.({ text: question, modality: 'text', purpose: { kind: 'curiosity' } });
          return { ok: true };
        } catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
      });
      if (!result?.ok) return { ok: true, deferred: true, pending: item, lease: result?.reason || result?.error };
      record({ body: 'pet', type: 'pet.voice', text: question, memory: { eligible: true, summary: '她对爸说了：' + question } });
      return { ok: true, spoken: true, pending: item };
    } catch (error) {
      return { ok: true, deferred: true, pending: item, error: String(error?.message ?? error) };
    }
  }

  function updateAttention(ctx) {
    const body = qqActive() ? 'qq' : (ctx?.typing ? 'pet' : 'bili');
    store.saveAttention({ body, reason: qqActive() ? 'qq-active' : (ctx?.typing ? 'desktop-aware' : 'idle'), at: Date.now(), context: ctx ? { app: ctx.app, typing: ctx.typing, sensitive: ctx.sensitive, activity: activityOf(ctx) } : null });
  }

  async function onDesktopEvent(event) {
    lastContext = { ...event, id: event.id };
    try { memoryV3?.ingestBodyNow?.(); } catch {}
    if (event.type === 'desktop.focus' || event.type === 'desktop.typing_start') {
      updateAttention(event.context || {});
    }
    if ((event.type === 'desktop.typing_end' || event.type === 'desktop.typing_progress') && Number(event.durationMs) >= 12_000) {
      await maybeAsk({ app: event.context?.app, title: event.context?.windowTitle, window: event.context?.rect, screen: event.context?.screen, activity: event.context?.activity }, Number(event.durationMs));
    }
    if (event.type === 'desktop.typing_start') {
      // 走近是 passive：不占主动槽；只在好奇/社交足够且冷却过了才靠近。
      const bc = bodyConfig();
      if (bc?.behavior?.enabled === false || bc?.behavior?.approachTyping === false) return;
      const activity = activityOf({ app: event.context?.app, title: event.context?.windowTitle, activity: event.context?.activity });
      if (activity.key === 'sensitive' || activity.key === 'away') return;
      const needs = brainNeeds();
      if ((Number(needs.curiosity) || 0) >= 45 || (Number(needs.social) || 0) >= 45) {
        if (Date.now() - lastApproachAt > 60_000) {
          const target = attachWindow(event.context || {});
          if (target) {
            record({ body: 'pet', type: 'pet.approach', context: { target, app: event.context?.app, windowTitle: event.context?.windowTitle }, memory: { eligible: true, summary: '她走到 ' + (event.context?.app || '当前窗口') + ' 旁边' } });
            try { await dshPet?.move?.({ x: target.nx, y: target.ny, mode: 'line', duration: 900 }); } catch {}
            try { chat?.emit?.({ type: 'pet-command', command: { type: 'walk_to', ...target, reason: 'curious' } }); } catch {}
            lastApproachAt = Date.now();
          }
        }
      }
    }
  }

  function start() {
    if (started) return status();
    started = true;
    dedupePending();
    desktop = createDesktopAwarenessService({
      bodyStore: store,
      enabled: bodyConfig()?.desktopAwareness !== false,
      intervalMs: 4000,
      onEvent: (event) => { void onDesktopEvent(event); },
      log: (m) => pluginLog(m),
    });
    desktop.start();
    store.saveAttention({ body: 'qq', reason: 'startup', at: Date.now() });
    return status();
  }
  function stop() { try { desktop?.stop?.(); } catch {} started = false; }
  function status() {
    return {
      body: 'pet',
      started,
      online: petOnline(),
      renderer: dshPet?.last?.() || null,
      bodyDir,
      desktop: desktop?.status?.() || { enabled: false },
      attention: store.attention(),
      pending: store.pending().filter((x) => Number(x.expiresAt) > Date.now()),
      events: store.list(20),
      pet: petService?.status?.() || null,
      brain: { needs: brainNeeds() },
    };
  }
  async function showRenderer() { try { return await dshPet?.setDisplay?.('desktop') || { ok: false, error: 'renderer 未连接' }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } }
  async function hideRenderer() { try { return await dshPet?.setDisplay?.('none') || { ok: false, error: 'renderer 未连接' }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } }
  return {
    start, stop, status, rendererStatus, showRenderer, hideRenderer,
    onDesktopEvent,
    pending: () => store.pending().filter((x) => Number(x.expiresAt) > Date.now()),
    resolvePending: (id) => store.resolvePending(id),
    addPending,
    events: (limit = 100) => store.list(limit),
    desktop: () => desktop?.status?.() || null,
    bodyDir: () => store.root,
  };
}
