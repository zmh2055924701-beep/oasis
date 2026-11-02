// Memory v3 plugin service: backfill, nightly sleep learning, retrieval API.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { activeMemoryPaths, activeBiliDir, readCurrentCharacter } from '../../../src/character-persona.js';
import { createMemoryV3Store } from '../../../src/memory-v3/store.js';
import { resolveMemoryV3Dir, dayKey } from '../../../src/memory-v3/schema.js';
import { ingestAll, ingestBodyEvents } from '../../../src/memory-v3/ingest.js';
import { runSleepLearning } from '../../../src/memory-v3/sleep.js';
import { search, searchSync, formatMemoryBlock, memoryPromptBlock } from '../../../src/memory-v3/retrieval.js';
import { arbitrateBodyCandidates } from '../../../src/memory-v3/self-arbiter.js';
import { buildTiers } from '../../../src/memory-v3/tiers.js';
import { buildNotes } from '../../../src/memory-v3/notes.js';
import { buildDerived } from '../../../src/memory-v3/derived.js';
import { buildLegacyMeta } from '../../../src/memory-v3/meta.js';

function inboxPath() {
  try { return path.join(path.dirname(activeMemoryPaths().json), 'memory-inbox.jsonl'); }
  catch { return ''; }
}
function watchPath() {
  try { return path.join(activeBiliDir(), 'watch-history.jsonl'); }
  catch { return ''; }
}
function biliMemoryPath() {
  try { return path.join(activeBiliDir(), 'bili-memory.json'); }
  catch { return ''; }
}
function fullArchivePath() {
  try { return activeMemoryPaths().fullJsonl || path.join(path.dirname(activeMemoryPaths().json), 'memory-card-full.jsonl'); }
  catch { return ''; }
}
function bodyEventsPath() {
  try { return path.join(activeMemoryPaths().dir, '..', 'body', 'events.jsonl'); }
  catch { return ''; }
}

