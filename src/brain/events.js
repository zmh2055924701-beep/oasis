// 大脑事件日志（append-only JSONL + 截断保护）与状态原子写。
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BRAIN_CONFIG, ensureBrainDir, resolveBrainPaths } from './schema.js';

export function atomicWriteJson(file, value) {
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

export function readJsonSafe(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** 读取 JSONL 尾部记录；坏行跳过，不抛。limit>0 时只读尾部，避免每次把几十 MB 事件全读进来。 */
export function readJsonLines(file, { limit = 0, maxBytes = 0 } = {}) {
  let text = '';
  let start = 0;
  try {
    const stat = fs.statSync(file);
    if (!stat.size) return [];
    // 预估每条事件 4KB；至少 64KB、最多 4MB。明确传 maxBytes 时优先用它。
    const effectiveMaxBytes = Number(maxBytes) > 0
      ? Number(maxBytes)
      : (Number(limit) > 0 ? Math.min(4 * 1024 * 1024, Math.max(64 * 1024, Number(limit) * 4096)) : 0);
    start = effectiveMaxBytes > 0 ? Math.max(0, stat.size - effectiveMaxBytes) : 0;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const lines = text.split('\n');
  // 从文件中间开始时，第一行很可能被截断；丢掉它，避免把半个 JSON 当坏行。
  if (start > 0) lines.shift();
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return limit > 0 ? out.slice(-limit) : out;
}

function startOfFileTrimmed() { return false; }

/** 追加一条事件；超过 maxEvents*约400字节 时重写尾部，避免无限膨胀。 */
export function appendEventLine(paths, event, { maxEvents = DEFAULT_BRAIN_CONFIG.maxEvents } = {}) {
  ensureBrainDir(paths);
  fs.appendFileSync(paths.events, JSON.stringify(event) + '\n', 'utf8');
  try {
    const stat = fs.statSync(paths.events);
    if (stat.size > Math.max(4096, Number(maxEvents) * 400)) {
      const records = readJsonLines(paths.events);
      const keep = records.slice(-Math.max(10, Number(maxEvents) || 20000));
      fs.writeFileSync(paths.events + '.rewrite', keep.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
      fs.renameSync(paths.events + '.rewrite', paths.events);
    }
  } catch {}
}

export function appendTraceLine(paths, record) {
  ensureBrainDir(paths);
  fs.appendFileSync(paths.trace, JSON.stringify(record) + '\n', 'utf8');
}

export { resolveBrainPaths, DEFAULT_BRAIN_CONFIG };
