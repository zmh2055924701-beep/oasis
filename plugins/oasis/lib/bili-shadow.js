// Oasis B站动机引擎 shadow 服务（P2 第一步）：只算建议，不执行。
import fs from 'node:fs';
import path from 'node:path';
import { planBiliActivity, DEFAULT_BILI_DRIVE } from '../../../src/bili-motivation.js';
import { readCurrentCharacter } from '../../../src/character-persona.js';
import { readQqConfig } from './store.js';

function readJson(file, fallback) { try { const s = fs.readFileSync(file, 'utf8'); return s.trim() ? JSON.parse(s) : fallback; } catch { return fallback; } }
export function createBiliShadowService({ stateDir, pluginLog = () => {}, intervalMs = 10 * 60 * 1000 } = {}) {
  let timer = null;
  function brainDir() {
    try {
      const c = readQqConfig().config || {};
      const id = readCurrentCharacter()?.id || 'default';
      return path.join(c.socialV2?.brain?.dataDir || 'state/brain', id);
    } catch { return ''; }
  }
  function decide(now = Date.now()) {
    const dir = brainDir();
    const brain = readJson(path.join(dir, 'brain-state.json'), {});
    const result = planBiliActivity({ now, brain, config: { ...DEFAULT_BILI_DRIVE } });
    const file = path.join(stateDir, 'bili-shadow-decisions.jsonl');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ at: new Date(now).toISOString(), brainDir: dir, result }) + '\n', 'utf8');
    return result;
  }
  function latest() {
    try {
      const lines = fs.readFileSync(path.join(stateDir, 'bili-shadow-decisions.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-1);
      return lines.length ? JSON.parse(lines[0]) : null;
    } catch { return null; }
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { try { const r = decide(); pluginLog('[bili-shadow] ' + r.action + (r.requiresApproval ? '（需审批）' : '')); } catch (error) { pluginLog('[bili-shadow] 失败：' + String(error?.message ?? error)); } }, intervalMs);
    timer.unref?.();
    setTimeout(() => { try { decide(); } catch {} }, 20_000).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, decide, latest, status: () => ({ file: path.join(stateDir, 'bili-shadow-decisions.jsonl'), latest: latest() }) };
}
