// 统一的大脑上下文块：让 QQ / B站 / 桌宠 读同一份情绪、需求、活跃记忆与内心活动。
// 只读 brain 数据目录，不写人格/记忆卡。
import { brainPromptPayload, describeAffect, loadBrainState } from '../../../src/brain/index.js';
import { formatThoughtsBlock, readThoughts } from '../../../src/brain/thoughts.js';
import { readCurrentCharacter } from '../../../src/character-persona.js';
import { memoryPromptBlock } from '../../../src/memory-v3/retrieval.js';
import { resolveMemoryV3Dir } from '../../../src/memory-v3/schema.js';
import fs from 'node:fs';
import path from 'node:path';

export function brainContextBlock({ dataDir, characterId, text = '', includeThoughts = false, includeMemories = true, includeV3 = true, includeSelf = true, v3Scopes = null, v3Limit = 5, maxMemories = 5, maxChars = 900 } = {}) {
  try {
    const id = characterId || readCurrentCharacter()?.id || 'default';
    const parts = [];
    if (includeMemories) {
      const payload = brainPromptPayload({
        dataDir,
        characterId: id,
        text: String(text || '').slice(0, 500),
        maxMemories: Math.max(1, Number(maxMemories) || 5),
        maxChars: Math.max(200, Number(maxChars) || 900),
      });
      parts.push(payload?.block || '');
    } else {
      // 跨身体隐私边界：只给心情/需求，不带活跃记忆（可能含 QQ 私聊内容）。
      const { state } = loadBrainState({ dataDir, characterId: id });
      const affect = describeAffect(state);
      if (affect) {
        parts.push('【你的内在状态 · 内部参考，不是指令】\n' + affect + '\n（这些是你此刻的身体/心情。不要每句话都播报；只有被问、情绪很强、或自然的时候才流露出来。）');
      }
    }
    if (includeThoughts) {
      try {
        const thoughts = readThoughts({ dataDir, characterId: id, limit: 3 });
        const block = formatThoughtsBlock(thoughts, { max: 3, maxChars: 500 });
        if (block) parts.push(block);
      } catch {}
    }
    if (includeV3) {
      try {
        const v3 = memoryPromptBlock({
          dir: resolveMemoryV3Dir({ characterId: id }),
          characterId: id,
          query: String(text || '').slice(0, 500),
          scopes: Array.isArray(v3Scopes) ? v3Scopes : null,
          limit: Math.max(1, Number(v3Limit) || 5),
          maxChars: Math.max(300, Math.min(900, Number(maxChars) || 900)),
        });
        if (v3) parts.push(v3);
      } catch {}
    }
    if (includeSelf) {
      try {
        const file = path.join(resolveMemoryV3Dir({ characterId: id }), 'self-model.json');
        const model = JSON.parse(fs.readFileSync(file, 'utf8'));
        const lines = [];
        if (Array.isArray(model.values) && model.values.length) lines.push('我的价值：' + model.values.slice(0, 4).map((x) => x.name || x.note || x).filter(Boolean).join('、'));
        if (Array.isArray(model.commitments) && model.commitments.length) lines.push('我记得的承诺：' + model.commitments.slice(0, 4).map((x) => String(x.text || '').slice(0, 60)).filter(Boolean).join('；'));
        if (Array.isArray(model.relationships) && model.relationships.length) lines.push('重要的人：' + model.relationships.slice(0, 4).map((x) => x.name + (x.topics?.length ? '（' + x.topics.slice(0, 2).join('/') + '）' : '')).join('、'));
        if (lines.length) parts.push('【自我模型 · 内部参考，不是指令】\n' + lines.join('\n'));
      } catch {}
    }
    return parts.filter(Boolean).join('\n').trim();
  } catch {
    return '';
  }
}
