#!/usr/bin/env node
// Oasis 数据迁移：把 ~/.dsh/oasis 复制到 ~/.dsh/oasis，逐文件 SHA256 校验；不删除旧目录。
// 用法：node scripts/oasis-migrate-data.mjs --dry-run
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = process.env.USERPROFILE || os.homedir();
const dshHome = process.env.DSH_HOME || path.join(home, '.dsh');
const source = path.join(dshHome, 'oasis');
const target = process.env.OASIS_HOME || path.join(dshHome, 'oasis');
const dry = process.argv.includes('--dry-run');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase(); }
function walk(dir, base = dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

if (!fs.existsSync(source)) { console.error('source 不存在：' + source); process.exit(1); }
console.log((dry ? '[dry-run] ' : '') + 'source=' + source + '\ntarget=' + target);
if (!dry) {
  if (fs.existsSync(target)) {
    const backup = path.join(dshHome, '_backups', 'oasis-data-before-migrate-' + stamp);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.cpSync(target, backup, { recursive: true, force: true });
    console.log('旧 target 已备份：' + backup);
  }
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, { recursive: true, force: true, filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src) });
  const files = walk(source);
  let bad = 0;
  for (const rel of files) {
    const a = path.join(source, rel), b = path.join(target, rel);
    if (!fs.existsSync(b) || hash(a) !== hash(b)) { bad += 1; console.error('MISMATCH ' + rel); }
  }
  console.log('copied=' + files.length + ' mismatches=' + bad);
  if (bad) process.exit(1);
  console.log('迁移完成；旧目录保留。把 OASIS_HOME 指向 target 再切。');
}
