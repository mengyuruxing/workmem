// lib/core/policy.mjs — 告诉/跑腿/闲聊判断与写入放行。
const EXPLICIT_RE = /(记一下|记住|别忘|存一下|写进记忆|记下来|记录一下|帮我记)/;
const TASK_RE = /(帮我|给我|去|跑|装|改|查|修|部署|生成|写个|写一个|运行|执行|打开|下载|上传|删除|移动|复制|重启|安装|配置|提交|推送|拉取|检查|看一下|弄一下|搞一下|处理|做一下|开始|继续|构建|测试|修复|优化|排查|定位|统计|整理|备份|恢复|回滚|导入|导出)/;
const TELL_RE = /(我觉得|我认为|我喜欢|我不喜欢|我要|我想|我决定|我定|我说过|我告诉|纠正|不是这样|以后|别|不要|规则|规矩|我是|我有|我在|我的)/;
const CHAT_RE = /(在吗|陪我|聊聊|聊天|无聊|难过|开心|晚安|早安|想你|抱抱|亲亲|可爱|喜欢|讨厌|烦|累|困|饿|心情|情绪|安慰|哄|夸|故事|游戏|电影|音乐|猫)/;
const PITFALL_RE = /(报错|错误|失败|踩坑|坑|不兼容|超时|占用|权限|拒绝|异常|崩溃|挂了|报错码|ENOENT|EACCES|EPERM|端口.*冲突|得用|只能|绕过|workaround)/i;

export function explicitRemember(text) {
  return EXPLICIT_RE.test(String(text ?? ''));
}

export function isPitfall(text) {
  return PITFALL_RE.test(String(text ?? ''));
}

export function classifyTurnKind(text) {
  const s = String(text ?? '');
  const task = (s.match(new RegExp(TASK_RE.source, 'g')) ?? []).length;
  const tell = (s.match(new RegExp(TELL_RE.source, 'g')) ?? []).length;
  const chat = (s.match(new RegExp(CHAT_RE.source, 'g')) ?? []).length;
  let kind = 'chat';
  if (task > 0 && tell === 0) kind = 'task';
  else if (tell > 0 && task === 0) kind = 'tell';
  else if (task > 0 && tell > 0) kind = task >= tell ? 'task' : 'tell';
  else if (chat > 0) kind = 'chat';
  const total = task + tell + chat;
  return {
    kind,
    explicit: explicitRemember(s),
    confidence: total === 0 ? 0 : Number((Math.max(task, tell, chat) / total).toFixed(2)),
    signals: { task, tell, chat }
  };
}

/** 跑腿轮自动写入只放行“坑”；明说“记一下”放行；手动写入不经过这里。 */
export function canAutoWrite({ turnKind, category, explicit = false } = {}) {
  if (explicit) return { ok: true, reason: 'explicit' };
  if (turnKind === 'task' && category !== 'pitfalls') {
    return {
      ok: false,
      reason: 'task_turn_only_pitfall',
      message: '本轮是跑腿，只记踩到的坑；要记别的请主人明说“记一下”，或在面板手写。'
    };
  }
  return { ok: true, reason: 'normal' };
}

export function policyHint(turnKind) {
  return turnKind === 'task' ? '〔本轮是跑腿：只记踩到的坑；过程与成功汇报不记。〕' : '';
}
