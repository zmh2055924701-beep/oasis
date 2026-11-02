// L0 desktop awareness: foreground app/window, idle/typing hint, cursor, screen.
// No keystrokes, no clipboard, no text content, no screenshot, no input injection.
import { execFile } from 'node:child_process';

const SENSITIVE_APP_RE = /(?:1password|bitwarden|keepass|lastpass|password|credential|bank|banking|alipay|wechatpay|paypal|wallet|身份证|银行|支付|密码|私密|隐私)/i;
const SENSITIVE_TITLE_RE = /(?:password|credential|银行|支付|验证码|身份证|私密|密码|\\bOTP\\b)/i;

export function isSensitiveWindow({ app = '', title = '' } = {}) {
  return SENSITIVE_APP_RE.test(String(app)) || SENSITIVE_TITLE_RE.test(String(title));
}

const GAME_RE = /(?:valorant|league of legends|steam|epic games|cs2|counter-strike|dota|minecraft|原神|崩坏|永劫无间|overwatch|riot games|game)/i;
const WORK_RE = /(?:code|cursor|devenv|webstorm|idea|sublime|notepad|word|excel|powerpoint|wps|typora|obsidian|zotero|pdf|deepseek harness)/i;
const CHAT_RE = /(?:qq|wechat|weixin|telegram|discord|slack|telegram)/i;
const BROWSE_RE = /(?:chrome|msedge|firefox)/i;
const WATCH_RE = /(?:potplayer|vlc|mpv|bilibili|爱奇艺|腾讯视频|netflix|youtube|player)/i;

export function classifyActivity({ app = '', title = '', idleMs = 0 } = {}) {
  const text = String(app) + ' ' + String(title);
  if (Number(idleMs) > 120000) return { key: 'away', label: '离开电脑', askable: false };
  if (isSensitiveWindow({ app, title })) return { key: 'sensitive', label: '敏感窗口', askable: false };
  if (GAME_RE.test(text)) return { key: 'gaming', label: '打游戏', askable: false };
  if (WORK_RE.test(text)) return { key: 'working', label: '写东西/工作', askable: true };
  if (CHAT_RE.test(text)) return { key: 'chatting', label: '聊天', askable: true };
  if (BROWSE_RE.test(text)) return { key: 'browsing', label: '看网页', askable: true };
  if (WATCH_RE.test(text)) return { key: 'watching', label: '看视频', askable: true };
  return { key: 'unknown', label: '电脑前', askable: false };
}

export function desktopContextFromSample(sample = {}, now = Date.now()) {
  const app = String(sample.app || '');
  const title = String(sample.title || '').slice(0, 300);
  const idleMs = Math.max(0, Number(sample.idleMs) || 0);
  const typing = idleMs < 1400;
  return {
    at: now,
    app,
    title,
    processId: Number(sample.pid) || 0,
    window: {
      x: Number(sample.x) || 0, y: Number(sample.y) || 0,
      width: Math.max(0, Number(sample.width) || 0),
      height: Math.max(0, Number(sample.height) || 0),
    },
    cursor: { x: Number(sample.cursorX) || 0, y: Number(sample.cursorY) || 0 },
    screen: { width: Number(sample.screenWidth) || 0, height: Number(sample.screenHeight) || 0 },
    idleMs,
    typing,
    activeInput: typing,
    sensitive: isSensitiveWindow({ app, title }),
    activity: classifyActivity({ app, title, idleMs }),
  };
}

function capturePowerShell(timeoutMs = 4500) {
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type @"',
    'using System;',
    'using System.Text;',
    'using System.Runtime.InteropServices;',
    'public class OasisDesk {',
    '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }',
    '  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }',
    '  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }',
    '  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
    '  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);',
    '  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);',
    '  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);',
    '}',
    '"@',
    '$h = [OasisDesk]::GetForegroundWindow()',
    '$procId = 0',
    '[OasisDesk]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null',
    '$sb = New-Object System.Text.StringBuilder 512',
    '[OasisDesk]::GetWindowText($h, $sb, 512) | Out-Null',
    '$r = New-Object OasisDesk+RECT',
    '[OasisDesk]::GetWindowRect($h, [ref]$r) | Out-Null',
    '$li = New-Object OasisDesk+LASTINPUTINFO',
    '$li.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($li)',
    '[OasisDesk]::GetLastInputInfo([ref]$li) | Out-Null',
    '$pt = New-Object OasisDesk+POINT',
    '[OasisDesk]::GetCursorPos([ref]$pt) | Out-Null',
    '$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue',
    '$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '$idle = [int]([Environment]::TickCount - [int]$li.dwTime)',
    'if ($idle -lt 0) { $idle = 0 }',
    '[pscustomobject]@{',
    '  app = if ($proc) { $proc.ProcessName } else { "" }',
    '  title = $sb.ToString()',
    '  pid = $procId',
    '  x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top)',
    '  cursorX = $pt.X; cursorY = $pt.Y',
    '  screenWidth = $screen.Width; screenHeight = $screen.Height',
    '  idleMs = $idle',
    '} | ConvertTo-Json -Compress',
  ].join(String.fromCharCode(10));
  return new Promise((resolve, reject) => {
    execFile(process.env.SystemRoot ? process.env.SystemRoot + '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' : 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + script,
    ], { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) { reject(new Error(String(stderr || error.message || error).slice(0, 300))); return; }
      try { resolve(JSON.parse(String(stdout || '{}').trim())); } catch (e) { reject(new Error('L0 JSON 解析失败：' + e.message)); }
    });
  });
}

