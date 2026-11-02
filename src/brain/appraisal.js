// 评估（appraisal）：把一条消息翻译成"对我意味着什么"。
//
// 这是情感可追溯的起点：所有情绪都必须能指回某条消息 + 某组评估维度。
// 纯函数、无 IO；规则先粗后细，后续可以加更多语境（时间/关系/历史）。
import { clamp01, clampSigned, iso, sanitizeText } from './schema.js';

const RE = {
  praise: /厉害|优秀|真棒|很棒|好棒|牛|666|聪明|乖|可爱|好看|漂亮|暖心|贴心|辛苦|谢谢|感谢|喜欢你|爱你|想你|最好了|好孩子/,
  affection: /想你了|抱抱|亲亲|摸摸|贴贴|晚安|早安|我在|别怕|陪你|宠你|爱你|喜欢你/,
  criticism: /生气|烦死|烦人|凶|讨厌|笨|蠢|失望|闭嘴|别说话|滚|没用|废|不像你|别装了|换一个|不好好|又错/,
  identityThreat: /不像|人格|换一个|别装了|不是我要的|失望|你变了|敷衍|机器人|AI|装的/,
  apology: /对不起|抱歉|是我不好|别生气|原谅|和好|不该|我错/,
  share: /今天|刚才|刚刚|吃了|去了|看了|玩|工作|上班|加班|忙|累|困|饿|冷|热|睡|课|考试|游戏|视频|猫|狗|朋友/,
  question: /[?？]|吗|呢|怎么|为什么|为啥|哪|什么|啥/,
  promise: /答应|约定|说好|以后|下次|记得|不要忘|保证|发誓|回头/,
  conflict: /吵架|冷战|不理你|敷衍|生气|凶你|误会/,
  care: /多喝水|早点睡|注意身体|别累|照顾好|担心|心疼|没事吧|怎么了|还好吗/,
  bili: /B站|b站|评论|动态|视频|弹幕|私信/,
};

function countMatches(text, re) {
  const m = String(text ?? '').match(re);
  return m ? m.length : 0;
}

/**
 * 评估一条消息。
 * @param {{text:string, fromOwner:boolean, isPrivate:boolean, platform?:string, conversationKey?:string, direct?:boolean, now?:number, context?:object}} input
 * @returns {{appraisal:object, emotions:object[], needsDelta:object, summary:string, salience:number}}
 */
