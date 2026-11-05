// lib/dsh/tools.mjs — DSH 工具定义。核心逻辑仍走 lib/core，工具只做协议转换与写入策略。
import { detailView, searchView } from '../core/view.mjs';
import { createEntry, setStatus, updateEntry } from '../core/mutations.mjs';
import { createSnapshot } from '../core/snapshot.mjs';
import { findEntry } from '../core/store.mjs';
import { canAutoWrite, policyHint } from '../core/policy.mjs';
import { bump } from '../core/stats.mjs';

const txt = (s) => [{ type: 'text', text: s }];

function sessionOf(getSession) {
  try { return getSession?.() || {}; } catch { return {}; }
}

export function createTools({ root, getSession, setAiMode, onProjectTouched }) {
  const write = {
    name: 'workmem_write',
    description: '把一条值得跨会话保留的内容写入工作记忆。分类：规矩/事实/坑/进度。跑腿轮自动写入只允许“坑”；主人明说“记一下”或面板手写不受此限。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['category', 'title', 'content'],
      properties: {
        category: { type: 'string', enum: ['rules', 'facts', 'pitfalls', 'progress'] },
        title: { type: 'string', description: '6–20 字，一眼看出讲什么。' },
        content: { type: 'string', description: '正文。原话一字不改；坑写清成立条件和绕法。' },
        source: { type: 'string', enum: ['quote', 'summary', 'judgment', 'tool'], default: 'summary' },
        importance: { type: 'integer', minimum: 1, maximum: 4, default: 2 },
        project: { type: 'string', default: '' },
        keywords: { type: 'array', items: { type: 'string' } },
        pinned: { type: 'boolean', default: false, description: '钉住后，每轮保底注入优先选它。' }
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok'],
        properties: { ok: { type: 'boolean' }, id: { type: 'string' }, merged: { type: 'boolean' }, error: { type: 'string' }, message: { type: 'string' } }
      },
      render: (_a, v) => txt(v.ok
        ? (v.merged ? '已合并到已有条目（id=' + String(v.id).slice(0, 8) + '）。' : '已写入（id=' + String(v.id).slice(0, 8) + '）。')
        : '没写入：' + (v.message || v.error || '未知原因'))
    },
    async execute(args) {
      const st = sessionOf(getSession);
      if (st.subagent) return { ok: false, error: 'subagent', message: '子会话不写记忆' };
      const decision = canAutoWrite({ turnKind: st.kind || 'chat', category: args.category, explicit: Boolean(st.explicit) });
      if (!decision.ok) return { ok: false, error: decision.reason, message: decision.message };
      const result = createEntry(root, args, {
        actor: '小喵',
        note: st.kind === 'task' ? '跑腿轮只记坑' : '工具写入'
      });
      if (result.ok) {
        try { onProjectTouched?.(result.entry?.project); } catch {}
        return { ok: true, id: result.entry.id, merged: Boolean(result.merged) };
      }
      return { ok: false, error: result.error, message: result.message };
    }
  };

  const read = {
    name: 'workmem_read',
    description: '按 id 读取一条记忆的完整内容、分类、来源、冷热、修改记录。说“我记得”前先用它确认是哪一条。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: { id: { type: 'string' } }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok'],
        properties: {
          ok: { type: 'boolean' }, id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
          category: { type: 'string' }, source: { type: 'string' }, status: { type: 'string' },
          importance: { type: 'integer' }, project: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
          pinned: { type: 'boolean' }, zone: { type: 'string' }, uses: { type: 'integer' }, error: { type: 'string' }
        }
      },
      render: (_a, v) => txt(v.ok
        ? '[' + v.id + '][' + v.category + '][' + v.source + '][' + v.zone + '] ' + v.title + '\n' + v.content
        : '读不到：' + (v.error || '不存在'))
    },
    async execute(args) {
      const found = findEntry(root, String(args.id || ''));
      if (!found) return { ok: false, error: 'not-found' };
      try { bump(root, found.entry.id, 'view'); } catch {}
      const data = detailView(root, found.entry.id, { mode: 'work' });
      const e = data.entry;
      return {
        ok: true, id: e.id, title: e.title, content: e.content, category: e.category,
        source: e.source, status: e.status, importance: e.importance, project: e.project,
        keywords: e.keywords, pinned: Boolean(e.pinned), zone: e.zone, uses: e.uses
      };
    }
  };

  const search = {
    name: 'workmem_search',
    description: '手动搜索记忆，和自动检索同一套打分，但不受门槛限制。返回 id、分类、来源、冷热、分数。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['q'],
      properties: { q: { type: 'string' }, limit: { type: 'integer', default: 10 } }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok', 'count'],
        properties: {
          ok: { type: 'boolean' }, count: { type: 'integer' },
          items: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: true,
              properties: { id: { type: 'string' }, title: { type: 'string' }, category: { type: 'string' }, source: { type: 'string' }, zone: { type: 'string' }, score: { type: 'number' } }
            }
          }
        }
      },
      render: (_a, v) => txt(v.ok
        ? (v.count ? v.items.map((x) => '-' + x.id + ' [' + x.category + '][' + x.source + '][' + x.zone + '] ' + x.title).join('\n') : '没有搜到。')
        : '搜索失败')
    },
    async execute(args) {
      const data = searchView(root, String(args.q || ''), { mode: 'work', limit: Math.min(50, Math.max(1, Number(args.limit) || 10)) });
      const items = data.items.map((e) => ({
        id: e.id, title: e.title, category: e.category, source: e.source, zone: e.zone, score: e.score
      }));
      return { ok: true, count: items.length, items };
    }
  };

  const update = {
    name: 'workmem_update',
    description: '修改一条记忆。原话正文和来源锁死；要更正原话请作废旧条、新建一条。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['id'],
      properties: {
        id: { type: 'string' }, title: { type: 'string' }, content: { type: 'string' },
        source: { type: 'string', enum: ['quote', 'summary', 'judgment', 'tool'] },
        importance: { type: 'integer', minimum: 1, maximum: 4 },
        project: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } },
        pinned: { type: 'boolean' }
      }
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false, required: ['ok'],
        properties: { ok: { type: 'boolean' }, id: { type: 'string' }, changed: { type: 'integer' }, error: { type: 'string' }, message: { type: 'string' } }
      },
      render: (_a, v) => txt(v.ok ? '已更新（改 ' + (v.changed ?? 0) + ' 项）。' : '没改成：' + (v.message || v.error))
    },
    async execute(args) {
      const { id, ...patch } = args;
      const st = sessionOf(getSession);
      if (st.subagent) return { ok: false, error: 'subagent', message: '子会话不改记忆' };
      if (st.kind === 'task' && !st.explicit && (patch.content !== undefined || patch.title !== undefined)) {
        const found = findEntry(root, String(id || ''));
        if (found && found.entry.category !== 'pitfalls') {
          return {
            ok: false,
            error: 'task_turn_only_pitfall',
            message: '本轮是跑腿，只记踩到的坑；要改别的请主人明说“记一下”，或在面板手写。'
          };
        }
      }
      const result = updateEntry(root, String(id || ''), patch, { actor: '小喵', note: '工具修改' });
      if (result.ok) {
        try { onProjectTouched?.(result.entry?.project); } catch {}
        return { ok: true, id: String(id), changed: result.changed ?? 0 };
      }
      return { ok: false, error: result.error, message: result.message };
    }
  };

  const archive = {
    name: 'workmem_archive',
    description: '归档一条记忆（不删除，可恢复）。',
    parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' }, id: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } } },
      render: (_a, v) => txt(v.ok ? '已归档。' : '没归档：' + (v.message || v.error))
    },
    async execute(args) {
      if (sessionOf(getSession).subagent) return { ok: false, error: 'subagent', message: '子会话不归档记忆' };
      const result = setStatus(root, String(args.id || ''), 'archived', { actor: '小喵', note: '工具归档' });
      return result.ok ? { ok: true, id: String(args.id) } : { ok: false, error: result.error, message: result.message };
    }
  };

  const revoke = {
    name: 'workmem_revoke',
    description: '作废一条记忆（不删除，可恢复）。',
    parameters: { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' }, id: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } } },
      render: (_a, v) => txt(v.ok ? '已作废。' : '没作废：' + (v.message || v.error))
    },
    async execute(args) {
      if (sessionOf(getSession).subagent) return { ok: false, error: 'subagent', message: '子会话不作废记忆' };
      const result = setStatus(root, String(args.id || ''), 'revoked', { actor: '小喵', note: '工具作废' });
      return result.ok ? { ok: true, id: String(args.id) } : { ok: false, error: result.error, message: result.message };
    }
  };

  const snapshot = {
    name: 'workmem_snapshot',
    description: '给整个记忆目录拍快照。',
    parameters: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, note: { type: 'string' } } },
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' }, name: { type: 'string' }, error: { type: 'string' }, message: { type: 'string' } } },
      render: (_a, v) => txt(v.ok ? '已快照：' + v.name : '快照失败：' + (v.message || v.error))
    },
    async execute(args) {
      const result = createSnapshot(root, { name: args.name, note: args.note || '工具快照' });
      return result.ok ? { ok: true, name: result.name } : { ok: false, error: result.error, message: result.message };
    }
  };

  return [write, read, search, update, archive, revoke, snapshot];
}

export { policyHint };
