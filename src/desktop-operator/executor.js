// 电脑操作体 · 执行器（P3）：只执行已通过一次性审批的动作。
// 文件写/删先备份；系统目录/凭据目录硬拒绝；shell 默认关闭（配置可开）。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const PROTECTED_ROOTS = [
  process.env.SystemRoot || 'C:/Windows',
  process.env.ProgramFiles || 'C:/Program Files',
  process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)',
  path.join(process.env.USERPROFILE || 'C:/Users/Default', '.ssh'),
  path.join(process.env.USERPROFILE || 'C:/Users/Default', 'AppData', 'Roaming', 'Microsoft', 'Credentials'),
  path.join(process.env.USERPROFILE || 'C:/Users/Default', 'AppData', 'Local', 'Microsoft', 'Credentials'),
];

function isProtectedPath(target) {
  const abs = path.resolve(String(target || '').replace(/^["']|["']$/g, ''));
  const low = abs.toLowerCase();
  return PROTECTED_ROOTS.some((root) => {
    const r = path.resolve(String(root)).toLowerCase();
    return low === r || low.startsWith(r + path.sep);
  });
}

function assertSafeTarget(action) {
  const target = String(action.target || '').trim();
  if (!target) throw new Error('动作缺少 target');
  if (isProtectedPath(target)) throw new Error('拒绝操作受保护目录：' + target);
  return path.resolve(target);
}

function backupFile(target, stateDir) {
  if (!fs.existsSync(target)) return null;
  const dir = path.join(stateDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, path.basename(target) + '.' + Date.now() + '.bak');
  fs.copyFileSync(target, dest);
  return dest;
}

function runPowerShell(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const exe = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
    const wrapped = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + script;
    execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped], {
      timeout: timeoutMs, windowsHide: true, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); return; }
      resolve(String(stdout || '').trim());
    });
  });
}

export async function executeOperatorAction(action = {}, { stateDir, allowShell = false } = {}) {
  const type = String(action.type || '');
  const base = stateDir || path.join(process.cwd(), 'state', 'operator');
  const target = action.target ? assertSafeTarget(action) : '';
  const params = action.params && typeof action.params === 'object' ? action.params : {};

  if (type === 'file_write') {
    const content = String(params.content ?? '');
    if (content.length > 2 * 1024 * 1024) throw new Error('写入内容超过 2MB');
    const backup = backupFile(target, base);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = target + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, target);
    return { ok: true, type, target, bytes: Buffer.byteLength(content, 'utf8'), backup };
  }
  if (type === 'file_delete') {
    if (!fs.existsSync(target)) throw new Error('文件不存在：' + target);
    if (fs.statSync(target).isDirectory()) throw new Error('P3 暂不删除目录');
    const quarantine = path.join(base, 'quarantine');
    fs.mkdirSync(quarantine, { recursive: true });
    const dest = path.join(quarantine, path.basename(target) + '.' + Date.now() + '.deleted');
    fs.renameSync(target, dest);
    return { ok: true, type, target, quarantine: dest };
  }
  if (type === 'file_move') {
    const dest = String(params.destination || '').trim();
    if (!dest) throw new Error('移动文件需要 params.destination');
    const destAbs = assertSafeTarget({ target: dest });
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.renameSync(target, destAbs);
    return { ok: true, type, from: target, to: destAbs };
  }
  if (type === 'app_launch') {
    if (!target) throw new Error('启动应用需要 target');
    const escaped = target.replace(/'/g, "''");
    await runPowerShell('Start-Process -FilePath ' + "'" + escaped + "'");
    return { ok: true, type, target };
  }
  if (type === 'ui_click') {
    const x = Math.round(Number(params.x));
    const y = Math.round(Number(params.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('点击需要 params.x/y');
    const script = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(' + x + ',' + y + '); ' +
      'Add-Type -TypeDefinition "using System.Runtime.InteropServices; public class M { [DllImport(\\"user32.dll\\")] public static extern void mouse_event(int f,int x,int y,int d,int e); }"; ' +
      '[M]::mouse_event(0x0002,0,0,0,0); [M]::mouse_event(0x0004,0,0,0,0)';
    await runPowerShell(script);
    return { ok: true, type, x, y };
  }
  if (type === 'ui_type') {
    const text = String(params.text ?? '');
    if (!text) throw new Error('输入动作需要 params.text');
    const escaped = text.replace(/'/g, "''").replace(/[{}()+^%~\[\]]/g, (m) => '{' + m + '}');
    await runPowerShell('Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(' + "'" + escaped + "'" + ')');
    return { ok: true, type, chars: text.length };
  }
  if (type === 'shell_run') {
    if (!allowShell) throw new Error('shell 默认关闭（需配置 operator.allowShell=true）');
    const command = String(action.command || '');
    if (!command) throw new Error('shell 动作缺少 command');
    return await new Promise((resolve, reject) => {
      execFile('cmd.exe', ['/d', '/s', '/c', command], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); return; }
        resolve({ ok: true, type, stdout: String(stdout || '').slice(0, 20000), stderr: String(stderr || '').slice(0, 4000) });
      });
    });
  }
  if (type === 'window_close' || type === 'process_kill') {
    throw new Error('关闭窗口/结束进程在 P3 暂不开放（需要额外策略）');
  }
  throw new Error('没有这个动作的执行器：' + type);
}
