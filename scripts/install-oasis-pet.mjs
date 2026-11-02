#!/usr/bin/env node
// Oasis DSH Pet vendor 安装器：只替换桌面 profile 的 dsh-pet 包，先备份。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const home = process.env.USERPROFILE || os.homedir();
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(repo, 'vendor', 'dsh-pet');
const target = process.env.DSH_PET_DIR || path.join(home, '.dsh', 'profiles', 'desktop', 'node_modules', 'dsh-pet');
const dry = process.argv.includes('--dry-run');

if (!fs.existsSync(vendor)) { console.error('vendor/dsh-pet 不存在'); process.exit(1); }
if (!fs.existsSync(target)) { console.error('dsh-pet 安装目录不存在：' + target); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = path.join(home, '.dsh', '_backups', 'dsh-pet-vendor-' + stamp);
console.log((dry ? '[dry-run] ' : '') + 'vendor=' + vendor + '\ntarget=' + target + '\nbackup=' + backup);

if (!dry) {
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.cpSync(target, backup, { recursive: true, force: true });
  for (const rel of ['lib', 'runtime', 'src', 'scripts', 'assets']) {
    const src = path.join(vendor, rel);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(path.join(target, rel), { recursive: true, force: true });
    fs.cpSync(src, path.join(target, rel), { recursive: true, force: true });
  }
  for (const file of ['package.json', 'LICENSE', 'README.md', 'cordis.patch.yml']) {
    const src = path.join(vendor, file);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(target, file));
  }
  fs.writeFileSync(path.join(target, 'OASIS-VENDORED'), stamp + '\n', 'utf8');
  console.log('已安装 vendor 版；重启 DSH 生效。');
}

