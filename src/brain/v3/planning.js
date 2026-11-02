// WP-11 MAP planning layer: bounded, inspectable plan from workspace + goals.
export function buildPlan({ workspace = null, goals = [], state = {}, now = Date.now() } = {}) {
  const winners = workspace?.winners || [];
  const top = winners[0];
  const goal = (Array.isArray(goals) ? goals : []).filter((g) => g && g.text)[0] || null;
  if (!top && !goal) return { steps: [], confidence: 0.2, reason: 'nothing-to-plan' };
  const steps = [];
  if (goal) steps.push({ step: '先确认目标：' + String(goal.text || '').slice(0, 80), kind: 'orient' });
  if (top) steps.push({ step: '围绕「' + String(top.label || top.text || '').slice(0, 60) + '」做最小一步', kind: 'act' });
  steps.push({ step: '做完就收，不扩成新任务；不确定就先问', kind: 'guard' });
  return {
    steps: steps.slice(0, 3),
    confidence: Math.min(0.85, 0.3 + (Number(top?.score) || 0) * 0.4 + (goal ? 0.1 : 0)),
    goal: goal ? String(goal.text || '').slice(0, 100) : '',
    reason: 'workspace-bounded',
  };
}

export function planPromptBlock(plan, { maxChars = 400 } = {}) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  if (!steps.length) return '';
  return ('【此刻的小计划 · 最多三步】\n' + steps.map((x, i) => (i + 1) + ') ' + x.step).join('\n') +
    '\n（计划只是护栏，不是必须完成的 KPI；有变化就停下重想。）').slice(0, maxChars);
}
