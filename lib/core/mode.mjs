// lib/core/mode.mjs — 单一工作模式。原三模式（work/mixed/companion）已废弃。
//
// 为什么保留这些导出而不是直接把调用点删干净：注入块、权重、视图、面板接口
// 全都以 mode 作为参数名串在一起，把它们一次性抽掉会牵动上百处签名，
// 换来的只是少几个传参。所以这里保成"恒等于 work 的解析器"：
// 任何传进来的值都被收口成 'work'，外部读到的行为就是"只有一种读法"。
import { MODES } from './entry.mjs';
import { factor, orderOf } from './weights.mjs';

export const MODE = 'work';

export function modeLabel() {
  return '干活';
}

export function modeHint() {
  return '〔本轮读法：' + modeLabel() + '〕';
}

export function modeOrder(weights) {
  return orderOf(weights, MODE).map((x) => ({
    category: x.category,
    value: x.value,
    label: ({ rules: '规矩', facts: '事实', pitfalls: '坑', progress: '进度' })[x.category] || x.category
  }));
}

export function categoryWeight(weights, category) {
  return factor(weights, category, MODE);
}

/** 恒返回工作模式。保留签名，旧的调用点不用改。 */
export function resolveMode() {
  return { mode: MODE, source: 'fixed', confidence: 1, suggested: MODE, session: {} };
}

export const MODES_ALL = MODES;
