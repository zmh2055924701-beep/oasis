// Memory v3 ingest: turn QQ/pet inbox + B站 watch history into
// MemoryEvent / Episode / MediaExperience / SemanticFact. No LLM required.
import fs from 'node:fs';
import path from 'node:path';
import {
  makeEvent, normalizeEpisode, normalizeMedia, normalizeFact,
  dayKey, clip, hashId, salienceOf, simpleEmotion,
} from './schema.js';

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean); }
  catch { return []; }
}
function textOf(ev) { return String(ev?.text || ev?.plain || '').trim(); }

// 旧全量卡是 immutable archive；这里只“复制”成 event layer，不删除旧文件。
export function ingestLegacyFullArchive(store, { fullArchivePath, limit = 5000, now = Date.now() } = {}) {
  if (!fullArchivePath || !fs.existsSync(fullArchivePath)) return { ok: true, added: 0, total: 0 };
  const lines = fs.readFileSync(fullArchivePath, 'utf8').split(String.fromCharCode(10)).filter(Boolean).slice(-limit);
  const events = [];
  for (const line of lines) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (!r || !r.id) continue;
    const platform = String(r.platform || (String(r.source || '').startsWith('bili') ? 'bili' : 'qq'));
    const scope = r.scope === 'bili' || r.scope === 'bili-public' ? 'bili-public'
      : r.scope === 'pet' ? 'pet'
        : (r.private === true ? 'private' : 'shared');
    const text = [r.text, r.botReply ? '她回：' + r.botReply : ''].filter(Boolean).join(' → ');
    events.push(makeEvent({
      id: 'legacy-' + r.id,
      at: r.createdAt, platform, kind: String(r.kind || r.source || 'legacy'),
      sender: r.speaker || '', isOwner: Array.isArray(r.tags) && r.tags.includes('owner'),
      isSelf: r.isSelf === true, conversationKey: r.conversationKey || '',
      private: r.private === true, text,
      summary: r.title || text,
      systemImportance: Math.max(0, Math.min(1, Number(r.importance) || 0) / 100),
      selfImportance: 0, clarity: r.clarity || 'clear',
      rehearsalCount: Number(r.recallCount) || 0,
      sourceRef: 'legacy:' + r.id,
    }, now));
  }
  const added = store.appendEvents(events);
  return { ok: true, added, total: events.length };
}

// Body events (pet L0 / pet actions) -> Memory v3 semantic events.
// Raw body events are append-only; here we only import meaningful summaries.
export function ingestBodyEvents(store, { bodyEventsPath, limit = 20000, now = Date.now() } = {}) {
  if (!bodyEventsPath || !fs.existsSync(bodyEventsPath)) return { ok: true, added: 0, total: 0 };
  const raw = readLines(bodyEventsPath).slice(-limit);
  const events = [];
  for (const ev of raw) {
    if (!ev || ev.memory?.eligible === false) continue;
    const type = String(ev.type || '');
    const summary = String(ev.memory?.summary || ev.text || '').trim();
    if (!summary) continue;
    // 移动/看这类高频动作只记“一次完整动作”，不把每帧写进语义层。
    if (['pet.walk', 'pet.look', 'pet.presence'].includes(type) && !ev.memory?.summary) continue;
    const at = Number(ev.at) || now;
    const isPetAction = type.startsWith('pet.');
    const isDesktop = type.startsWith('desktop.');
    events.push(makeEvent({
      id: 'body-' + String(ev.id || hashId(type + '|' + at + '|' + summary)),
      atMs: at,
      platform: 'pet',
      kind: 'body_' + type.replace(/\./g, '_'),
      sender: isPetAction ? '小肥鱼' : '爸',
      isOwner: isDesktop,
      isSelf: isPetAction,
      conversationKey: 'pet-desktop',
      scope: 'pet',
      private: true,
      text: summary,
      summary,
      salience: ev.memory?.salience ?? (isDesktop ? 0.45 : 0.55),
      sourceRef: 'body:' + String(ev.id || ''),
      systemImportance: ev.memory?.importance ?? 0.4,
    }, now));
  }
  const added = store.appendEvents(events);
  return { ok: true, added, total: events.length };
}

export function ingestInbox(store, { inboxPath, limit = 20000, now = Date.now() } = {}) {
  if (!inboxPath || !fs.existsSync(inboxPath)) return { ok: true, added: 0, total: 0 };
  const raw = readLines(inboxPath).slice(-limit);
  const events = [];
  for (const ev of raw) {
    const text = textOf(ev);
    if (!text) continue;
    events.push(makeEvent({
      at: ev.at, platform: ev.platform || 'qq', kind: ev.kind || 'message',
      sender: ev.sender, senderId: ev.senderId, isOwner: ev.isOwner === true,
      isSelf: ev.isSelf === true, conversationKey: ev.conversationKey,
      private: ev.private === true, direct: ev.direct === true, text,
      salience: salienceOf(text, ev), emotion: simpleEmotion(text),
    }, now));
  }
  const added = store.appendEvents(events);
  const state = store.readState();
  store.saveState({ ingestedInboxAt: new Date(now).toISOString(), inboxEvents: (Number(state.inboxEvents) || 0) + added });
  return { ok: true, added, total: events.length, totalStored: store.readEvents(0).length };
}

