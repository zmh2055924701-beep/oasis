// B站「收到的赞」感知层：只把通知流同步成记忆快照，不自动发 QQ、不自动回馈。
// 是否提起、什么时候提起，交给 B站/QQ 的人格、情绪与记忆系统。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readBiliConfig } from './store.js';

function nodeExe() {
  return process.env.DSH_NODE || path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe');
}
function biliMjs() { return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'bili.mjs'); }
function loadJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function saveJson(file, data) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8'); } catch {} }
function ownerMidOf(cfg) { return String(cfg.owner?.mid || ''); }
function normalizeItem(it, ownerMid) {
  const users = Array.isArray(it.users) ? it.users : [];
  return {
    id: String(it.id || ''),
    at: Number(it.like_time || 0) * 1000,
    title: String(it.item?.title || it.item?.business || '一条动态').slice(0, 160),
    users: users.map((u) => ({ mid: String(u.mid || ''), name: String(u.nickname || '') })),
    counts: Number(it.counts || 0),
    owner: users.some((u) => String(u.mid) === ownerMid),
  };
}

export function createBiliLikesService({ stateDir, pluginLog = () => {}, intervalMs = 10 * 60 * 1000 } = {}) {
  const stateFile = path.join(stateDir, 'oasis-likes.json');
  let timer = null;
  let busy = false;
  function runLikes() {
    return new Promise((resolve) => {
      execFile(nodeExe(), [biliMjs(), 'likes', '--hours', '72', '--json'], { cwd: os.homedir(), timeout: 120000, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err) return resolve({ ok: false, error: String(err.message || err) });
        try { return resolve({ ok: true, data: JSON.parse(String(stdout).trim()) }); }
        catch (error) { return resolve({ ok: false, error: 'JSON 解析失败：' + String(error?.message ?? error) }); }
      });
    });
  }
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const cfg = readBiliConfig().config || {};
      const ownerMid = ownerMidOf(cfg);
      const result = await runLikes();
      if (!result.ok) { pluginLog('[bili-likes] 读取失败：' + result.error); return; }
      const state = loadJson(stateFile, { seen: {}, initializedAt: '' });
      const now = Date.now();
      const items = (Array.isArray(result.data?.items) ? result.data.items : [])
        .map((it) => normalizeItem(it, ownerMid))
        .filter((it) => it.id)
        .sort((a, b) => b.at - a.at);
      for (const it of items) state.seen[it.id] = state.seen[it.id] || now;
      state.items = items.slice(0, 40);
      state.snapshotAt = new Date(now).toISOString();
      if (!state.initializedAt) state.initializedAt = new Date(now).toISOString();
      saveJson(stateFile, state);
      pluginLog('[bili-likes] 已同步 ' + items.length + ' 条收到的赞（只入记忆，不自动通知）');
    } catch (error) {
      pluginLog('[bili-likes] 失败：' + String(error?.message ?? error).slice(0, 160));
    } finally { busy = false; }
  }
  function start() {
    if (timer) return;
    timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
    setTimeout(() => { void tick(); }, 35_000).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, tick, status: () => ({ file: stateFile, state: loadJson(stateFile, null) }) };
}
