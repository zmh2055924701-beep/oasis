// MP-4 rule-based memory operations. DELETE = archive/validTo, never physical delete.
export const MEMORY_OPS = Object.freeze(['ADD', 'UPDATE', 'DELETE', 'NOOP']);

function keyOf(f = {}) { return [String(f.subject || ''), String(f.predicate || '')].join('|').toLowerCase(); }
function valueOf(f = {}) { return String(f.object ?? f.text ?? '').trim().toLowerCase(); }

export function planMemoryOps({ existing = [], incoming = [] } = {}) {
  const ops = [];
  const map = new Map();
  for (const f of existing) {
    const k = keyOf(f);
    if (!k || k === '|') continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  for (const f of incoming) {
    const k = keyOf(f);
    const v = valueOf(f);
    if (!k || !v) { ops.push({ op: 'NOOP', reason: 'empty', incoming: f }); continue; }
    const bucket = map.get(k) || [];
    if (!bucket.length) { ops.push({ op: 'ADD', incoming: f }); continue; }
    const same = bucket.find((x) => valueOf(x) === v);
    if (same) { ops.push({ op: 'NOOP', reason: 'duplicate', incoming: f, existing: same }); continue; }
    ops.push({ op: 'UPDATE', incoming: f, supersedes: bucket.map((x) => x.id).filter(Boolean), note: '标记旧事实 validTo；不物理删除' });
  }
  return ops;
}