export function ingestBiliWatch(store, { watchPath, biliMemoryPath, now = Date.now() } = {}) {
  const raw = watchPath && fs.existsSync(watchPath) ? readLines(watchPath) : [];
  const mem = readJson(biliMemoryPath, null);
  const memEntries = Array.isArray(mem?.entries) ? mem.entries : [];
  const memByBvid = new Map();
  for (const e of memEntries) {
    const bv = String(e?.bvid || /BV[0-9A-Za-z]{10}/.exec(String(e?.text || ''))?.[0] || '');
    if (bv) memByBvid.set(bv, e);
  }
  const byBvid = new Map();
  for (const it of raw) {
    const bvid = String(it?.bvid || '');
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) continue;
    const old = byBvid.get(bvid);
    const watchedAt = Date.parse(String(it.at || '')) || now;
    const me = memByBvid.get(bvid);
    const rec = normalizeMedia({
      bvid,
      title: it.title, up: it.up, duration: it.duration,
      watchedAt: old ? Math.max(old.watchedAt, watchedAt) : watchedAt,
      mode: it.mode, frames: it.frames === true, sheet: it.sheet, subs: it.subs,
      whyWatched: old?.whyWatched || '从 B站 首页/推荐/关注流刷到，标题先吸引了她',
      summary: it.mode === 'full' ? '她完整看了这条，有字幕/弹幕/抽帧记录。' : '她看了简介/元信息，没有深读全片。',
      reaction: me?.reason || me?.anecdote || (it.score != null ? '她的评分：' + it.score : ''),
      quotes: me?.quote ? [me.quote] : [],
      tasteTags: [it.tname].filter(Boolean),
      scope: 'bili-public',
    });
    if (!old || rec.watchedAt >= old.watchedAt) byBvid.set(bvid, rec);
  }
  const current = store.readMedia();
  const merged = store.upsert(current, [...byBvid.values()]);
  store.saveMedia(merged);
  return { ok: true, watched: byBvid.size, mediaTotal: merged.length };
}

function termOf(text) {
  const s = String(text || '');
  const m = s.match(/「([^」]{2,30})」|《([^》]{2,30})》|#([^#]{2,20})#/);
  return m ? (m[1] || m[2] || m[3] || '') : clip(s.replace(/^[^:：]{0,20}[:：]/, ''), 24);
}
function participantsOf(events) {
  const names = new Set();
  for (const e of events) if (e.actor) names.add(e.actor);
  return [...names].slice(0, 12);
}
function scopeOfEvents(events) {
  if (events.some((e) => e.scope === 'private')) return 'private';
  if (events.some((e) => e.scope === 'bili-public')) return 'bili-public';
  if (events.some((e) => e.scope === 'pet')) return 'pet';
  return 'shared';
}

export function buildEpisodes(events, { gapMs = 90 * 60 * 1000 } = {}) {
  const sorted = (Array.isArray(events) ? events : [])
    .filter((e) => e && e.text && !e.isSelf || e && e.text && e.isSelf)
    .slice()
    .sort((a, b) => Number(a.at) - Number(b.at));
  const groups = [];
  let current = [];
  for (const ev of sorted) {
    const key = ev.conversationKey || ev.body || 'unknown';
    const last = current[current.length - 1];
    const same = last && (last.conversationKey || last.body) === key && Number(ev.at) - Number(last.at) <= gapMs;
    if (!same && current.length) { groups.push(current); current = []; }
    current.push(ev);
  }
  if (current.length) groups.push(current);
  const episodes = [];
  for (const g of groups) {
    if (!g.length) continue;
    const start = Number(g[0].at) || Date.now();
    const end = Number(g[g.length - 1].at) || start;
    const topic = g.map((e) => termOf(e.text)).find(Boolean) || '一段对话';
    const ownerLines = g.filter((e) => e.isOwner).map((e) => clip(e.text, 100));
    const selfLines = g.filter((e) => e.isSelf).map((e) => clip(e.text, 100));
    const part = participantsOf(g);
    const emotions = [...new Set(g.map((e) => e.emotion).filter((x) => x && x !== 'neutral'))];
    const unresolved = g.filter((e) => /[?？]|回头|再说|明天|等一下|等我/.test(e.text) && e.isOwner).map((e) => clip(e.text, 100)).slice(0, 4);
    const summaryParts = [];
    if (ownerLines.length) summaryParts.push('主人/对方：' + ownerLines.slice(0, 3).join(' / '));
    if (selfLines.length) summaryParts.push('她：' + selfLines.slice(0, 2).join(' / '));
    const ep = normalizeEpisode({
      id: 'ep-' + hashId(String(g[0].conversationKey || g[0].body) + '|' + start + '|' + topic),
      startedAt: start, endedAt: end, day: dayKey(start), body: g[0].body,
      scope: scopeOfEvents(g), participants: part, topic,
      summary: clip(summaryParts.join('；') || g.map((e) => e.text).join(' / '), 600),
      emotionalArc: emotions.join(' -> ') || '平静',
      unresolved, sourceEventIds: g.map((e) => e.id).slice(0, 80),
      importance: Math.max(0.2, ...g.map((e) => Number(e.salience) || 0)),
      systemImportance: Math.max(0.2, ...g.map((e) => Number(e.salience) || 0)),
      selfImportance: 0,
      judgedBy: 'heuristic',
      clarity: 'clear',
    });
    episodes.push(ep);
  }
  return episodes;
}

export function extractFacts(events, { now = Date.now() } = {}) {
  const facts = [];
  const add = (subject, predicate, object, ev, confidence = 0.6) => {
    if (!object || object.length < 2) return;
    facts.push(normalizeFact({
      subject, predicate, object: clip(object, 200), confidence,
      validFrom: ev?.at || now, sourceEventIds: ev?.id ? [ev.id] : [],
      scope: ev?.scope || 'shared', lastSeenAt: ev?.at || now,
    }));
  };
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || !ev.text) continue;
    const t = ev.text;
    if (!ev.isOwner && ev.scope !== 'private' && ev.scope !== 'pet') continue;
    const subject = ev.isOwner ? '主人' : (ev.actor || '对方');
    let m;
    if ((m = /我(?:最近|今天|明天|周末|这周|下周)?(?:在|要|得|去|忙|加班|工作|休息|考试|面试)[^。！？!?]{2,40}/.exec(t))) add(subject, '近况', m[0], ev, 0.62);
    if ((m = /我(?:喜欢|不喜欢|讨厌|想要|想买|想玩|爱吃|爱喝)[^。！？!?]{2,30}/.exec(t))) add(subject, '偏好', m[0], ev, 0.65);
    if ((m = /(?:答应|约定|说好|以后|下次|回头)[^。！？!?]{2,40}/.exec(t))) add(subject, '承诺/计划', m[0], ev, 0.7);
    if ((m = /(?:叫我|我叫|我的名字是|你可以叫我)[^。！？!?]{1,20}/.exec(t))) add(subject, '称呼', m[0], ev, 0.75);
    if ((m = /(?:我是|我在做|我的工作|我的专业)[^。！？!?]{2,40}/.exec(t))) add(subject, '身份/工作', m[0], ev, 0.6);
  }
  return facts;
}

