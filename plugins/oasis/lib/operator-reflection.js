// 电脑操作体 · LLM 经验整理（P5）：把动作 episode 变成可复用经验。
// 只做经验摘要，不改变授权/安全策略；没有模型/没新 episode 时安静跳过。
import fs from 'node:fs';
import path from 'node:path';

function readJson(file, fallback) {
  try { const raw = fs.readFileSync(file, 'utf8'); return raw.trim() ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return []; }
}
function clip(s, n) { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

export function parseReflectionJson(text = '') {
  const raw = String(text || '').trim().replace(/^[\x60]{3}[a-zA-Z]*\n?/, '').replace(/[\x60]{3}$/, '').trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    const insights = Array.isArray(obj?.insights) ? obj.insights : [];
    return insights.filter((x) => x && typeof x === 'object').slice(0, 8).map((x) => ({
      actionType: String(x.actionType || '').slice(0, 80),
      target: String(x.target || '').slice(0, 160),
      whatWorked: String(x.whatWorked || '').slice(0, 300),
      whatFailed: String(x.whatFailed || '').slice(0, 300),
      nextTime: String(x.nextTime || '').slice(0, 300),
      confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0.5)),
    }));
  } catch { return null; }
}

export function createOperatorReflectionService({ chat, stateDir, callBridge = null, pluginLog = () => {}, intervalMs = 20 * 60 * 1000, maxEpisodes = 8 } = {}) {
  const operatorDir = path.join(stateDir, 'operator');
  const episodeFile = path.join(operatorDir, 'action-episodes.jsonl');
  const outFile = path.join(operatorDir, 'llm-reflections.jsonl');
  const stateFile = path.join(operatorDir, 'llm-reflection-state.json');
  let timer = null;
  let running = false;

  function status() {
    const st = readJson(stateFile, { processed: 0, updatedAt: null });
    return { processed: Number(st.processed) || 0, updatedAt: st.updatedAt || null, file: outFile };
  }

  async function reflectOnce() {
    if (running) return { ok: false, reason: 'busy' };
    if (!chat?.llmReady?.()) return { ok: false, reason: 'llm-not-ready' };
    const lines = readLines(episodeFile);
    if (!lines.length) return { ok: false, reason: 'no-episodes' };
    const st = readJson(stateFile, { processed: 0, updatedAt: null });
    let processed = Math.max(0, Number(st.processed) || 0);
    if (lines.length < processed) processed = 0;
    const fresh = lines.slice(processed).slice(-maxEpisodes);
    if (!fresh.length) return { ok: false, reason: 'no-new-episodes' };
    running = true;
    try {
      const episodes = fresh.map((line) => {
        try {
          const e = JSON.parse(line);
          return { at: e.at, action: e.action, ok: e.ok, denied: e.denied, error: clip(e.error, 160), result: e.result };
        } catch { return null; }
      }).filter(Boolean);
      const system = [
        '你是「她」的电脑操作经验整理器。你只整理经验，不生成新的人格、不改变安全规则、不提供绕过授权的建议。',
        '输入是她最近真实的电脑操作 episode（已由主人逐次批准/拒绝）。请输出严格 JSON，不要 Markdown，不要额外文字：',
        '{"insights":[{"actionType":"...","target":"...","whatWorked":"...","whatFailed":"...","nextTime":"...","confidence":0.0}]}',
        '要求：最多 6 条；只写能从输入中验证的内容；失败/被拒绝要写成“下次先确认/换安全方案”，绝不能写“以后可以跳过授权”。',
      ].join('\n');
      const user = JSON.stringify({ episodes });
      const result = await chat.complete({ system, user, maxTokens: 900, temperature: 0.3 });
      const insights = parseReflectionJson(result?.text || '');
      if (!insights) return { ok: false, reason: 'bad-json', text: clip(result?.text, 300) };
      const rec = { at: new Date().toISOString(), episodes: episodes.length, insights };
      fs.mkdirSync(operatorDir, { recursive: true });
      fs.appendFileSync(outFile, JSON.stringify(rec) + '\n', 'utf8');
      writeJson(stateFile, { processed: lines.length, updatedAt: rec.at });
      if (callBridge) {
        void callBridge('/api/identity/event', {
          method: 'POST',
          body: {
            body: 'desktop', actor: 'self', type: 'desktop_reflection', visibility: 'private',
            text: '[电脑] 从 ' + episodes.length + ' 次操作里整理了 ' + insights.length + ' 条经验',
            payload: { count: insights.length },
          },
          timeoutMs: 5000,
        }).catch(() => {});
      }
      pluginLog('[operator-reflection] 整理 ' + episodes.length + ' 条 episode → ' + insights.length + ' 条经验');
      return { ok: true, episodes: episodes.length, insights: insights.length };
    } catch (error) {
      return { ok: false, reason: 'error', error: String(error?.message ?? error).slice(0, 300) };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => { void reflectOnce(); }, intervalMs);
    timer.unref?.();
    setTimeout(() => { void reflectOnce(); }, 25_000).unref?.();
  }
  function stop() { if (timer) clearInterval(timer); timer = null; }

  return { start, stop, reflectOnce, status };
}
