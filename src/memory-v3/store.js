// Memory v3 storage: append-only events, JSON snapshots for episodes/media/facts,
// vector index files, daily reflections and ingest state.
import fs from 'node:fs';
import path from 'node:path';
import { MEMORY_V3_VERSION, clip, iso, resolveMemoryV3Dir } from './schema.js';

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function atomicJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(16).slice(2, 8) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}
function appendLine(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + '\n', 'utf8');
}
function readLines(file, limit = 0) {
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    const picked = limit > 0 ? lines.slice(-limit) : lines;
    const out = [];
    for (const line of picked) { try { out.push(JSON.parse(line)); } catch {} }
    return out;
  } catch { return []; }
}

export function createMemoryV3Store({ dir, characterId = 'default' } = {}) {
  const base = resolveMemoryV3Dir({ dir, characterId });
  const paths = {
    base,
    events: path.join(base, 'events.jsonl'),
    episodes: path.join(base, 'episodes.json'),
    media: path.join(base, 'media.json'),
    facts: path.join(base, 'facts.json'),
    reflections: path.join(base, 'reflections.json'),
    vectors: path.join(base, 'vectors.bin'),
    vectorsMeta: path.join(base, 'vectors-meta.json'),
    state: path.join(base, 'state.json'),
    selfModel: path.join(base, 'self-model.json'),
    dailyDir: path.join(base, 'daily'),
  };
  ensureDir(base); ensureDir(paths.dailyDir);

  function readState() {
    return readJson(paths.state, { version: MEMORY_V3_VERSION, ingestedInboxAt: '', lastSleepDay: '', lastSleepAt: '', vectorModel: '' }) || {};
  }
  function saveState(patch) { const next = { ...readState(), ...patch, version: MEMORY_V3_VERSION }; atomicJson(paths.state, next); return next; }
  function appendEvents(events) {
    if (!Array.isArray(events) || !events.length) return 0;
    const seen = new Set(readEvents(20000).map((e) => String(e.id)));
    let added = 0;
    for (const ev of events) {
      if (!ev || !ev.id || seen.has(String(ev.id))) continue;
      appendLine(paths.events, ev); seen.add(String(ev.id)); added += 1;
    }
    return added;
  }
  function readEvents(limit = 0) { return readLines(paths.events, limit); }
  function readEpisodes() { const v = readJson(paths.episodes, []); return Array.isArray(v) ? v : []; }
  function saveEpisodes(list) { atomicJson(paths.episodes, Array.isArray(list) ? list : []); }
  function readMedia() { const v = readJson(paths.media, []); return Array.isArray(v) ? v : []; }
  function saveMedia(list) { atomicJson(paths.media, Array.isArray(list) ? list : []); }
  function readFacts() { const v = readJson(paths.facts, []); return Array.isArray(v) ? v : []; }
  function saveFacts(list) { atomicJson(paths.facts, Array.isArray(list) ? list : []); }
  function readReflections() { const v = readJson(paths.reflections, []); return Array.isArray(v) ? v : []; }
  function saveReflections(list) { atomicJson(paths.reflections, Array.isArray(list) ? list : []); }
  function upsert(list, items) {
    const map = new Map((Array.isArray(list) ? list : []).map((x) => [String(x.id), x]));
    for (const item of items || []) if (item && item.id) map.set(String(item.id), item);
    return [...map.values()];
  }
  function writeDaily(day, data, text) {
    ensureDir(paths.dailyDir);
    atomicJson(path.join(paths.dailyDir, day + '.json'), data);
    if (text) fs.writeFileSync(path.join(paths.dailyDir, day + '.md'), String(text), 'utf8');
  }
  function readDaily(day) { return readJson(path.join(paths.dailyDir, day + '.json'), null); }
  function saveVectors(records) {
    const items = (Array.isArray(records) ? records : []).filter((x) => x && x.id && x.vec && x.vec.length);
    if (!items.length) return;
    const old = readVectors();
    const map = new Map(old.map((x) => [x.id, x]));
    for (const item of items) map.set(String(item.id), { id: String(item.id), text: clip(item.text || '', 1200), vec: Array.from(item.vec), model: String(item.model || '') });
    const all = [...map.values()].slice(-4000);
    const dim = all[0]?.vec?.length || 0;
    const buf = Buffer.alloc(all.length * dim * 4);
    let offset = 0;
    for (const item of all) {
      for (let i = 0; i < dim; i += 1) { buf.writeFloatLE(Number(item.vec[i]) || 0, offset); offset += 4; }
    }
    fs.writeFileSync(paths.vectors, buf);
    atomicJson(paths.vectorsMeta, { version: MEMORY_V3_VERSION, dim, count: all.length, model: all[0]?.model || '', at: iso(), ids: all.map((x) => x.id) });
  }
  function readVectors() {
    const meta = readJson(paths.vectorsMeta, null);
    if (!meta || !meta.dim || !Array.isArray(meta.ids)) return [];
    let buf;
    try { buf = fs.readFileSync(paths.vectors); } catch { return []; }
    const dim = Number(meta.dim) || 0;
    const out = [];
    for (let n = 0; n < meta.ids.length; n += 1) {
      const off = n * dim * 4;
      if (off + dim * 4 > buf.length) break;
      const vec = new Float32Array(dim);
      for (let i = 0; i < dim; i += 1) vec[i] = buf.readFloatLE(off + i * 4);
      out.push({ id: String(meta.ids[n]), vec, model: String(meta.model || '') });
    }
    return out;
  }
  function status() {
    return {
      base,
      events: readEvents().length,
      episodes: readEpisodes().length,
      media: readMedia().length,
      facts: readFacts().length,
      reflections: readReflections().length,
      vectors: readVectors().length,
      state: readState(),
    };
  }
  return {
    paths, characterId,
    readState, saveState,
    appendEvents, readEvents,
    readEpisodes, saveEpisodes,
    readMedia, saveMedia,
    readFacts, saveFacts,
    readReflections, saveReflections,
    upsert,
    writeDaily, readDaily,
    saveVectors, readVectors,
    status,
  };
}