export function buildDailyReflection({ day, episodes, media, facts, events = [] }) {
  const owners = (events || []).filter((e) => e.isOwner && !e.isSelf);
  const themes = [...new Set((episodes || []).map((e) => e.topic).filter(Boolean))].slice(0, 8);
  const mediaTitles = (media || []).filter((m) => m.day === day).map((m) => m.title).slice(0, 8);
  const commitmentFacts = (facts || []).filter((f) => /承诺|计划/.test(f.predicate) && f.day === day || false);
  const summary = [
    '今天有 ' + owners.length + ' 条主人直接消息、' + (episodes || []).length + ' 段对话情景、' + mediaTitles.length + ' 条 B站 观看。',
    themes.length ? '主题：' + themes.join('、') + '。' : '',
    mediaTitles.length ? '看过：' + mediaTitles.join('；') + '。' : '',
    '记住的不是流水账，而是这些场景里的情绪和未完成的事。',
  ].filter(Boolean).join('');
  return {
    id: 'ref-' + day,
    day,
    at: new Date().toISOString(),
    summary: clip(summary, 1600),
    themes,
    mediaTitles,
    ownerMessages: owners.length,
    episodes: (episodes || []).length,
    facts: (facts || []).length,
    commitments: commitmentFacts.map((f) => f.object).slice(0, 8),
    narrative: clip(summary, 1200),
  };
}

export function ingestAll(store, { inboxPath, watchPath, biliMemoryPath, fullArchivePath, bodyEventsPath, now = Date.now() } = {}) {
  const inbox = ingestInbox(store, { inboxPath, now });
  const body = ingestBodyEvents(store, { bodyEventsPath, now });
  const legacy = ingestLegacyFullArchive(store, { fullArchivePath, now });
  const bili = ingestBiliWatch(store, { watchPath, biliMemoryPath, now });
  const events = store.readEvents();
  const newEpisodes = buildEpisodes(events);
  const epMap = new Map(store.readEpisodes().map((e) => [e.id, e]));
  for (const ep of newEpisodes) epMap.set(ep.id, ep);
  store.saveEpisodes([...epMap.values()].slice(-2000));
  const newFacts = extractFacts(events, { now });
  const factMap = new Map(store.readFacts().map((f) => [f.id, f]));
  for (const f of newFacts) {
    const old = factMap.get(f.id);
    factMap.set(f.id, old ? { ...old, ...f, confidence: Math.max(old.confidence || 0, f.confidence || 0), lastSeenAt: now } : f);
  }
  store.saveFacts([...factMap.values()].slice(-3000));
  return { inbox, body, legacy, bili, episodes: store.readEpisodes().length, facts: store.readFacts().length };
}
