// B站动机 shadow 服务测试（只写建议，不执行）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBiliShadowService } from '../lib/bili-shadow.js';

test('decide 写 shadow 决策，不产生 B站动作', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-shadow-'));
  try {
    const svc = createBiliShadowService({ stateDir: dir, pluginLog: () => {} });
    const r = svc.decide(Date.parse('2026-10-31T15:00:00+08:00'));
    assert.ok(r && r.action);
    assert.ok(fs.existsSync(path.join(dir, 'bili-shadow-decisions.jsonl')));
    assert.ok(svc.latest());
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
