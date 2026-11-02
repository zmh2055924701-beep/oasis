// B站 动态口味：最近 24h 历史 + 情绪 -> oasis-taste.json；不靠主人手填。
import fs from 'node:fs';
import path from 'node:path';
import { activePlatformStateDir, readCurrentCharacter } from '../../../src/character-persona.js';
import { deriveTasteWeights } from '../../../src/oasis-bili-taste.js';
import { readBiliConfig, readUnified, readJson } from './store.js';
import { BILI_DIR } from './paths.js';

function readBrain() {
  try {
    const u = readUnified().config || {};
    const d = u.socialV2?.brain?.dataDir || 'state/brain';
    const id = readCurrentCharacter()?.id || 'default';
    return readJson(path.join(d, id, 'brain-state.json'), {}) || {};
  } catch { return {}; }
}
function readHistory(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'watch-history.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-200).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
export function createBiliTasteService({ stateDir, pluginLog = () => {}, intervalMs = 10 * 60 * 1000 } = {}) {
  let timer = null;
  const dir = () => activePlatformStateDir(BILI_DIR);
  const file = () => path.join(dir(), 'oasis-taste.json');
  function latest() { return readJson(file(), null); }
  function recompute(now = Date.now()) {
    const cfg = readBiliConfig().config || {};
    const labels = Array.isArray(cfg.preferences?.like) ? cfg.preferences.like : [];
    const result = deriveTasteWeights({ labels, history: readHistory(dir()), affect: readBrain(), now });
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(result, null, 2) + '\n', 'utf8');
    pluginLog('[bili-taste] 已更新 ' + result.rows.length + ' 个口味权重');
    return result;
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { try { recompute(); } catch (error) { pluginLog('[bili-taste] 失败：' + String(error?.message ?? error)); } }, intervalMs);
    timer.unref?.();
    setTimeout(() => { try { recompute(); } catch {} }, 25_000).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, recompute, latest, status: () => ({ file: file(), latest: latest() }) };
}
