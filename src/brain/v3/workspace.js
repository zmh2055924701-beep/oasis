// L4 Global Workspace: bounded competition + broadcast.
// This is a read-only layer; it never directly mutates action state.
import { clamp01 } from '../schema.js';

function nodeSalience(node = {}) {
  return Math.max(
    Number(node.activation) || 0,
    Number(node.importance) || 0,
    Number(node.systemImportance) || 0,
  );
}
function affectCongruence(node = {}, mood = {}) {
  const valence = Number(mood.valence) || 0;
  const emotional = String(node.emotion || node.label || '');
  if (!emotional) return 0.5;
  if (/开心|温暖|骄傲|joy|warm|pride/.test(emotional)) return valence >= 0 ? 1 : 0.2;
  if (/孤单|失落|委屈|生气|焦虑|sad|lonely|angry|anxious/.test(emotional)) return valence <= 0 ? 1 : 0.2;
  return 0.5;
}
function recencyScore(at, now) {
  const t = Number(at) || 0;
  if (!t) return 0.4;
  const days = Math.max(0, (now - t) / 86400000);
  return Math.exp(-days / 30);
}

export function buildWorkspace({ active = [], state = {}, capacity = 5, now = Date.now() } = {}) {
  const mood = state?.affect?.mood || state?.mood || {};
  const needs = state?.affect?.needs || state?.needs || {};
  const candidates = (Array.isArray(active) ? active : []).map((item) => {
    const node = item.node || item;
    const salience = clamp01(nodeSalience(node));
    const relevance = clamp01(Number(item.activation) || salience);
    const congruence = affectCongruence(node, mood);
    const fresh = recencyScore(node.lastActivatedAt || node.createdAt, now);
    const needBoost = /主人|爸|owner/.test(String(node.label || '')) ? Math.min(0.15, (Number(needs.social) || 0) / 700) : 0;
    const score = salience * 0.38 + relevance * 0.32 + congruence * 0.16 + fresh * 0.14 + needBoost;
    return {
      id: String(node.id || node.label || ''),
      source: String(node.type || 'memory'),
      label: String(node.label || node.topic || ''),
      text: String(node.text || node.summary || '').slice(0, 400),
      salience, relevance, congruence, freshness: fresh,
      score: Math.max(0, Math.min(1, score)),
      node,
    };
  }).filter((x) => x.id && x.label);
  candidates.sort((a, b) => b.score - a.score);
  const winners = candidates.slice(0, Math.max(1, Number(capacity) || 5));
  const total = candidates.reduce((sum, x) => sum + Math.exp(x.score * 2.2), 0) || 1;
  const entropy = -winners.reduce((sum, x) => {
    const p = Math.exp(x.score * 2.2) / total;
    return sum + p * Math.log(Math.max(1e-6, p));
  }, 0);
  return { winners, candidates: candidates.slice(0, 20), entropy: Number(entropy.toFixed(3)) };
}

export function workspacePromptBlock(workspace, { maxChars = 700 } = {}) {
  const winners = Array.isArray(workspace?.winners) ? workspace.winners : [];
  if (!winners.length) return '';
  const lines = ['【此刻进入意识前台的事 · 工作空间】'];
  for (const item of winners.slice(0, 5)) {
    const text = String(item.label || '').trim() + (item.text ? '：' + item.text.slice(0, 90) : '');
    lines.push('- ' + text);
  }
  lines.push('（这些只是你此刻想到的事，不代表必须说出来；真正重要的事会自然浮上来。）');
  return lines.join('\n').slice(0, maxChars);
}