export async function captureDesktopContext(now = Date.now()) {
  return desktopContextFromSample(await capturePowerShell(), now);
}

export function createDesktopAwarenessService({ bodyStore, log = () => {}, intervalMs = 4000, enabled = true, onEvent = null } = {}) {
  let timer = null;
  let running = false;
  let last = null;
  let typingStartedAt = 0;
  let lastTyping = false;
  let lastTypingProgressAt = 0;
  let lastWindowKey = '';
  let lastSeenAt = 0;
  let snapshot = { at: Date.now(), available: false, reason: 'not-started', sensitive: false };

  function emit(event) {
    try { bodyStore?.append?.(event); } catch {}
    try { onEvent?.(event); } catch {}
  }

  async function sample() {
    if (!enabled) return snapshot;
    try {
      const ctx = await captureDesktopContext();
      snapshot = { ...ctx, available: true, reason: '' };
      const key = ctx.app + '|' + ctx.title;
      if (ctx.sensitive) {
        if (lastWindowKey !== key) emit({ body: 'pet', type: 'desktop.sensitive_skip', context: { app: ctx.app, sensitive: true }, memory: { eligible: false } });
        lastWindowKey = key;
        lastTyping = false;
        return snapshot;
      }
      if (lastSeenAt && ctx.idleMs > 120000) {
        emit({ body: 'pet', type: 'desktop.away', context: { app: ctx.app }, memory: { eligible: false } });
        lastSeenAt = 0;
      } else if (!lastSeenAt) {
        lastSeenAt = Date.now();
      }
      if (key !== lastWindowKey) {
        emit({
          body: 'pet', type: 'desktop.focus',
          context: { app: ctx.app, windowTitle: ctx.title, rect: ctx.window, screen: ctx.screen, activity: ctx.activity },
          memory: { eligible: true, summary: '爸现在在' + (ctx.activity?.label || ctx.app || '电脑前') + (ctx.app ? '（' + ctx.app + (ctx.title ? ' · ' + ctx.title.slice(0, 60) : '') + '）' : '') },
        });
        lastWindowKey = key;
      }
      if (ctx.typing && !lastTyping) {
        typingStartedAt = Date.now();
        lastTypingProgressAt = Date.now();
        emit({ body: 'pet', type: 'desktop.typing_start', context: { app: ctx.app, windowTitle: ctx.title, rect: ctx.window, screen: ctx.screen, activity: ctx.activity }, memory: { eligible: true, summary: '爸开始在' + (ctx.activity?.label || ctx.app || '电脑') + '前操作' } });
      }
      if (ctx.typing && lastTyping && typingStartedAt && Date.now() - lastTypingProgressAt > 10000) {
        lastTypingProgressAt = Date.now();
        emit({ body: 'pet', type: 'desktop.typing_progress', durationMs: Date.now() - typingStartedAt, context: { app: ctx.app, windowTitle: ctx.title, rect: ctx.window, screen: ctx.screen, activity: ctx.activity }, memory: { eligible: false } });
      }
      if (!ctx.typing && lastTyping && typingStartedAt) {
        emit({ body: 'pet', type: 'desktop.typing_end', durationMs: Date.now() - typingStartedAt, context: { app: ctx.app, windowTitle: ctx.title, rect: ctx.window, screen: ctx.screen, activity: ctx.activity }, memory: { eligible: true, summary: '爸在' + (ctx.activity?.label || ctx.app || '电脑') + '前待了 ' + Math.max(1, Math.round((Date.now() - typingStartedAt) / 1000)) + ' 秒' } });
        typingStartedAt = 0;
      }
      lastTyping = ctx.typing;
      last = ctx;
      return snapshot;
    } catch (error) {
      snapshot = { at: Date.now(), available: false, reason: String(error?.message ?? error).slice(0, 200), sensitive: false };
      return snapshot;
    }
  }

  function start() {
    if (timer || !enabled) return;
    setTimeout(() => { void tick(); }, 6000).unref?.();
    timer = setInterval(() => { void tick(); }, intervalMs);
    timer.unref?.();
  }
  async function tick() {
    if (running) return;
    running = true;
    try { await sample(); } catch (error) { log('[desktop-l0] 采样失败：' + String(error?.message ?? error).slice(0, 160)); }
    finally { running = false; }
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  function status() {
    return { enabled, available: Boolean(snapshot.available), reason: snapshot.reason || '', context: snapshot, last };
  }
  return { start, stop, tick, sample, status, getSnapshot: () => snapshot };
}
