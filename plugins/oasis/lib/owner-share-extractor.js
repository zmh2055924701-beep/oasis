// 私聊→家庭群 Owner Shared Context 的 LLM 补充抽取（P1 hybrid 的 LLM 半边）。
// 规则抽取在 bridge 即时完成；这里每 5 分钟把漏掉的语义补成 fact。
import fs from 'node:fs';
import path from 'node:path';

const SENSITIVE = /(密码|验证码|身份证|银行卡|住址|地址|工资|token|secret|私钥)/i;
function readJson(file, fallback) { try { const s = fs.readFileSync(file, 'utf8'); return s.trim() ? JSON.parse(s) : fallback; } catch { return fallback; } }
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8'); fs.renameSync(tmp, file); }
function parseJson(text) {
  const raw = String(text || '').trim().replace(/^[^\{]*/, '').replace(/[^\}]*$/, '');
  try { const o = JSON.parse(raw); return Array.isArray(o?.facts) ? o.facts : []; } catch { return []; }
}
export function createOwnerShareExtractor({ chat, stateDir, callBridge = null, pluginLog = () => {}, intervalMs = 5 * 60 * 1000, maxEvents = 8 } = {}) {
  const stateFile = path.join(stateDir, 'owner-share-extractor-state.json');
  let timer = null;
  let running = false;
  function state() { return readJson(stateFile, { processed: [], updatedAt: null }); }
  async function extractOnce() {
    if (running || !callBridge || !chat?.llmReady?.()) return { ok: false, reason: 'not-ready' };
    running = true;
    try {
      const recent = await callBridge('/api/identity/recent?limit=60', { timeoutMs: 8000 });
      const events = Array.isArray(recent?.data?.events) ? recent.data.events : [];
      const st = state();
      const processed = new Set(Array.isArray(st.processed) ? st.processed : []);
      const candidates = events.filter((e) => String(e.body || '').startsWith('private:') && e.actor === 'owner' && e.type === 'message'
        && !/允许|拒绝|短码|电脑操作授权/.test(String(e.text || '')) && !SENSITIVE.test(String(e.text || ''))
        && !processed.has(String(e.eventId || ''))).slice(-maxEvents);
      if (!candidates.length) return { ok: false, reason: 'no-new-private' };
      const system = [
        '你是“她”的主人状态整理器。输入是主人私聊里的原话。只输出严格 JSON，不要 Markdown：',
        '{"facts":[{"kind":"activity|food|schedule|rest|note","summary":"一句安全的中文摘要","validUntil":"ISO时间","confidence":0.8}]}',
        '规则：只整理主人自己的活动/计划/饮食/作息；不要整理密码、地址、工作机密、第三人隐私；摘要不要逐字复述；没有可共享事实返回 {"facts":[]}。',
      ].join('\n');
      const user = JSON.stringify({ at: new Date().toISOString(), messages: candidates.map((e) => ({ at: e.at, text: e.text })) });
      const result = await chat.complete({ system, user, maxTokens: 500, temperature: 0.2 });
      const facts = parseJson(result?.text || '').filter((f) => f && f.summary && !SENSITIVE.test(String(f.summary))).slice(0, 6).map((f) => ({
        id: 'llm-fact-' + Buffer.from(String(f.summary) + '|' + (f.validUntil || '')).toString('base64').slice(0, 18),
        kind: ['activity', 'food', 'schedule', 'rest', 'note'].includes(f.kind) ? f.kind : 'note',
        kinds: [['activity', 'food', 'schedule', 'rest', 'note'].includes(f.kind) ? f.kind : 'note'],
        summary: String(f.summary).slice(0, 220),
        subject: 'owner',
        startAt: new Date().toISOString(),
        validUntil: f.validUntil && Number.isFinite(Date.parse(f.validUntil)) ? new Date(Date.parse(f.validUntil)).toISOString() : new Date(Date.now() + 3 * 3600000).toISOString(),
        sourceEventId: String(candidates[0]?.eventId || ''),
        status: 'active',
        sensitivity: 'safe',
        confidence: Math.max(0, Math.min(1, Number(f.confidence) || 0.6)),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }));
      if (facts.length) {
        await callBridge('/api/identity/owner-facts', { method: 'POST', body: { facts }, timeoutMs: 8000 });
      }
      const next = [...st.processed, ...candidates.map((e) => String(e.eventId || ''))].slice(-300);
      writeJson(stateFile, { processed: next, updatedAt: new Date().toISOString() });
      if (facts.length) pluginLog('[owner-share] LLM 补充 ' + facts.length + ' 条家庭群状态');
      return { ok: true, events: candidates.length, facts: facts.length };
    } catch (error) {
      pluginLog('[owner-share] LLM 抽取失败：' + String(error?.message ?? error).slice(0, 160));
      return { ok: false, reason: 'error', error: String(error?.message ?? error).slice(0, 200) };
    } finally { running = false; }
  }
  function start() { if (timer) return; timer = setInterval(() => { void extractOnce(); }, intervalMs); timer.unref?.(); setTimeout(() => { void extractOnce(); }, 30_000).unref?.(); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { start, stop, extractOnce, status: () => ({ ...state(), running }) };
}
