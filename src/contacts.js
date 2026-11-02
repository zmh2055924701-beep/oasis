// 联系人/群目录（2026-10-30）：让她知道“对象/妈”对应哪个 QQ 号、哪个群是“所有消息都回”模式。
//
// 配置用文本 spec（设置页可直接编辑，不用懂 JSON）：
//   contactsSpec:   每行一个   QQ号=称呼[,别名...]
//   groupModesSpec: 每行一个   群号=all|normal[,群名]
// spec 为空时从白名单自动推导（主人=爸/主人；第一个其他私聊=妈/对象；群默认 normal）。
import { sanitizeText } from './brain/schema.js';

const QQ_RE = /^\d{5,12}$/;
const GROUP_RE = /^\d{5,12}$/;

function lines(text) {
  return String(text ?? '')
    .split(/[\r\n;；]+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function parseContactsSpec(text) {
  const contacts = [];
  for (const line of lines(text)) {
    const [rawId, rest = ''] = line.split('=');
    const qq = String(rawId ?? '').trim();
    if (!QQ_RE.test(qq)) continue;
    const parts = rest.split(/[,，、]/).map((s) => sanitizeText(s, 24)).filter(Boolean);
    const name = parts[0] || ('QQ ' + qq);
    contacts.push({ qq, name, aliases: [...new Set(parts.slice(1))].slice(0, 8) });
  }
  return contacts;
}

export function formatContactsSpec(contacts) {
  return (Array.isArray(contacts) ? contacts : [])
    .filter((c) => c && QQ_RE.test(String(c.qq ?? '')))
    .map((c) => String(c.qq) + '=' + [c.name || ('QQ ' + c.qq), ...(Array.isArray(c.aliases) ? c.aliases : [])].join(','))
    .join('\n');
}

export function parseGroupModesSpec(text) {
  const groups = [];
  for (const line of lines(text)) {
    const [rawId, rest = ''] = line.split('=');
    const id = String(rawId ?? '').trim();
    if (!GROUP_RE.test(id)) continue;
    const parts = rest.split(/[,，、]/).map((s) => sanitizeText(s, 24)).filter(Boolean);
    const mode = parts[0] === 'all' ? 'all' : 'normal';
    groups.push({ id, mode, name: parts.slice(1).join('') || '' });
  }
  return groups;
}

export function formatGroupModesSpec(groups) {
  return (Array.isArray(groups) ? groups : [])
    .filter((g) => g && GROUP_RE.test(String(g.id ?? '')))
    .map((g) => String(g.id) + '=' + (g.mode === 'all' ? 'all' : 'normal') + (g.name ? ',' + g.name : ''))
    .join('\n');
}

/** 白名单推导：没有 spec 时的默认目录（名字可猜，设置页可改）。 */
export function deriveDirectoryFromAllow(cfg = {}) {
  const allow = cfg.allow && typeof cfg.allow === 'object' ? cfg.allow : {};
  const ownerQQ = String(cfg.ownerQQ ?? '').trim();
  const privates = (Array.isArray(allow.private) ? allow.private : []).map(String).filter((id) => QQ_RE.test(id));
  const contacts = [];
  if (QQ_RE.test(ownerQQ)) {
    contacts.push({ qq: ownerQQ, name: '爸', aliases: ['主人', '你爸', '管理员'] });
  }
  const others = privates.filter((id) => id !== ownerQQ);
  const otherNames = ['妈', '对象', '朋友'];
  others.forEach((id, index) => {
    const base = otherNames[Math.min(index, otherNames.length - 1)];
    const aliases = ['对象', '你' + base].filter((a) => a && a !== base);
    contacts.push({ qq: id, name: base, aliases: [...new Set(aliases)] });
  });
  const groups = (Array.isArray(allow.groups) ? allow.groups : [])
    .map(String)
    .filter((id) => GROUP_RE.test(id))
    .map((id) => ({ id, mode: 'normal', name: '' }));
  return { contacts, groups };
}

/** 合并 spec + 白名单推导，得到最终目录。 */
export function buildDirectory({ contactsSpec = '', groupModesSpec = '', cfg = {} } = {}) {
  const derived = deriveDirectoryFromAllow(cfg);
  const specContacts = parseContactsSpec(contactsSpec);
  const specGroups = parseGroupModesSpec(groupModesSpec);
  const contactMap = new Map();
  for (const c of derived.contacts) contactMap.set(c.qq, c);
  for (const c of specContacts) contactMap.set(c.qq, c);
  const groupMap = new Map();
  for (const g of derived.groups) groupMap.set(g.id, g);
  for (const g of specGroups) groupMap.set(g.id, g);
  return { contacts: [...contactMap.values()], groups: [...groupMap.values()] };
}

export function contactName(contact) {
  const aliases = Array.isArray(contact?.aliases) ? contact.aliases : [];
  return [...new Set([contact?.name, ...aliases].filter(Boolean))].join('/');
}

/** 给提示词用的目录块：明确“谁是谁、哪个 QQ、哪个群是什么模式”。 */
export function directoryPromptBlock(directory, currentKey = '') {
  const contacts = Array.isArray(directory?.contacts) ? directory.contacts : [];
  const groups = Array.isArray(directory?.groups) ? directory.groups : [];
  if (!contacts.length && !groups.length) return '';
  const lines = [];
  if (contacts.length) {
    lines.push('【你认识的人（本机配置，可以用来找人）】');
    for (const c of contacts) {
      const aliases = Array.isArray(c.aliases) ? c.aliases.filter(Boolean) : [];
      lines.push('- ' + contactName(c) + '：QQ ' + c.qq + (aliases.length ? '（也叫：' + aliases.join('、') + '）' : ''));
    }
    lines.push('如果有人让你“给对象/妈/爸发消息”，先在这个名单里找到对应 QQ，再用 qq_send_private_message 发给那个 QQ；不确定时先问清楚，不要猜。');
  }
  if (groups.length) {
    lines.push('【你所在的群（模式）】');
    for (const g of groups) {
      const mode = g.mode === 'all' ? '所有消息都回（主人设置的）' : '正常模式（被叫到/提问再回）';
      lines.push('- ' + (g.name || g.id) + '：群 ' + g.id + '，' + mode + (currentKey === 'group:' + g.id ? '（当前窗口）' : ''));
    }
  }
  return lines.join('\n') + '\n\n';
}

export function groupModeOf(directory, groupId) {
  const group = (Array.isArray(directory?.groups) ? directory.groups : []).find((g) => String(g.id) === String(groupId));
  return group?.mode === 'all' ? 'all' : 'normal';
}
