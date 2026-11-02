// 私聊 Owner Shared Context 的 LLM 补充抽取（fake 模型）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOwnerShareExtractor } from '../lib/owner-share-extractor.js';

test('从私聊事件抽 facts 并 POST，不重复处理', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-share-llm-'));
  try {
    const posted = [];
    const recent = [{ data: { events: [
      { eventId: 'e1', body: 'private:100000000', actor: 'owner', type: 'message', text: '我晚上可能去健身', at: new Date().toISOString() },
      { eventId: 'e2', body: 'group:100000002', actor: 'owner', type: 'message', text: '群里不算', at: new Date().toISOString() },
    ] } }];
    let n = 0;
    const callBridge = async (url, opts) => {
      if (url.startsWith('/api/identity/recent')) return recent[0];
      if (url === '/api/identity/owner-facts') { posted.push(opts.body); return { ok: true, data: { ok: true } }; }
      return { ok: true, data: {} };
    };
    const chat = {
      llmReady: () => true,
      complete: async () => { n++; return { text: JSON.stringify({ facts: [{ kind: 'activity', summary: '主人说晚上可能去健身', validUntil: new Date(Date.now() + 3600000).toISOString(), confidence: 0.8 }] }) }; },
    };
    const svc = createOwnerShareExtractor({ chat, stateDir: dir, callBridge, pluginLog: () => {} });
    const r = await svc.extractOnce();
    assert.equal(r.ok, true);
    assert.equal(r.facts, 1);
    assert.equal(posted.length, 1);
    assert.ok(posted[0].facts[0].summary.includes('健身'));
    const again = await svc.extractOnce();
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'no-new-private');
    assert.equal(n, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
