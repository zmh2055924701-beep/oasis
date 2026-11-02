// L6.5 Metacognition: confidence estimate + simple calibration.
import { clamp01 } from '../schema.js';

export function estimateConfidence({ workspace = null, state = {}, evidenceCount = 0, conflict = false } = {}) {
  const winners = workspace?.winners || [];
  const top = winners.length ? Number(winners[0].score) || 0 : 0;
  const support = Math.min(1, Number(evidenceCount) / 5);
  const stability = 1 - Math.min(1, Number(workspace?.entropy) || 0);
  const fatigue = Math.max(0, Number(state?.affect?.physiology?.fatigue) || 0) / 100;
  let confidence = 0.28 + top * 0.3 + support * 0.2 + stability * 0.12 - fatigue * 0.1 - (conflict ? 0.18 : 0);
  confidence = clamp01(confidence);
  return { confidence: Number(confidence.toFixed(3)), support, stability: Number(stability.toFixed(3)), conflict: Boolean(conflict) };
}

export function calibrate({ predictions = [], outcomes = [] } = {}) {
  const pairs = [];
  for (let i = 0; i < Math.min(predictions.length, outcomes.length); i += 1) {
    const p = Number(predictions[i]?.confidence ?? predictions[i]);
    const y = outcomes[i] === true || outcomes[i] === 1 || outcomes[i]?.ok === true ? 1 : 0;
    if (Number.isFinite(p)) pairs.push({ p, y });
  }
  if (!pairs.length) return { samples: 0, brier: null, bias: 0 };
  const brier = pairs.reduce((sum, x) => sum + (x.p - x.y) ** 2, 0) / pairs.length;
  const bias = pairs.reduce((sum, x) => sum + (x.p - x.y), 0) / pairs.length;
  return { samples: pairs.length, brier: Number(brier.toFixed(3)), bias: Number(bias.toFixed(3)) };
}

export function metaPromptBlock({ confidence = 0.5, support = 0, conflict = false } = {}, { maxChars = 260 } = {}) {
  const level = confidence >= 0.7 ? '比较确定' : confidence >= 0.45 ? '有点确定，但不确定全对' : '不太确定';
  return ('【元认知 · 此刻' + level + '】支持 ' + Math.round((Number(support) || 0) * 100) + '%'
    + (conflict ? '；内部有冲突' : '') + '。不确定时先问，不要装作知道。').slice(0, maxChars);
}