export function appraiseMessage(input = {}) {
  const now = Number(input.now) || Date.now();
  const text = sanitizeText(input.text, 800);
  const fromOwner = input.fromOwner === true;
  const isPrivate = input.isPrivate === true;
  const platform = String(input.platform ?? 'qq');
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const direct = input.direct === true || isPrivate || fromOwner;
  const praise = countMatches(text, RE.praise);
  const affection = countMatches(text, RE.affection);
  const criticism = countMatches(text, RE.criticism);
  const identityThreat = countMatches(text, RE.identityThreat);
  const apology = countMatches(text, RE.apology);
  const share = countMatches(text, RE.share);
  const question = countMatches(text, RE.question);
  const promise = countMatches(text, RE.promise);
  const conflict = countMatches(text, RE.conflict);
  const care = countMatches(text, RE.care);
  const bili = countMatches(text, RE.bili);

  // 语境：主人隔了很久才回来（他回来这件事本身是正向的）
  const idleMin = Math.max(0, Number(context.ownerIdleMinutes) || 0);
  const ownerReturn = fromOwner && idleMin >= 120;
  const unread = Math.max(0, Number(context.unreadCount) || 0);

  const emotions = [];
  const add = (type, intensity, cause, halfLifeHours = 3) => {
    const value = clamp01(intensity, 0);
    if (value <= 0.02) return;
    emotions.push({ type, intensity: value, cause: sanitizeText(cause, 120), halfLifeMs: Math.round(Math.max(0.25, halfLifeHours) * 3600000) });
  };

  if (criticism || identityThreat) {
    add('wronged', 0.35 + Math.min(0.45, criticism * 0.12) + (identityThreat ? 0.15 : 0), '被批评/被否定', 5);
    add('sad', 0.2 + Math.min(0.3, criticism * 0.08) + (identityThreat ? 0.12 : 0), '被批评/被否定', 6);
    if (identityThreat) add('anxious', 0.25, '身份被质疑', 4);
  } else if (apology) {
    add('calm', 0.4, '对方道歉/和好', 2);
    add('warm', 0.3 + Math.min(0.2, apology * 0.08), '对方道歉/和好', 2);
  } else if (praise && fromOwner) {
    add('shy', 0.45 + Math.min(0.25, praise * 0.1), '被主人夸', 2);
    add('joy', 0.35 + Math.min(0.25, praise * 0.08), '被主人夸', 2);
    add('warm', 0.3, '被主人夸', 3);
  } else if (praise) {
    add('pride', 0.3, '被夸', 2);
    add('joy', 0.2, '被夸', 2);
  }
  if (affection && fromOwner) {
    add('warm', 0.35, '主人表达亲近', 4);
    add('shy', 0.25, '主人表达亲近', 2);
  }
  if (care) add('warm', 0.25, '对方关心', 3);
  if (share && !criticism) add('curiosity', 0.2 + Math.min(0.2, share * 0.05), '对方分享日常', 3);
  if (question && direct) add('curiosity', 0.15, '被提问', 1.5);
  if (promise) add('calm', 0.2, '约定/承诺', 6);
  if (conflict && !criticism) add('anxious', 0.2, '关系出现摩擦', 4);
  if (conflict && apology) add('calm', 0.3, '和好', 3);
  if (!fromOwner && !direct) add('curiosity', 0.08, '群里有人说话', 1);
  if (fromOwner && ownerReturn) {
    add('joy', 0.3, '隔了很久主人又出现', 2);
    add('warm', 0.3, '隔了很久主人又出现', 2);
  }
  if (bili && platform !== 'qq') add('curiosity', 0.1, 'B站见闻', 2);

  // 评估维度
  const goalCongruence = clampSigned(
    (praise + affection + care + apology + (ownerReturn ? 1 : 0)) * 0.18
    - (criticism + identityThreat) * 0.22
    + (share ? 0.05 : 0),
  );
  const agency = fromOwner ? 'owner' : (direct ? 'other' : (platform === 'bili' ? 'bili' : 'other'));
  const certainty = clamp01(fromOwner ? 0.8 : 0.55, 0.55);
  const novelty = clamp01(share > 0 || bili > 0 ? 0.6 : 0.3, 0.3);
  const control = clamp01(0.5 - (criticism + identityThreat) * 0.08 + (promise ? 0.05 : 0), 0.5);
  const relationship = clampSigned(
    (praise + affection + care + apology + (ownerReturn ? 1 : 0)) * 0.16
    - (criticism + identityThreat) * 0.2
    - (conflict && !apology ? 1 : 0) * 0.1,
  );
  const identity = clampSigned((praise + affection) * 0.12 - identityThreat * 0.3);

  // 需求变化（-8..8）
  const needsDelta = {
    social: fromOwner ? 3 : (direct ? 2 : 1),
    curiosity: question > 0 || share > 0 ? 3 : 1,
    rest: -0.5,
    security: apology > 0 || care > 0 ? 2 : (criticism > 0 ? -3 : 0),
    esteem: praise > 0 ? 3 : (criticism > 0 ? -3 : 0),
  };
  if (ownerReturn) needsDelta.social += 3;

  const salience = clamp01(
    (fromOwner ? 0.35 : 0.1) + (direct ? 0.15 : 0)
    + Math.min(0.3, (praise + affection + criticism + apology) * 0.08)
    + (identityThreat ? 0.2 : 0),
  );

  const summary = [
    fromOwner ? '主人' : '对方',
    isPrivate ? '私聊' : '群里',
    praise ? '夸我' : '',
    criticism ? '批评/否定' : '',
    apology ? '道歉' : '',
    share ? '分享日常' : '',
    question ? '提问' : '',
  ].filter(Boolean).join(' · ');

  return {
    at: iso(now),
    appraisal: { goalCongruence, agency, certainty, novelty, control, relationship, identity },
    emotions: emotions.slice(0, 6),
    needsDelta,
    salience,
    summary: summary || '普通消息',
  };
}
