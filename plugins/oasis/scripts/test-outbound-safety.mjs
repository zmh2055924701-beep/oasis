import assert from 'node:assert/strict';
import { findContentSafetyIssues, assertOutboundContentSafe } from '../tools/lib/outbound-guard.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n += 1; console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + ': ' + e.message); process.exitCode = 1; } };

t('普通吐槽放行', () => assert.equal(findContentSafetyIssues('哼，才不是特意帮你呢，这个细节挺可爱的。').length, 0));
t('手机号拦截', () => assert.ok(findContentSafetyIssues('我电话 13812345678').some((x) => x.includes('手机号'))));
t('邮箱拦截', () => assert.ok(findContentSafetyIssues('发我 aa@bb.com').some((x) => x.includes('邮箱'))));
t('QQ号拦截', () => assert.ok(findContentSafetyIssues('加我 QQ: 100000000').some((x) => x.includes('QQ'))));
t('敏感词拦截', () => assert.ok(findContentSafetyIssues('去死吧').some((x) => x.includes('言语安全'))));
t('正常内容不抛错', () => assert.doesNotThrow(() => assertOutboundContentSafe('这个视频的镜头很妙。')));
t('隐私内容抛错', () => assert.throws(() => assertOutboundContentSafe('我住址是……'), /安全审查未通过/));
console.log('OUTBOUND_SAFETY ' + n + ' passed');
