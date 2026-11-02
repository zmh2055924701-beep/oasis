// Memory v3 nightly consolidation: ingest -> episodes/media/facts -> embeddings
// -> daily reflection -> self-model. No external messages; no persona writes.
import fs from 'node:fs';
import path from 'node:path';
import { createMemoryV3Store } from './store.js';
import { ingestAll, buildDailyReflection } from './ingest.js';
import { embedTexts, EMBED_MODEL } from './embed.js';
import { createEmptySelfModel, dayKey, clip, resolveMemoryV3Dir } from './schema.js';

function docText(x) {
  return [x.title, x.summary, x.text, x.topic, x.object, x.reaction, x.whyWatched, x.quotes?.join(' ')].filter(Boolean).join(' ');
}
function buildSelfModel({ characterId, episodes, facts, media, reflections, now }) {
  const model = createEmptySelfModel(characterId);
  const commitments = (facts || []).filter((f) => /承诺|计划/.test(f.predicate)).slice(-40).map((f) => ({
    text: f.object, confidence: f.confidence, sourceIds: f.sourceEventIds, at: f.validFrom,
  }));
  const rel = new Map();
  for (const ep of episodes || []) {
    for (const p of ep.participants || []) {
      if (!p || p === '可爱小蓝鲸') continue;
      const old = rel.get(p) || { name: p, interactions: 0, lastAt: 0, topics: [] };
      old.interactions += 1;
      old.lastAt = Math.max(old.lastAt, Number(ep.endedAt) || 0);
      if (ep.topic && old.topics.length < 6 && !old.topics.includes(ep.topic)) old.topics.push(ep.topic);
      rel.set(p, old);
    }
  }
  model.commitments = commitments;
  model.relationships = [...rel.values()].sort((a, b) => b.lastAt - a.lastAt).slice(0, 12);
  model.narrative = (reflections || []).slice(-7).map((r) => ({ day: r.day, summary: r.summary }));
  model.values = [
    { name: '安全边界', note: '不越过主人设定的隐私与外部动作边界' },
    { name: '连续自我', note: '记得自己经历过什么，不把猜测说成事实' },
    { name: '关系诚实', note: '亲近但不虚构承诺' },
  ];
  model.lastReflectionAt = new Date(now).toISOString();
  model.updatedAt = model.lastReflectionAt;
  model.stats = {
    episodes: episodes?.length || 0, facts: facts?.length || 0,
    media: media?.length || 0, reflections: reflections?.length || 0,
  };
  return model;
}
async function judgeEpisodes({ episodes = [], complete = null, now = Date.now(), maxItems = 8 } = {}) {
  if (!complete || typeof complete !== 'function') return episodes;
  const candidates = episodes
    .slice()
    .sort((a, b) => Number(b.importance || 0) - Number(a.importance || 0))
    .filter((e) => !e.selfImportance || e.judgedBy !== 'self')
    .slice(0, maxItems);
  const out = new Map(episodes.map((e) => [String(e.id), e]));
  for (const ep of candidates) {
    try {
      const result = await complete({
        system: '你是她自己的反思层。只判断这段经历“对你自己、对关系”有多重要；不要迎合，不要编造。只输出 JSON。',
        user: '日期：' + ep.day + '；情景：' + String(ep.summary || '').slice(0, 800) + '；情绪：' + String(ep.emotionalArc || '') + '。输出：{"selfImportance":0到1,"relationalImportance":0到1,"reason":"一句话理由","confidence":0到1}',
        maxTokens: 180,
        temperature: 0.5,
      });
      const raw = String(result?.text || result || '').trim();
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      let obj = null;
      if (start >= 0 && end > start) {
        try { obj = JSON.parse(raw.slice(start, end + 1)); } catch { obj = null; }
      }
      if (!obj) continue;
      const selfImportance = Math.max(0, Math.min(1, Number(obj.selfImportance) || 0));
      const relationalImportance = Math.max(0, Math.min(1, Number(obj.relationalImportance) || 0));
      if (selfImportance <= 0 && relationalImportance <= 0) continue;
      out.set(String(ep.id), {
        ...ep,
        selfImportance,
        relationalImportance,
        selfImportanceReason: String(obj.reason || '').slice(0, 300),
        judgedBy: 'self',
        judgedAt: now,
      });
    } catch { /* keep heuristic */ }
  }
  return [...out.values()];
}

function applyClarityDecay(episodes = [], media = [], now = Date.now()) {
  const rank = { vague: 0, trace: 1, fuzzy: 2, clear: 3, vivid: 4 };
  const label = ['vague', 'trace', 'fuzzy', 'clear', 'vivid'];
  const score = (x, at) => {
    const ageDays = Math.max(0, (now - Number(at)) / 86400000);
    const self = Number(x.selfImportance) || 0;
    const sys = Number(x.systemImportance ?? x.importance) || 0;
    const rehearsal = Math.min(1, (Number(x.rehearsalCount) || 0) / 8);
    const fresh = Math.exp(-ageDays / 45);
    return Math.max(0, Math.min(1, self * 0.38 + sys * 0.24 + rehearsal * 0.2 + fresh * 0.18));
  };
  const nextEpisodes = episodes.map((e) => {
    const s = score(e, e.endedAt || e.startedAt);
    const target = s >= 0.78 ? 4 : s >= 0.58 ? 3 : s >= 0.38 ? 2 : 1;
    let cur = rank[e.clarity] ?? 3;
    if (target < cur) cur = Math.max(target, cur - 1);
    else if (target > cur) cur = Math.min(target, cur + 1);
    return { ...e, clarity: label[cur] };
  });
  const nextMedia = media.map((m) => {
    const s = score(m, m.watchedAt);
    const target = s >= 0.78 ? 4 : s >= 0.58 ? 3 : s >= 0.38 ? 2 : 1;
    let cur = rank[m.clarity] ?? 3;
    if (target < cur) cur = Math.max(target, cur - 1);
    else if (target > cur) cur = Math.min(target, cur + 1);
    return { ...m, clarity: label[cur] };
  });
  return { episodes: nextEpisodes, media: nextMedia };
}

