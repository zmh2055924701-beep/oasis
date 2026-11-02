// B站身体 → 身份内核同步（P1）：把 B站行为日志的新条目变成实时事件。
// 插件进程是 B站 的执行宿主；桥接是身份内核的唯一写者，所以这里通过桥接 API 写。
import fs from 'node:fs';
import path from 'node:path';
import { activeBiliDir } from '../../../src/character-persona.js';

const POLL_MS = 10 * 1000;
const MAX_BATCH = 20;

function readJson(file, fallback) {
  try { const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

export function createIdentitySync({ stateDir, callBridge = null, pluginLog = () => {}, biliDir = null } = {}) {
  const stateFile = path.join(stateDir, 'identity-sync.json');
  let timer = null;
  let running = false;

  function readState() {
    return readJson(stateFile, { biliFile: '', offset: 0, seeded: false, at: 0 });
  }
  function writeState(s) {
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(s, null, 2), 'utf8'); } catch {}
  }

  async function post(event) {
    if (!callBridge) return false;
    try {
      const result = await callBridge('/api/identity/event', { method: 'POST', body: event, timeoutMs: 5000 });
      return Boolean(result?.data?.ok ?? result?.ok);
    } catch { return false; }
  }

  /** 同步一次；seed=true 时把已有历史尾部补进身份记忆（只做一次）。 */
  async function syncOnce({ seed = false } = {}) {
    const dir = biliDir || activeBiliDir();
    if (!dir) return { ok: false, reason: 'no-bili-dir' };
    const file = path.join(dir, 'whale-log.jsonl');
    if (!fs.existsSync(file)) return { ok: false, reason: 'no-log' };
    const state = readState();
    if (state.biliFile !== file) {
      state.biliFile = file;
      state.offset = 0;
      state.seeded = false;
    }
    let stat;
    try { stat = fs.statSync(file); } catch { return { ok: false, reason: 'stat-failed' }; }
    if (stat.size < Number(state.offset) || stat.size === 0) state.offset = 0;
    if (!state.seeded && stat.size > 0) {
      // 第一次：只把最近 12 条补进来，避免把几年历史全灌进实时事件。
      const text = fs.readFileSync(file, 'utf8');
      const lines = text.split('\n').filter(Boolean).slice(-12);
      for (const line of lines) await publishLine(line);
      state.offset = stat.size;
      state.seeded = true;
      state.at = Date.now();
      writeState(state);
      return { ok: true, seeded: lines.length };
    }
    if (stat.size <= Number(state.offset)) return { ok: true, added: 0 };
    let chunk = '';
    try {
      const fd = fs.openSync(file, 'r');
      const len = stat.size - Number(state.offset);
      const buf = Buffer.alloc(Math.min(len, 512 * 1024));
      fs.readSync(fd, buf, 0, buf.length, Number(state.offset));
      fs.closeSync(fd);
      chunk = buf.toString('utf8');
    } catch { return { ok: false, reason: 'read-failed' }; }
    const complete = chunk.endsWith('\n') ? chunk : chunk.slice(0, chunk.lastIndexOf('\n') + 1);
    const lines = complete.split('\n').filter(Boolean).slice(0, MAX_BATCH);
    let added = 0;
    for (const line of lines) { if (await publishLine(line)) added++; }
    state.offset = Number(state.offset) + Buffer.byteLength(complete, 'utf8');
    state.at = Date.now();
    writeState(state);
    if (added) pluginLog('[identity-sync] B站新事件 ' + added + ' 条已写入身份内核');
    return { ok: true, added };
  }

  async function publishLine(line) {
    let item;
    try { item = JSON.parse(line); } catch { return false; }
    const kind = String(item?.kind || '').slice(0, 40);
    const note = String(item?.note || '').slice(0, 300);
    if (!kind && !note) return false;
    return post({
      body: 'bili',
      actor: 'self',
      type: 'bili_action',
      visibility: 'public',
      text: '[B站] ' + (kind || '动作') + (note ? '：' + note : ''),
      payload: { kind, target: item?.target ?? null, at: item?.at || null },
      risk: 0,
    });
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      if (running) return;
      running = true;
      void syncOnce().catch((error) => pluginLog('[identity-sync] 同步失败：', String(error?.message ?? error))).finally(() => { running = false; });
    }, POLL_MS);
    timer.unref?.();
    setTimeout(() => { void syncOnce().catch(() => {}); }, 5000).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, syncOnce, status: () => ({ ...readState(), timer: Boolean(timer) }) };
}
