// Oasis 品牌与版本信息。
// 不跟 Oasis 上游版本走；数据路径仍兼容旧的 ~/.dsh/oasis。
export const OASIS_BRAND = 'Oasis';
export const OASIS_VERSION = '0.9.1';
export const OASIS_CODENAME = '';
export const OASIS_BASED_ON = 'Oasis 0.6.22';
export const OASIS_SCHEMA = 1;

export function oasisIdentity() {
  return {
    brand: OASIS_BRAND,
    version: OASIS_VERSION,
    codename: OASIS_CODENAME,
    schema: OASIS_SCHEMA,
    basedOn: OASIS_BASED_ON,
    independence: 'local-fork; no upstream auto-update',
    updatedAt: '2026-10-31T21:10:00+08:00',
  };
}
