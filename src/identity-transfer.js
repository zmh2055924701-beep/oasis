// 身份事件跨设备导出/导入（P5 多设备基础）。
// 不做冲突合并；导入方按自己的 seq 重新编号，保留原 eventId/时间在 payload.source。
import fs from 'node:fs';
import path from 'node:path';
import { resolveIdentityPaths, appendIdentityEvent, loadIdentityState } from './identity-core.js';

function readEventLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

export function exportIdentity({ dataDir, characterId, outFile, sinceSeq = 0 } = {}) {
  const paths = resolveIdentityPaths({ dataDir, characterId });
  const { state } = loadIdentityState({ dataDir, characterId });
  const events = readEventLines(paths.events).filter((e) => Number(e.seq) > Number(sinceSeq || 0));
  const payload = {
    version: 1,
    characterId: String(characterId || 'default'),
    exportedAt: new Date().toISOString(),
    fromSeq: Number(sinceSeq) || 0,
    toSeq: Number(state.seq) || 0,
    count: events.length,
    events,
  };
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, outFile, count: events.length, fromSeq: payload.fromSeq, toSeq: payload.toSeq };
}

export function importIdentity({ dataDir, characterId, inFile } = {}) {
  const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  if (!raw || raw.version !== 1 || !Array.isArray(raw.events)) throw new Error('身份包格式不对');
  const before = loadIdentityState({ dataDir, characterId }).state.seq;
  let imported = 0;
  for (const e of raw.events) {
    if (!e || !e.body || !e.text) continue;
    appendIdentityEvent({
      dataDir, characterId,
      body: e.body, actor: e.actor || 'system', type: e.type || 'imported',
      text: e.text, visibility: e.visibility || '', payload: { ...(e.payload || {}), sourceEventId: e.eventId || null, sourceCharacterId: e.characterId || raw.characterId || null },
      risk: Number(e.risk) || 0, correlationId: e.correlationId || '', causationId: e.causationId || '',
      now: Date.parse(e.at) || Date.now(),
    });
    imported++;
  }
  const after = loadIdentityState({ dataDir, characterId }).state.seq;
  return { ok: true, imported, fromSeq: Number(raw.fromSeq) || 0, toSeq: Number(raw.toSeq) || 0, beforeSeq: before, afterSeq: after };
}
