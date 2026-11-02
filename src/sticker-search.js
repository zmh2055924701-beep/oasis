// 表情搜索（2026-10-30）：把"收藏表情"和"QQ 系统表情"合并成给模型看的结果。
//
// 纯函数、无 IO：调用方负责调用 SnowLuma（search_sys_faces）和本地收藏库；
// 这里只做清洗、截断、合并与配额判断。安全原则：
//   · 系统表情只保留 编号/名称/分组/别名，不返回网关的 URL 或自由文本；
//   · 所有字段去控制字符、压平空白、限制长度；
//   · 每日搜索配额按"本地日期"重置，防止模型反复刷接口烧 token。
const DEFAULT_DAILY_LIMIT = 30;

function clean(value, limit) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(1, Number(limit) || 1));
}

/** 清洗一条 SnowLuma 系统表情条目；兼容"已清洗过"的形态（便于合并函数做幂等）。缺编号返回 null。 */
export function sanitizeSysFace(face) {
  const rawId = face?.q_sid ?? (face && face.type === 'system' ? face.id : undefined);
  const id = clean(rawId, 20);
  if (!id) return null;
  const aliasRaw = face?.emoji_name_alias ?? face?.alias;
  const nameRaw = face?.q_des ?? face?.name;
  const packRaw = face?.pack_name ?? face?.pack;
  return {
    type: 'system',
    id,
    name: clean(nameRaw, 40),
    pack: clean(packRaw, 40),
    alias: Array.isArray(aliasRaw) ? aliasRaw.map((a) => clean(a, 20)).filter(Boolean).slice(0, 5) : [],
    usage: 'qq_send_face(faceId)'
  };
}

/** 每会话每日搜索配额：返回 { ok, count, max, remaining }；调用方在成功后 count+1。 */
export function stickerSearchQuota(state, limit, now = Date.now()) {
  const max = Math.max(0, Math.round(Number(limit) || 0));
  const date = new Date(now).toISOString().slice(0, 10);
  if (!state || typeof state !== 'object') return { ok: true, count: 0, max, remaining: max, date };
  if (!state.stickerSearch || state.stickerSearch.date !== date) state.stickerSearch = { date, count: 0 };
  const count = Math.max(0, Number(state.stickerSearch.count) || 0);
  if (max > 0 && count >= max) return { ok: false, count, max, remaining: 0, date };
  return { ok: true, count, max, remaining: Math.max(0, max - count), date };
}

/**
 * 合并收藏表情与系统表情结果。
 * @param {{favorites?:object[], systemFaces?:object[], systemError?:string|null, limit?:number}} input
 */
export function mergeStickerSearchResults({ favorites = [], systemFaces = [], systemError = null, limit = 12 } = {}) {
  const max = Math.max(1, Math.min(30, Math.round(Number(limit) || 12)));
  const fav = (Array.isArray(favorites) ? favorites : []).slice(0, max).map((item) => ({ type: 'favorite', ...item }));
  const sys = (Array.isArray(systemFaces) ? systemFaces : [])
    .map((face) => sanitizeSysFace(face))
    .filter(Boolean)
    .slice(0, max);
  return {
    favorites: fav,
    systemFaces: sys,
    systemError: systemError ? clean(systemError, 200) : null,
    matched: fav.length + sys.length
  };
}

export const __DEFAULT_DAILY_LIMIT = DEFAULT_DAILY_LIMIT;
