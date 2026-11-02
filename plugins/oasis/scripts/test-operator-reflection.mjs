// P5：LLM 经验整理服务（fake 模型，不联网）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOperatorReflectionService, parseReflectionJson } from '../lib/operator-reflection.js';

test('parseReflectionJson 去 fence + 限字段', () => {
  const fence = String.fromCharCode(96).repeat(3);
  const txt = fence + 'json\n' + JSON.stringify({ insights: [{ actionType: 'file_write', target: 'D:/x', whatWorked: 'ok', nextTime: '复用', confidence: 0.8 }] }) + '\n' + fence;
  const out = parseReflectionJson(txt);
  assert.equal(out.length, 1);
  assert.equal(out[0].actionType, 'file_write');
  assert.equal(out[0].confidence, 0.8);
  assert.equal(parseReflectionJson('not json'), null);
});

test('reflectOnce 读 episode → 写 llm-reflections/state', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'op-reflect-svc-'));
  try {
    const op = path.join(dir, 'operator'); fs.mkdirSync(op, { recursive: true });
    fs.writeFileSync(path.join(op, 'action-episodes.jsonl'), JSON.stringify({ at: new Date().toISOString(), action: { type: 'file_write', target: 'D:/x.txt', label: '写' }, ok: true }) + '\n');
    const fakeChat = {
      llmReady: () => true,
      complete: async () => ({ text: JSON.stringify({ insights: [{ actionType: 'file_write', target: 'D:/x.txt', whatWorked: '写入成功', nextTime: '继续用备份+原子写', confidence: 0.9 }] }) }),
    };
    const svc = createOperatorReflectionService({ chat: fakeChat, stateDir: dir, pluginLog: () => {} });
    const r = await svc.reflectOnce();
    assert.equal(r.ok, true);
    assert.equal(r.insights, 1);
    assert.ok(fs.existsSync(path.join(op, 'llm-reflections.jsonl')));
    const st = JSON.parse(fs.readFileSync(path.join(op, 'llm-reflection-state.json'), 'utf8'));
    assert.equal(st.processed, 1);
    const again = await svc.reflectOnce();
    assert.equal(again.ok, false);
    assert.equal(again.reason, 'no-new-episodes');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
