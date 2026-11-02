// 电脑操作体 · 只读观察（P2）：Windows 窗口/进程/截图。
// 只做读取与本地截图文件，不修改用户文件、不启动/结束应用。
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

function runPowerShell(script, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const exe = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'powershell.exe';
    // 中文窗口标题是 UTF-8；不先设置 OutputEncoding 会变成乱码。
    const wrapped = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + script;
    execFile(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) { error.stderr = stderr; reject(error); return; }
      resolve(String(stdout || '').trim());
    });
  });
}

export async function listWindows() {
  const out = await runPowerShell("Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress");
  if (!out) return [];
  const data = JSON.parse(out);
  return (Array.isArray(data) ? data : [data]).map((x) => ({
    id: Number(x.Id) || null,
    process: String(x.ProcessName || ''),
    title: String(x.MainWindowTitle || '').slice(0, 300),
  })).filter((x) => x.title);
}

export async function listProcesses(limit = 120) {
  const out = await runPowerShell("Get-Process | Sort-Object CPU -Descending | Select-Object -First " + Math.max(1, Math.min(300, Number(limit) || 120)) + " Id,ProcessName,MainWindowTitle,CPU | ConvertTo-Json -Compress");
  if (!out) return [];
  const data = JSON.parse(out);
  return (Array.isArray(data) ? data : [data]).map((x) => ({
    id: Number(x.Id) || null,
    process: String(x.ProcessName || ''),
    title: String(x.MainWindowTitle || '').slice(0, 200),
    cpu: Number(x.CPU) || 0,
  }));
}

export async function captureScreen({ dataDir }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'screen-' + Date.now() + '.png');
  const escaped = file.replace(/'/g, "''");
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '$g = [System.Drawing.Graphics]::FromImage($bmp)',
    '$g.CopyFromScreen($b.X, $b.Y, 0, 0, $b.Size)',
    '$bmp.Save($args[0], [System.Drawing.Imaging.ImageFormat]::Png)',
    '$g.Dispose(); $bmp.Dispose()',
  ].join('; ');
  // 用 -File 传参太绕；直接拼接经过单引号转义的绝对路径。
  await runPowerShell(script.replace('$args[0]', "'" + escaped + "'"), 12000);
  if (!fs.existsSync(file)) throw new Error('截图文件未生成');
  return { path: file, bytes: fs.statSync(file).size, at: Date.now() };
}

export async function observe(type, options = {}) {
  if (type === 'observe_windows') return { windows: await listWindows() };
  if (type === 'observe_processes') return { processes: await listProcesses(options.limit) };
  if (type === 'observe_screen') {
    const screenshot = await captureScreen({ dataDir: options.dataDir || path.join(process.cwd(), 'state', 'operator') });
    let windows = [];
    try { windows = await listWindows(); } catch {}
    return { screenshot, windows };
  }
  if (type === 'observe_uia') {
    // P2 先返回窗口列表；完整 UIA 树在 P3 接 Windows UIAutomation。
    return { windows: await listWindows(), note: 'UIA 树待 P3 接入，先返回窗口列表' };
  }
  throw new Error('不支持的观察类型：' + type);
}