function linkMedia(media, episodes) {
  const byDay = new Map();
  for (const ep of episodes || []) {
    if (!byDay.has(ep.day)) byDay.set(ep.day, []);
    byDay.get(ep.day).push(ep.id);
  }
  return (media || []).map((m) => {
    const linked = byDay.get(m.day) || [];
    return { ...m, linkedEpisodeIds: linked.slice(0, 8) };
  });
}

export async function runSleepLearning({
  dir, characterId = 'default', inboxPath, watchPath, biliMemoryPath, fullArchivePath, bodyEventsPath,
  complete = null, now = Date.now(), force = false, embed = true,
} = {}) {
  const base = dir || resolveMemoryV3Dir({ characterId });
  const store = createMemoryV3Store({ dir: base, characterId });
  const state = store.readState();
  const day = dayKey(now);
  if (!force && state.lastSleepDay === day) {
    return { ok: true, skipped: true, reason: 'already-ran', day, stats: store.status() };
  }
  const ingested = ingestAll(store, { inboxPath, watchPath, biliMemoryPath, fullArchivePath, bodyEventsPath, now });
  const events = store.readEvents(6000);
  let episodes = store.readEpisodes();
  const facts = store.readFacts();
  let media = linkMedia(store.readMedia(), episodes);
  // 只让派生层模糊；raw events 永不删除。
  episodes = await judgeEpisodes({ episodes, complete, now, maxItems: 8 });
  const decayed = applyClarityDecay(episodes, media, now);
  episodes = decayed.episodes;
  media = decayed.media;
  store.saveEpisodes(episodes);
  store.saveMedia(media);
  let reflection = buildDailyReflection({ day, episodes, media, facts, events: events.filter((e) => e.day === day) });
  if (complete && typeof complete === 'function') {
    try {
      const text = await complete({
        system: '你是她的大脑整理器。只根据给定事件写一段 120 字以内的当日记忆摘要；不要编造，不要写人格设定。',
        user: '日期 ' + day + '\n' + reflection.summary,
        maxTokens: 220,
        temperature: 0.5,
      });
      const clean = String(text?.text || text || '').trim();
      if (clean) reflection.summary = clip(clean, 1200);
    } catch {}
  }
  const reflections = store.upsert(store.readReflections(), [reflection]);
  store.saveReflections(reflections.slice(-90));
  const selfModel = buildSelfModel({ characterId, episodes, facts, media, reflections, now });
  fs.mkdirSync(path.dirname(store.paths.selfModel), { recursive: true });
  fs.writeFileSync(store.paths.selfModel, JSON.stringify(selfModel, null, 2) + '\n', 'utf8');
  const dailyMd = [
    '# ' + day + ' 的记忆整理',
    '',
    reflection.summary,
    '',
    '## 主题',
    ...(reflection.themes.length ? reflection.themes.map((t) => '- ' + t) : ['- 无']),
    '',
    '## 看过的视频',
    ...(reflection.mediaTitles.length ? reflection.mediaTitles.map((t) => '- ' + t) : ['- 无']),
    '',
    '## 承诺',
    ...(selfModel.commitments.length ? selfModel.commitments.map((c) => '- ' + c.text) : ['- 无']),
  ].join('\n');
  store.writeDaily(day, { ...reflection, selfModelStats: selfModel.stats }, dailyMd);
  let vectors = 0;
  if (embed) {
    try {
      const docs = [
        ...episodes.map((x) => ({ id: x.id, text: docText(x) })),
        ...media.map((x) => ({ id: x.id, text: docText(x) })),
        ...facts.map((x) => ({ id: x.id, text: docText(x) + ' ' + x.subject + ' ' + x.predicate + ' ' + x.object })),
      ].filter((x) => x.text && x.text.trim());
      const existing = new Set(store.readVectors().map((v) => String(v.id)));
      const pending = docs.filter((x) => !existing.has(String(x.id))).slice(0, 500);
      if (pending.length) {
        const vecs = await embedTexts(pending.map((x) => x.text));
        store.saveVectors(pending.map((x, i) => ({ id: x.id, text: x.text, vec: vecs[i], model: EMBED_MODEL })));
        vectors = pending.length;
      }
    } catch {}
  }
  store.saveState({ lastSleepDay: day, lastSleepAt: new Date(now).toISOString(), lastSleepStats: { ingested, vectors, reflection: reflection.summary.slice(0, 120) } });
  return { ok: true, day, ingested, vectors, reflection, selfModel, stats: store.status() };
}
