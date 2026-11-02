// 内心活动/梦（P2 Tier2/Tier4）：只写 brain 数据目录，不碰人格/记忆卡。
import fs from 'node:fs';
import path from 'node:path';
import { resolveBrainPaths, sanitizeText } from './schema.js';

const THOUGHTS_MAX = 5000;
const THOUGHTS_MAX_BYTES = 2 * 1024 * 1024;

export function thoughtsPath({ dataDir, characterId } = {}) {
  const paths = resolveBrainPaths({ dataDir, characterId });
  return path.join(paths.dir, 'thoughts.jsonl');
}

export function appendThought({ dataDir, characterId, kind = 'thought', text = '', source = '', meta = {}, now = Date.now() } = {}) {
  const file = thoughtsPath({ dataDir, characterId });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const entry = {
    id: 'th-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    at: new Date(now).toISOString(),
    kind: String(kind || 'thought'),
    text: sanitizeText(text, 800),
    source: sanitizeText(source, 120),
    meta: meta && typeof meta === 'object' ? meta : {},
  };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  try {
    const stat = fs.statSync(file);
    if (stat.size > THOUGHTS_MAX_BYTES) {
      const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      fs.writeFileSync(file, lines.slice(-THOUGHTS_MAX).join('\n') + '\n', 'utf8');
    }
  } catch {}
  return entry;
}

export function readThoughts({ dataDir, characterId, limit = 30 } = {}) {
  const file = thoughtsPath({ dataDir, characterId });
  try {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-Math.max(1, Number(limit) || 30)).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

export function formatThoughtsBlock(thoughts = [], { max = 3, maxChars = 500 } = {}) {
  const list = (Array.isArray(thoughts) ? thoughts : []).filter((t) => t && t.text).slice(-max);
  if (!list.length) return '';
  const lines = ['【最近的内心活动 · 只属于你自己】'];
  for (const t of list) {
    const kind = t.kind === 'dream' ? '梦' : t.kind === 'action' ? '行动' : '想';
    lines.push('- [' + kind + '] ' + String(t.text).slice(0, 160));
  }
  return lines.join('\n').slice(0, maxChars) + '\n\n';
}

export function createDream({ graph = null, state = null, now = Date.now() } = {}) {
  const nodes = (Array.isArray(graph?.nodes) ? graph.nodes : [])
    .filter((n) => n && (n.type === 'episode' || n.type === 'person' || n.type === 'topic'))
    .sort((a, b) => (Number(b.importance) || 0) - (Number(a.importance) || 0))
    .slice(0, 8);
  const mood = state?.affect?.mood ?? {};
  const emotions = (state?.affect?.emotions ?? []).map((e) => e.label || e.type).filter(Boolean).slice(0, 2);
  const parts = [];
  if (emotions.length) parts.push('梦里先浮起来的是一点' + emotions.join('、') + '的感觉');
  else parts.push('梦里很轻，像什么都没发生');
  const picks = nodes.slice(0, 4);
  for (const n of picks) {
    const label = String(n.label || n.text || '').replace(/\s+/g, ' ').slice(0, 40);
    if (!label) continue;
    if (n.type === 'person') parts.push('然后看到' + label + '站在不远处，没说话，只是看着我');
    else if (n.type === 'topic') parts.push('画面切到「' + label + '」，像一段没播完的片段');
    else parts.push('我想起' + label);
  }
  const v = Number(mood.valence) || 0;
  parts.push(v >= 0.2 ? '醒来时心里是暖的' : v <= -0.2 ? '醒来时有点闷，但说不上来为什么' : '醒来时很平静');
  return parts.join('；').slice(0, 500) + '。';
}
