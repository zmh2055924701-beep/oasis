// Memory v4 Phase 1: legacy memory-card metadata -> derived view.
// This module never edits memory-card or Memory v3 raw files.
import { computeStrength } from './forgetting.js';

function normText(s) {
  return String(s || '').replace(/\s+/g, ' ').replace(/[“”"'']/g, '').trim().toLowerCase();
}
function tsOf(x) {
  const n = Number(x?.endedAt || x?.startedAt || x?.at || x?.createdAt || 0);
  return Number.isFinite(n) ? n : 0;
}

export function buildLegacyMeta({ cardRecords = [], events = [], episodes = [], facts = [], now = Date.now() } = {}) {
  const evById = new Map(events.map((e) => [String(e.id || ''), e]));
  const evBySource = new Map();
  for (const e of events) {
    const ref = String(e.sourceRef || '');
    if (ref.startsWith('legacy:')) evBySource.set(ref.slice('legacy:'.length), e);
  }
  const evByText = new Map();
  for (const e of events) {
    const k = normText(e.text || e.summary);
    if (k && !evByText.has(k)) evByText.set(k, e);
  }
  const epByEvent = new Map();
  for (const ep of episodes) for (const id of ep.sourceEventIds || []) {
    if (!epByEvent.has(String(id))) epByEvent.set(String(id), []);
    epByEvent.get(String(id)).push(ep);
  }
  const records = [];
  let sourceMatched = 0, textMatched = 0, missing = 0;
  for (const card of cardRecords) {
    const cardId = String(card.id || '');
    let event = evBySource.get(cardId) || null;
    let matchedBy = event ? 'sourceRef' : '';
    if (!event) {
      event = evByText.get(normText(card.text || card.title)) || null;
      matchedBy = event ? 'text' : '';
    }
    if (!event) { missing += 1; records.push({ cardId, matchedBy: '', archiveStatus: 'unmatched', text: String(card.text || '').slice(0, 160) }); continue; }
    if (matchedBy === 'sourceRef') sourceMatched += 1; else textMatched += 1;
    const ep = (epByEvent.get(String(event.id)) || [])[0] || null;
    const ageDays = Math.max(0, (now - tsOf(event)) / 86400000);
    const clarity = String(card.clarity || event.clarity || 'clear');
    const isCore = card.pinned === true || card.anchor === true || Number(card.importance) >= 85
      || /承诺|约定|关系|身份|称呼|promise|relationship|identity/.test(String(card.kind || '') + String(card.tags || '') + String(card.text || ''));
    const strength = computeStrength({
      importance: Math.max(0, Math.min(1, Number(card.importance) / 100 || 0)),
      rehearsal: Math.min(1, Number(card.recallCount) || 0),
      ageDays, clarity,
    });
    // fullArchivedAt is migration provenance, not current archive status; only a
    // genuinely forgotten record is shown as archived.
    const archived = String(card.clarity || '') === 'forgotten';
    const archiveStatus = isCore ? 'core' : archived ? 'archived' : strength < 0.15 ? 'candidate' : 'active';
    records.push({
      cardId,
      eventId: String(event.id || ''),
      episodeId: ep ? String(ep.id || '') : '',
      factIds: (facts || []).filter((f) => (f.sourceEventIds || []).includes(event.id)).map((f) => String(f.id)).slice(0, 4),
      matchedBy,
      text: String(card.text || event.text || '').slice(0, 240),
      importance: Number(card.importance) || 0,
      importanceLabel: Number(card.importance) >= 80 ? 'high' : Number(card.importance) >= 50 ? 'medium' : 'low',
      importanceReasons: Array.isArray(card.importanceReasons) ? card.importanceReasons.slice(0, 5) : [],
      pinned: card.pinned === true,
      anchor: card.anchor === true,
      clarity,
      decaySteps: Number(card.decaySteps) || 0,
      recallCount: Number(card.recallCount) || 0,
      firstMet: card.firstMet === true || card.firstMeet === true,
      initialTier: card.initialTier || '',
      createdAt: tsOf(event) || Number(card.createdAt) || 0,
      sensitive: card.sensitive === true,
      strength: Number(strength.toFixed(4)),
      ageDays: Math.round(ageDays),
      archiveStatus,
      archiveReason: archiveStatus === 'core' ? 'pinned/anchor/importance/core-kind'
        : archiveStatus === 'candidate' ? 'strength<' + 0.15
          : archiveStatus === 'archived' ? 'old-card-full-archived' : 'strength>=0.15',
    });
  }
  const stats = {
    cardRecords: cardRecords.length,
    matched: sourceMatched + textMatched,
    sourceMatched, textMatched, missing,
    pinned: records.filter((r) => r.pinned).length,
    anchor: records.filter((r) => r.anchor).length,
    firstMet: records.filter((r) => r.firstMet).length,
    high: records.filter((r) => r.importanceLabel === 'high').length,
    core: records.filter((r) => r.archiveStatus === 'core').length,
    candidates: records.filter((r) => r.archiveStatus === 'candidate').length,
    archived: records.filter((r) => r.archiveStatus === 'archived').length,
    avgImportance: records.length ? Number((records.reduce((s, r) => s + (r.importance || 0), 0) / records.length).toFixed(1)) : 0,
    rawDeleted: 0,
  };
  return { version: 1, generatedAt: new Date(now).toISOString(), stats, records };
}
