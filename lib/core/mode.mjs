// lib/core/mode.mjs — 三模式、自动分类、平滑、手动锁、AI 覆盖。
import { MODES } from './entry.mjs';
import { factor, orderOf } from './weights.mjs';

const WORK_RE = /(帮我|给我|去|跑|装|改|查|修|部署|生成|写个|写一个|运行|执行|打开|下载|上传|删除|移动|复制|重启|安装|配置|提交|推送|拉取|检查|看一下|弄一下|搞一下|处理|做一下|开始|继续|构建|测试|修复|优化|排查|定位|统计|整理|备份|恢复|回滚|导入|导出)/;
const COMPANION_RE = /(在吗|陪我|聊聊|聊天|无聊|难过|开心|晚安|早安|想你|抱抱|亲亲|可爱|喜欢|讨厌|烦|累|困|饿|心情|情绪|安慰|哄|夸|故事|游戏|电影|音乐|猫)/;
const WORK_CONTEXT_RE = /(路径|端口|文件|目录|命令|报错|错误|版本|配置|代码|项目|部署|安装|构建|测试|备份|回滚|日志|接口|数据库|脚本|插件|服务|进程|git|npm|pnpm|node|python|http|api)/i;

function countMatches(text, re) {
  const matches = String(text ?? '').match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
  return matches ? matches.length : 0;
}

export function classifyTurn(text) {
  const s = String(text ?? '');
  const work = countMatches(s, WORK_RE) + countMatches(s, WORK_CONTEXT_RE) * 2;
  const companion = countMatches(s, COMPANION_RE) * 2;
  const total = work + companion;
  let mode = 'mixed';
  if (work > 0 && work >= companion) mode = 'work';
  else if (companion > 0 && companion > work) mode = 'companion';
  const confidence = total === 0 ? 0 : Math.min(0.95, Math.abs(work - companion) / (total + 1));
  return { mode, confidence: Number(confidence.toFixed(2)), signals: { work, companion } };
}

function validMode(value) {
  return MODES.includes(value);
}

function normalizeSession(session) {
  const s = session && typeof session === 'object' ? session : {};
  return {
    mode: validMode(s.mode) ? s.mode : null,
    source: s.source === 'manual' || s.source === 'ai' ? s.source : 'auto',
    pendingMode: validMode(s.pendingMode) ? s.pendingMode : null,
    pendingCount: Math.max(0, Number(s.pendingCount) || 0)
  };
}

/** 优先级：手动锁 > AI 覆盖 > 本地自动。返回新 session，不写文件。 */
export function resolveMode({ settings, session = {}, aiOverride = null, text = '' }) {
  const s = normalizeSession(session);
  if (settings?.mode?.locked) {
    const manual = validMode(settings.mode.default) ? settings.mode.default : (s.mode || settings.mode.fallback || 'mixed');
    return { mode: manual, source: 'manual', confidence: 1, suggested: manual, session: { ...s, mode: manual, source: 'manual', pendingMode: null, pendingCount: 0 } };
  }
  if (validMode(aiOverride)) {
    return { mode: aiOverride, source: 'ai', confidence: 1, suggested: aiOverride, session: { ...s, mode: aiOverride, source: 'ai', pendingMode: null, pendingCount: 0 } };
  }
  const result = classifyTurn(text);
  const fallback = validMode(settings?.mode?.fallback) ? settings.mode.fallback : 'mixed';
  const current = s.mode || fallback;
  const suggested = result.confidence < 0.2 ? fallback : result.mode;
  if (!s.mode) {
    return { ...result, mode: suggested, source: 'auto', suggested, session: { ...s, mode: suggested, source: 'auto', pendingMode: null, pendingCount: 0 } };
  }
  if (suggested === current) {
    return { ...result, mode: current, source: 'auto', suggested, session: { ...s, mode: current, source: 'auto', pendingMode: null, pendingCount: 0 } };
  }
  const pendingCount = s.pendingMode === suggested ? s.pendingCount + 1 : 1;
  if (pendingCount >= 2) {
    return { ...result, mode: suggested, source: 'auto', suggested, session: { ...s, mode: suggested, source: 'auto', pendingMode: null, pendingCount: 0 } };
  }
  return { ...result, mode: current, source: 'auto', suggested, session: { ...s, mode: current, source: 'auto', pendingMode: suggested, pendingCount } };
}

export function setManual(settings, mode) {
  if (!validMode(mode)) throw new Error('未知模式：' + mode);
  return { ...structuredClone(settings), mode: { ...settings.mode, default: mode, locked: true } };
}

export function setAuto(settings) {
  return { ...structuredClone(settings), mode: { ...settings.mode, default: 'auto', locked: false } };
}

export function modeLabel(mode) {
  return mode === 'work' ? '干活' : mode === 'companion' ? '陪人' : '混合';
}

export function modeHint(mode) {
  return '〔本轮读法：' + modeLabel(mode) + '〕';
}

export function modeOrder(weights, mode) {
  return orderOf(weights, mode).map((x) => ({
    category: x.category,
    value: x.value,
    label: ({ rules: '规矩', facts: '事实', pitfalls: '坑', progress: '进度', persona: '人设' })[x.category] || x.category
  }));
}

export function categoryWeight(weights, category, mode) {
  return factor(weights, category, mode);
}
