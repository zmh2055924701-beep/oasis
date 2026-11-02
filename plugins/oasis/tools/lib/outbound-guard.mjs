/**
 * B站 出站身份闸（2026-10-23 用户要求：只准自己互认，不许泄露主人和别人的信息）。
 *
 * 为什么在工具层：
 *   · B站 评论/动态是**公开面**，一旦把主人的 QQ 号、主人的 B站 mid、或对齐表里
 *     别人的账号贴出去，就再也收不回来；
 *   · 提示词里的「不许泄露」只是概率约束，正则才是确定性的。
 *
 * 受保护的东西（只认这些，避免误伤普通数字）：
 *   · 主人：合体层 `admin.qq` / `admin.biliMid`、`bili.config.json` 的 `owner.mid`；
 *   · 别人：`alignments.json` 里每个 link 的各平台 id（QQ 号 / B站 mid / 贴吧 uid）；
 *   · 任何「QQ / 群号 + 数字」形态（即使不在名单里，那也是在往外递联系方式）。
 * 明确**不拦**：她自己的 B站 mid（公开资料）、昵称（会撞、误伤成本高）、普通数字。
 *
 * 只负责「要不要发」，不做内容改写。
 */
import fs from 'node:fs';
import path from 'node:path';
import { OASIS_DIR } from './state-paths.mjs';
import { findIdentityLeaks, formatIdentityLeakError } from '../../../../src/identity-guard.js';

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/**
 * 收集「不许出现在 B站 出站文本里」的 ID。
 * @param {{oasisDir?:string}} options 覆盖配置目录（测试用）
 * @returns {string[]}
 */
export function collectProtectedIdentities({ oasisDir = OASIS_DIR } = {}) {
  const unified = readJson(path.join(oasisDir, 'config.json'), {}) ?? {};
  const bili = readJson(path.join(oasisDir, 'bili.config.json'), {}) ?? {};
  const align = readJson(path.join(oasisDir, 'alignments.json'), {}) ?? {};
  const admin = unified && typeof unified.admin === 'object' && unified.admin ? unified.admin : {};
  const owner = bili && typeof bili.owner === 'object' && bili.owner ? bili.owner : {};
  const self = bili && typeof bili.self === 'object' && bili.self ? bili.self : {};
  const selfMid = String(self.mid ?? '').trim();
  const ids = new Set();
  const add = (value) => {
    const s = String(value ?? '').trim();
    if (!/^\d{4,15}$/.test(s) || s === selfMid) return;
    ids.add(s);
  };
  add(admin.qq);
  add(admin.biliMid);
  add(owner.mid);
  for (const link of Array.isArray(align.links) ? align.links : []) {
    const identities = link && typeof link.identities === 'object' ? link.identities : {};
    for (const identity of Object.values(identities)) add(identity && identity.id);
  }
  return [...ids];
}

/**
 * 出站前检查。命中就抛 Error（调用方负责打印并中止发送）。
 * @param {string} text 准备发出去的正文
 * @param {{surface?:string, oasisDir?:string, ids?:string[]}} options
 */
const PRIVACY_PATTERNS = [
  { label: '手机号', re: /(?<!\d)1[3-9]\d{9}(?!\d)/gu },
  { label: '邮箱', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu },
  { label: 'QQ/群号', re: /(?:QQ|qq|群号|群)\s*[:：]?\s*\d{5,}/gu },
  { label: '身份证', re: /(?<!\d)\d{17}[\dXx](?!\d)/gu },
  { label: '银行卡', re: /(?<!\d)\d{16,19}(?!\d)/gu },
  { label: '隐私词', re: /(?:家庭住址|家庭地址|住址|身份证号|银行卡号|私聊记录|聊天记录|sessdata|bili_jct|登录凭证|密码)/giu },
];
const UNSAFE_PATTERNS = [
  { label: '辱骂/攻击', re: /(?:操你|傻逼|去死|弄死|杀你|自杀|强奸|裸照|约炮)/giu },
  { label: '赌博/毒品', re: /(?:赌博|博彩|毒品|冰毒|海洛因)/giu },
];
const GENERIC_NAMES = new Set(['主人', '管理员', '爸爸', '爸', '妈妈', '妈', '你', 'TA', '她', '小肥鱼']);

function collectProtectedNames({ oasisDir = OASIS_DIR } = {}) {
  const unified = readJson(path.join(oasisDir, 'config.json'), {}) ?? {};
  const bili = readJson(path.join(oasisDir, 'bili.config.json'), {}) ?? {};
  const align = readJson(path.join(oasisDir, 'alignments.json'), {}) ?? {};
  const admin = unified && typeof unified.admin === 'object' && unified.admin ? unified.admin : {};
  const owner = bili && typeof bili.owner === 'object' && bili.owner ? bili.owner : {};
  const names = new Set();
  const add = (value) => {
    const s = String(value ?? '').trim();
    if (s.length < 2 || s.length > 20 || GENERIC_NAMES.has(s)) return;
    names.add(s);
  };
  add(admin.displayName);
  add(owner.name);
  for (const link of Array.isArray(align.links) ? align.links : []) add(link?.label);
  return [...names];
}

export function findContentSafetyIssues(text, { oasisDir, names } = {}) {
  const src = String(text ?? '');
  const issues = [];
  for (const { label, re } of PRIVACY_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(src)) issues.push('隐私(' + label + ')');
  }
  for (const { label, re } of UNSAFE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(src)) issues.push('言语安全(' + label + ')');
  }
  const protectedNames = Array.isArray(names) ? names : collectProtectedNames({ oasisDir });
  for (const name of protectedNames) {
    if (name && src.includes(name)) { issues.push('隐私(姓名)'); break; }
  }
  return [...new Set(issues)];
}

export function assertOutboundContentSafe(text, { surface = 'B站 内容', oasisDir, names } = {}) {
  const issues = findContentSafetyIssues(text, { oasisDir, names });
  if (!issues.length) return { ok: true, issues };
  throw new Error('✗ ' + surface + '内容安全审查未通过：' + issues.join('、') + '。已拦截，未发送。');
}

export function assertOutboundIdentitySafe(text, { surface = 'B站 内容', oasisDir, ids, names } = {}) {
  const protectedIds = Array.isArray(ids) ? ids : collectProtectedIdentities({ oasisDir });
  const hits = findIdentityLeaks(text, { ids: protectedIds });
  const contentIssues = findContentSafetyIssues(text, { oasisDir, names });
  if (hits.length) throw new Error(formatIdentityLeakError(hits, surface));
  if (contentIssues.length) throw new Error('✗ ' + surface + '内容安全审查未通过：' + contentIssues.join('、') + '。已拦截，未发送。');
  return { ok: true, hits, contentIssues };
}
