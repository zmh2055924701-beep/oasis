// Oasis B站 口味权重 + 永久禁看（P2 后续）。
// 权重不靠主人手填：从最近 24h 观看历史、反馈、情绪状态推导，写进 oasis-taste.json，
// 由 feed.mjs 读取；永久禁看内容是硬过滤，不参与权重。
export const FORBIDDEN_PATTERNS = Object.freeze([
  { label: '暴力/血腥', re: /(暴力|血腥|虐杀|肢解|断肢|爆头|割喉|gore|bloody|brutal)/i },
  { label: '恐怖/惊悚', re: /(恐怖|惊悚|鬼片|鬼故事|灵异|阴间|吓人|horror|creepy|terrifying)/i },
  { label: '色情/擦边', re: /(色情|情色|成人|18禁|裸|脱衣|擦边|福利|诱惑|暧昧|黄片|porn|nsfw|hentai|onlyfans|lewd)/i },
  { label: '赌博/博彩', re: /(赌博|赌场|博彩|网赌|棋牌赌|下注|押注|彩票|casino|gambling|betting|poker)/i },
]);

export function forbiddenReason(text) {
  const s = String(text ?? '');
  for (const item of FORBIDDEN_PATTERNS) if (item.re.test(s)) return item.label;
  return '';
}
export function isForbiddenContent(text) { return Boolean(forbiddenReason(text)); }

function tokenize(label) {
  return String(label ?? '').toLowerCase().split(/[\s·,，、/|+()（）\[\]【】]+/).filter((x) => x.length >= 2);
}
export function deriveTasteWeights({ labels = [], history = [], affect = {}, now = Date.now(), windowHours = 24 } = {}) {
  const since = now - Math.max(1, Number(windowHours) || 24) * 3600_000;
  const recent = history.filter((x) => {
    const at = Date.parse(x?.at || '');
    return !Number.isFinite(at) || at >= since;
  });
  const mood = affect?.mood ?? affect ?? {};
  const valence = Math.max(-1, Math.min(1, Number(mood.valence) || 0));
  const curiosity = Math.max(0, Math.min(100, Number(affect?.needs?.curiosity ?? affect?.curiosity ?? 60)));
  const rows = [];
  const weights = {};
  for (const label of labels) {
    const tokens = tokenize(label);
    if (!tokens.length) continue;
    let hits = 0;
    let lastAt = 0;
    for (const item of recent) {
      const title = String(item?.title ?? '');
      if (forbiddenReason(title)) continue;
      if (tokens.some((t) => title.toLowerCase().includes(t))) {
        hits += 1;
        lastAt = Math.max(lastAt, Date.parse(item.at || '') || 0);
      }
    }
    const exploration = curiosity >= 75 ? 0.5 : 0;
    const moodBoost = valence > 0.25 ? 0.25 : valence < -0.25 ? -0.25 : 0;
    const weight = Math.max(0, Math.min(5, 1 + hits * 0.45 + exploration + moodBoost));
    weights[label] = Math.round(weight * 100) / 100;
    rows.push({ label, weight: weights[label], hits, lastSeenAt: lastAt ? new Date(lastAt).toISOString() : '' });
  }
  rows.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return { at: new Date(now).toISOString(), windowHours, weights, rows, forbidden: FORBIDDEN_PATTERNS.map((x) => x.label) };
}
