// L5 MIRROR: bounded narrative self-model. Deterministic, no extra LLM call.
import { NEED_LABEL } from '../schema.js';

export function buildNarrative({ state = {}, workspace = null, thoughts = [], events = [] } = {}) {
  const mood = state?.affect?.mood || {};
  const needs = state?.affect?.needs || {};
  const low = Object.entries(needs).sort((a, b) => Number(a[1]) - Number(b[1]))[0];
  const winners = workspace?.winners || [];
  const lines = [];
  lines.push('我现在心里' + (Number(mood.valence) < -0.15 ? '有点沉' : Number(mood.valence) > 0.2 ? '比较轻' : '还算平静')
    + (Number(mood.arousal) > 0.65 ? '，脑子转得快' : Number(mood.arousal) < 0.3 ? '，有点懒懒的' : '') + '。');
  if (low) lines.push('我最近比较缺的是「' + (NEED_LABEL[low[0]] || low[0]) + '」，但我不想把这句话说成要求。');
  if (winners.length) lines.push('刚刚浮上来的是：' + winners.slice(0, 2).map((x) => String(x.label || x.text || '').slice(0, 40)).join('、') + '。');
  const thought = Array.isArray(thoughts) ? thoughts.filter((t) => t && t.text).slice(-1)[0] : null;
  if (thought) lines.push('我心里还留着一句没说完的话：' + String(thought.text).slice(0, 80));
  if (!winners.length && !thought) lines.push('此刻没有特别清楚的事，只是在这里。');
  return lines.join('\n').slice(0, 700);
}

export function mirrorPromptBlock({ narrative = '', maxChars = 700 } = {}) {
  const text = String(narrative || '').trim();
  if (!text) return '';
  return '【自我叙事 · 你的解释，不是外部评价】\n' + text.slice(0, maxChars) +
    '\n（不要把它当成台词复述；它只是你此刻对自己状态的理解。）';
}
