// B站身体 → 身份内核同步（P1）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIdentitySync } from '../lib/identity-sync.js';

test('B站 whale-log 只增量同步，首次补最近 12 条', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'identity-sync-'));
  try {
    const bili = path.join(root, 'bili'); fs.mkdirSync(bili);
    const log = path.join(bili, 'whale-log.jsonl');
    const lines = Array.from({ length: 15 }, (_, i) => JSON.stringify({ at: new Date().toISOString(), kind: 'watch', note: '第' + i + '条' }));
    fs.writeFileSync(log, lines.join('\n') + '\n', 'utf8');
    const posted = [];
    const sync = createIdentitySync({
      stateDir: root,
      biliDir: bili,
      pluginLog: () => {},
      callBridge: async (_p, opts) => { posted.push(opts.body); return { ok: true, data: { ok: true } }; },
    });
    const first = await sync.syncOnce();
    assert.equal(first.seeded, 12);
    assert.equal(posted.length, 12);
    assert.ok(posted[0].text.includes('[B站]'));
    fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), kind: 'share', note: '分享动态' }) + '\n');
    const second = await sync.syncOnce();
    assert.equal(second.added, 1);
    assert.equal(posted.length, 13);
    assert.ok(posted[12].text.includes('分享动态'));
    const third = await sync.syncOnce();
    assert.equal(third.added, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
