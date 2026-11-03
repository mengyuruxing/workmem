#!/usr/bin/env node
// 记忆通讯：把「本轮命中哪些记忆」「上次自动整理结果」读出来，供对话与面板显示
// 用法:
//   node memory-ping.cjs            只看本轮（最近一次 turn 事件）
//   node memory-ping.cjs --json     JSON 输出（面板用）
//   node memory-ping.cjs --last 3   看最近 3 轮
const fs = require('fs');
const path = require('path');

const DIR = 'E:\\aiwork\\data\\workmem\\_logs';
const FILE = path.join(DIR, 'events.jsonl');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const lastN = Number((args[args.indexOf('--last') + 1]) || 1) || 1;

if (!fs.existsSync(FILE)) {
  console.log(asJson ? '{"ok":false,"error":"没有事件日志"}' : '没有事件日志');
  process.exit(0);
}

const lines = fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean);
const evs = [];
for (const l of lines) {
  try { evs.push(JSON.parse(l)); } catch { /* 跳过坏行 */ }
}

const turns = evs.filter((e) => e.type === 'turn').slice(-lastN);
const cons = evs.filter((e) => e.type === 'consolidate').slice(-1)[0] || null;
const snaps = evs.filter((e) => e.type === 'snapshot').slice(-1)[0] || null;

const pack = (arr) => (arr || []).map((x) => ({ id: x.id, title: x.title || '', category: x.category || '' }));

const out = {
  ok: true,
  turns: turns.map((t) => ({
    ts: t.ts,
    kind: t.kind,
    mode: t.mode,
    query: (t.query || '').slice(0, 60),
    acted: t.acted || '',
    baseline: pack(t.baseline),
    picked: pack(t.picked),
    counts: {
      baseline: (t.baseline || []).length,
      picked: (t.picked || []).length,
      total: (t.baseline || []).length + (t.picked || []).length,
    },
  })),
  lastConsolidate: cons
    ? {
        ts: cons.ts,
        ok: cons.ok,
        trigger: cons.trigger,
        wrote: cons.wrote,
        merged: cons.merged,
        fromTurn: cons.fromTurn,
        toTurn: cons.toTurn,
        error: cons.error || null,
      }
    : null,
  lastSnapshot: snaps ? { ts: snaps.ts, name: snaps.name || '' } : null,
};

if (asJson) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

for (const t of out.turns) {
  console.log(`【记忆命中】${t.ts}  模式=${t.mode}  类型=${t.kind}  共 ${t.counts.total} 条（保底 ${t.counts.baseline} / 检索 ${t.counts.picked}）`);
  const all = [...t.baseline, ...t.picked];
  for (const m of all) console.log(`   - [${m.id}] ${m.title}`);
  if (!all.length) console.log('   （本轮没有命中任何记忆）');
  console.log('');
}
if (out.lastConsolidate) {
  const c = out.lastConsolidate;
  console.log(`【自动整理】${c.ts}  结果=${c.ok ? '成功' : '失败'}  触发=${c.trigger}  写入 ${c.wrote || 0} 条  合并 ${c.merged || 0} 条  范围 turn ${c.fromTurn}→${c.toTurn}` + (c.error ? `  错误=${c.error}` : ''));
} else {
  console.log('【自动整理】暂无记录');
}