export function createMemoryV3Service({ pluginLog = () => {}, chat = null } = {}) {
  let timer = null;
  let bootTimer = null;
  let running = false;
  function characterId() {
    try { return readCurrentCharacter()?.id || 'default'; } catch { return 'default'; }
  }
  function dir() { return resolveMemoryV3Dir({ characterId: characterId() }); }
  function store() { return createMemoryV3Store({ dir: dir(), characterId: characterId() }); }
  function backfill() {
    try { return ingestAll(store(), { inboxPath: inboxPath(), watchPath: watchPath(), biliMemoryPath: biliMemoryPath(), fullArchivePath: fullArchivePath(), bodyEventsPath: bodyEventsPath(), now: Date.now() }); }
    catch (error) { pluginLog('[memory-v3] 回填失败：' + String(error?.message ?? error).slice(0, 160)); return null; }
  }
  async function learnNow({ force = false } = {}) {
    if (running) return { ok: false, reason: 'running' };
    running = true;
    try {
      const result = await runSleepLearning({
        dir: dir(), characterId: characterId(), inboxPath: inboxPath(),
        watchPath: watchPath(), biliMemoryPath: biliMemoryPath(), fullArchivePath: fullArchivePath(), bodyEventsPath: bodyEventsPath(),
        complete: chat?.complete ? chat.complete.bind(chat) : null,
        now: Date.now(), force,
      });
      pluginLog('[memory-v3] 睡眠整理：' + (result.skipped ? '跳过 ' + result.reason : '完成 ' + result.day + '，向量 ' + (result.vectors || 0)));
      // MP-3/4/5/6 derived indexes only; raw episodes/facts are untouched.
      try { result.derived = (result.skipped ? null : rebuildDerived()); } catch {}
      return result;
    } catch (error) {
      pluginLog('[memory-v3] 睡眠整理失败：' + String(error?.message ?? error).slice(0, 200));
      return { ok: false, error: String(error?.message ?? error) };
    } finally { running = false; }
  }
  function dueForSleep(now = Date.now()) {
    const st = store().readState();
    if (st.lastSleepDay === dayKey(now)) return false;
    const h = new Date(now).getHours();
    // 04:00-06:59 正常窗口；07:00-09:00 只补跑一次当天。
    return h >= 4 && h <= 9;
  }
  async function tick() {
    if (running) return;
    try {
      // 每 10 分钟做一次轻量摄取，保证对话/观看经历不用等到睡眠才进 v3。
      backfill();
      if (dueForSleep(Date.now())) await learnNow({ force: false });
    } catch (error) { pluginLog('[memory-v3] tick 失败：' + String(error?.message ?? error).slice(0, 160)); }
  }
  function start() {
    bootTimer = setTimeout(() => { void tick(); }, 30_000); bootTimer.unref?.();
    timer = setInterval(() => { void tick(); }, 10 * 60 * 1000); timer.unref?.();
  }
  function stop() { if (timer) clearInterval(timer); if (bootTimer) clearTimeout(bootTimer); timer = null; bootTimer = null; }
  async function recall(query, { scopes = null, limit = 6, semantic = true, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
    const items = await search({ dir: dir(), characterId: characterId(), query, scopes, limit, semantic, excludeRecentMs, excludeSourceIds });
    return { items, block: formatMemoryBlock(items) };
  }
  function recallSync(query, { scopes = null, limit = 5, excludeRecentMs = 0, excludeSourceIds = [] } = {}) {
    return memoryPromptBlock({ dir: dir(), characterId: characterId(), query, scopes, limit, excludeRecentMs, excludeSourceIds });
  }
  function ingestBodyNow() {
    try { return ingestBodyEvents(store(), { bodyEventsPath: bodyEventsPath(), now: Date.now() }); }
    catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }
  function status() { try { return store().status(); } catch (error) { return { error: String(error?.message ?? error) }; } }
  function selfModel() { try { return JSON.parse(fs.readFileSync(store().paths.selfModel, 'utf8')); } catch { return null; } }
  function tiers() {
    try {
      const s = store();
      return buildTiers({ episodes: s.readEpisodes(), facts: s.readFacts(), now: Date.now() });
    } catch (error) { return { error: String(error?.message ?? error), stats: { core: 0, working: 0, archival: 0, rawDeleted: 0 } }; }
  }
  function notesSummary() {
    try {
      const s = store();
      const n = buildNotes({ episodes: s.readEpisodes(), facts: s.readFacts(), now: Date.now() });
      return { version: n.version, generatedAt: n.generatedAt, stats: n.stats, sample: n.notes.slice(-8) };
    } catch (error) { return { error: String(error?.message ?? error), stats: { total: 0, links: 0, rawDeleted: 0 }, sample: [] }; }
  }
  function derivedSummary() {
    try {
      const s = store();
      return buildDerived({ episodes: s.readEpisodes(), facts: s.readFacts(), now: Date.now() });
    } catch (error) { return { error: String(error?.message ?? error), rawDeleted: 0 }; }
  }
  function writeJsonAtomic(file, value) {
    const tmp = file + '.tmp-' + process.pid;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, file);
  }
  function readLegacyCard() {
    try {
      const p = activeMemoryPaths().json;
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return { records: [] }; }
  }
  function legacyMetaDoc({ now = Date.now(), persist = false } = {}) {
    try {
      const s = store();
      const card = readLegacyCard();
      const doc = buildLegacyMeta({
        cardRecords: Array.isArray(card.records) ? card.records : [],
        events: s.readEvents(10000), episodes: s.readEpisodes(), facts: s.readFacts(), now,
      });
      if (persist) {
        const outDir = path.join(dir(), 'meta');
        const file = path.join(outDir, 'legacy-meta.json');
        const backupDir = path.join(dir(), '_backups', 'legacy-meta-' + new Date(now).toISOString().replace(/[:.]/g, '-'));
        if (fs.existsSync(file)) {
          fs.mkdirSync(backupDir, { recursive: true });
          fs.copyFileSync(file, path.join(backupDir, 'legacy-meta.json'));
        }
        writeJsonAtomic(file, doc);
      }
      return doc;
    } catch (error) { return { version: 1, generatedAt: new Date(now).toISOString(), stats: { error: String(error?.message ?? error), rawDeleted: 0 }, records: [] }; }
  }
  function metaSummary() {
    const doc = legacyMetaDoc();
    return { stats: doc.stats, sample: (doc.records || []).slice(0, 8), generatedAt: doc.generatedAt };
  }
  function metaList({ q = '', status = '', limit = 40 } = {}) {
    const doc = legacyMetaDoc();
    const needle = String(q || '').trim().toLowerCase();
    return (doc.records || []).filter((r) => {
      if (status && r.archiveStatus !== status) return false;
      if (!needle) return true;
      return String(r.text || '').toLowerCase().includes(needle);
    }).slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
  }
  function rebuildDerived() {
    try {
      const s = store();
      const episodes = s.readEpisodes();
      const facts = s.readFacts();
      const now = Date.now();
      const tiers = buildTiers({ episodes, facts, now });
      const notes = buildNotes({ episodes, facts, now });
      const derived = buildDerived({ episodes, facts, now });
      const outDir = path.join(dir(), 'derived');
      const backupDir = path.join(dir(), '_backups', 'derived-' + new Date(now).toISOString().replace(/[:.]/g, '-'));
      if (fs.existsSync(outDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
        for (const name of fs.readdirSync(outDir)) {
          fs.copyFileSync(path.join(outDir, name), path.join(backupDir, name));
        }
      }
      fs.mkdirSync(outDir, { recursive: true });
      writeJsonAtomic(path.join(outDir, 'tiers.json'), tiers);
      writeJsonAtomic(path.join(outDir, 'notes.json'), notes);
      writeJsonAtomic(path.join(outDir, 'hierarchy.json'), derived.hierarchy);
      writeJsonAtomic(path.join(outDir, 'forgetting.json'), derived.forgetting);
      writeJsonAtomic(path.join(outDir, 'eval.json'), derived.eval);
      writeJsonAtomic(path.join(outDir, 'manifest.json'), { version: 1, builtAt: new Date(now).toISOString(), rawDeleted: 0, counts: derived.eval });
      let legacy = null;
      try { legacy = legacyMetaDoc({ now, persist: true }).stats; } catch {}
      return { ok: true, rawDeleted: 0, outDir, stats: { ...derived.eval, legacyMeta: legacy?.matched ?? null } };
    } catch (error) { return { ok: false, rawDeleted: 0, error: String(error?.message ?? error) }; }
  }
  function arbitrate(candidates, brain = {}) { return arbitrateBodyCandidates({ brain, candidates }); }
  return { start, stop, tick, learnNow, backfill, ingestBodyNow, recall, recallSync, status, selfModel, tiers, notesSummary, derivedSummary, metaSummary, metaList, rebuildDerived, arbitrate, dir, dueForSleep };
}
