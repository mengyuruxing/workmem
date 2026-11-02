// lib/dsh/consolidation.mjs — DSH 侧整理运行时：turn/end 自动、面板手动、当前会话模型。
import { readSettings } from '../core/settings.mjs';
import { loadStore } from '../core/store.mjs';
import { normalizeProject } from '../core/util.mjs';
import {
  applyConsolidation,
  buildConsolidationPacket,
  buildConsolidationPrompt,
  consolidationStatus,
  mentionedProjects,
  parseModelJson,
  recordConsolidation,
  validateConsolidation
} from '../core/consolidate.mjs';
import { appendEvent } from '../core/events.mjs';

function eventsOf(session) {
  try {
    if (typeof session?.snapshotEvents === 'function') {
      const rows = session.snapshotEvents();
      if (Array.isArray(rows)) return rows;
    }
  } catch {}
  return Array.isArray(session?.events) ? session.events : [];
}

function textOfMessage(message) {
  const content = message?.content;
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content.map((block) => block && block.type === 'text' ? String(block.text || '') : '').join('\n').trim();
}

function titleOf(session) {
  const events = eventsOf(session);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === 'session/title' && typeof event.data?.title === 'string' && event.data.title.trim()) {
      return event.data.title.trim();
    }
  }
  for (const event of events) {
    if (event?.type !== 'user/message' || event.data?.source?.kind !== 'user') continue;
    const text = textOfMessage(event.data).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 24);
  }
  return String(session?.id || '');
}

function routeOf(session) {
  const events = eventsOf(session);
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i];
    if (row?.type !== 'request/context') continue;
    const provider = String(row.data?.provider || '');
    const model = String(row.data?.model || '');
    if (provider && model) return { provider, model };
  }
  const header = session?.header || {};
  if (header.provider && header.model) return { provider: String(header.provider), model: String(header.model) };
  return null;
}

async function streamModel(llm, route, prompt, signal) {
  const parts = [];
  const textBlocks = [];
  let finishError = null;
  for await (const chunk of llm.stream({
    provider: route.provider,
    model: route.model,
    system: prompt.system,
    messages: [{
      role: 'user',
      content: [{ type: 'text', text: prompt.user }],
      source: { kind: 'plugin:workmem-consolidate' }
    }],
    maxTokens: 3000,
    signal
  })) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') parts.push(chunk.text);
    else if (chunk?.type === 'text' && typeof chunk.text === 'string') textBlocks.push(chunk.text);
    else if (chunk?.kind === 'error') finishError = chunk.failure || chunk.error || 'model-error';
  }
  if (finishError) throw new Error(String(finishError));
  return (parts.length ? parts.join('') : textBlocks.join('')).trim();
}

export function createConsolidationRuntime({ ctx, root, stateFor, currentSid, projectOf, line }) {
  async function run(sid, { trigger = 'manual', turn = 0 } = {}) {
    const st = stateFor(sid);
    if (st.consolidating) return { ok: false, error: 'running', message: '这个对话正在整理' };
    st.consolidating = true;
    const started = Date.now();
    let fromTurn = 0;
    let toTurn = Math.max(0, Number(turn) || st.turn || 0);
    let scopeProjects = [];
    let modelRoute = null;
    let resultForState = null;
    try {
      const { settings } = readSettings(root);
      const status = consolidationStatus(root, {
        sid,
        everyTurns: settings.consolidation.everyTurns,
        turn: toTurn
      });
      fromTurn = trigger === 'manual' && status.lastResult && status.lastResult.ok === false
        ? status.lastOkTurn
        : status.lastTurn;
      const session = st.agent?.session;
      if (!session) {
        resultForState = { ok: false, error: 'no-session', message: '还没有当前对话' };
        recordConsolidation(root, sid, { turn: toTurn, ok: false, result: resultForState });
        return resultForState;
      }
      if (!toTurn) {
        const events = eventsOf(session);
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (events[i]?.type === 'turn/end') {
            toTurn = Math.max(0, Math.floor(Number(events[i].data?.turn) || 0));
            break;
          }
        }
      }
      if (toTurn <= fromTurn) {
        resultForState = { ok: true, wrote: 0, merged: 0, skipped: 0, message: '没有新的对话可整理' };
        recordConsolidation(root, sid, { turn: toTurn, ok: true, result: resultForState });
        return resultForState;
      }

      const base = buildConsolidationPacket(session, {
        root,
        fromTurn,
        toTurn,
        scopeProjects: [],
        sessionTitle: st.title || titleOf(session),
        cwd: st.cwd || session.header?.cwd || session.cwd || '',
        hintsEnabled: settings.consolidation.regexHints
      });
      const store = loadStore(root);
      const scopeSet = new Set();
      const currentProject = normalizeProject(projectOf(st.cwd || session.header?.cwd || session.cwd || ''));
      if (settings.consolidation.scope.currentProject && currentProject) scopeSet.add(currentProject);
      if (settings.consolidation.scope.mentionedProjects) {
        for (const project of mentionedProjects(base.userTexts, store.entries)) scopeSet.add(normalizeProject(project));
      }
      if (settings.consolidation.scope.modifiedProjects) {
        for (const project of st.projects) scopeSet.add(normalizeProject(project));
      }
      if (settings.consolidation.scope.global) scopeSet.add('');
      if (scopeSet.size === 0 && currentProject) scopeSet.add(currentProject);
      scopeProjects = [...scopeSet];

      const packet = buildConsolidationPacket(session, {
        root,
        fromTurn,
        toTurn,
        scopeProjects,
        sessionTitle: st.title || titleOf(session),
        cwd: st.cwd || session.header?.cwd || session.cwd || '',
        hintsEnabled: settings.consolidation.regexHints
      });
      if (!packet.turns.length) {
        resultForState = { ok: true, wrote: 0, merged: 0, skipped: 0, message: '没有新的对话可整理' };
        recordConsolidation(root, sid, { turn: toTurn, ok: true, result: resultForState });
        return resultForState;
      }

      const llm = ctx.get?.('llm');
      if (!llm || typeof llm.stream !== 'function') {
        resultForState = { ok: false, error: 'no-llm', message: '宿主没有模型服务' };
        recordConsolidation(root, sid, { turn: toTurn, ok: false, result: resultForState });
        appendEvent(root, { type: 'consolidate', sid, trigger, fromTurn, toTurn, scope: scopeProjects, ok: false, error: 'no-llm', wrote: 0, merged: 0, skipped: 0, ms: Date.now() - started });
        return resultForState;
      }
      modelRoute = routeOf(session);
      if (!modelRoute) {
        resultForState = { ok: false, error: 'no-route', message: '拿不到当前对话的模型' };
        recordConsolidation(root, sid, { turn: toTurn, ok: false, result: resultForState });
        appendEvent(root, { type: 'consolidate', sid, trigger, fromTurn, toTurn, scope: scopeProjects, ok: false, error: 'no-route', wrote: 0, merged: 0, skipped: 0, ms: Date.now() - started });
        return resultForState;
      }

      const prompt = buildConsolidationPrompt(packet, settings);
      const retries = Math.max(0, Number(settings.consolidation.retry) || 0);
      let validation = null;
      let lastErrors = [];
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        const repair = attempt > 0
          ? '\n\n上一次输出没有通过校验。请只输出 JSON，并修正这些问题：' + lastErrors.join('；')
          : '';
        try {
          const modelText = await streamModel(
            llm,
            modelRoute,
            { system: prompt.system, user: prompt.user + repair },
            AbortSignal.timeout(120000)
          );
          const parsed = parseModelJson(modelText);
          if (!parsed || !Array.isArray(parsed.actions)) {
            lastErrors = ['输出不是带 actions 数组的 JSON'];
            continue;
          }
          validation = validateConsolidation(parsed.actions, packet, settings);
          if (validation.ok) break;
          lastErrors = validation.errors;
        } catch (e) {
          lastErrors = ['模型调用失败：' + String(e?.message || e)];
        }
      }
      if (!validation || !validation.ok) {
        resultForState = { ok: false, error: 'invalid-model-output', message: lastErrors.join('；').slice(0, 500), wrote: 0, merged: 0, skipped: 0 };
        recordConsolidation(root, sid, { turn: toTurn, ok: false, result: resultForState });
        appendEvent(root, { type: 'consolidate', sid, trigger, fromTurn, toTurn, scope: scopeProjects, ok: false, error: 'invalid-model-output', errors: lastErrors.slice(0, 10), wrote: 0, merged: 0, skipped: 0, ms: Date.now() - started, model: modelRoute });
        return resultForState;
      }

      const applied = applyConsolidation(root, validation.actions, {
        actor: '小喵',
        note: trigger === 'auto' ? '自动整理' : '手动整理'
      });
      const ok = applied.errors.length === 0;
      resultForState = {
        ok,
        wrote: applied.wrote,
        merged: applied.merged,
        skipped: applied.skipped,
        errors: applied.errors.slice(0, 10),
        ids: applied.ids,
        scope: scopeProjects,
        fromTurn,
        toTurn,
        model: modelRoute
      };
      recordConsolidation(root, sid, { turn: toTurn, ok, result: resultForState });
      appendEvent(root, {
        type: 'consolidate', sid, trigger, fromTurn, toTurn, scope: scopeProjects,
        ok, wrote: applied.wrote, merged: applied.merged, skipped: applied.skipped,
        errors: applied.errors.slice(0, 10), ids: applied.ids, model: modelRoute,
        ms: Date.now() - started
      });
      return resultForState;
    } catch (e) {
      resultForState = { ok: false, error: 'exception', message: String(e?.message || e) };
      try { recordConsolidation(root, sid, { turn: toTurn, ok: false, result: resultForState }); } catch {}
      try {
        appendEvent(root, { type: 'consolidate', sid, trigger, fromTurn, toTurn, scope: scopeProjects, ok: false, error: 'exception', message: String(e?.message || e), wrote: 0, merged: 0, skipped: 0, ms: Date.now() - started });
      } catch {}
      return resultForState;
    } finally {
      st.consolidating = null;
      st.lastConsolidation = resultForState;
      if (resultForState) {
        line('consolidate ' + trigger + ' sid=' + String(sid).slice(-8) + ' ok=' + Boolean(resultForState.ok) +
          ' wrote=' + (resultForState.wrote || 0) + ' merged=' + (resultForState.merged || 0) +
          (resultForState.error ? ' error=' + resultForState.error : ''));
      }
    }
  }

  function noteProject(sid, project) {
    const value = normalizeProject(project);
    if (!value) return;
    const st = stateFor(sid);
    st.projects.add(value);
  }

  function onSessionEvent(session, event) {
    if (event?.type !== 'turn/end') return;
    const reason = event.data?.reason?.kind;
    if (reason && reason !== 'completed') return;
    const sid = String(session?.id || '');
    if (!sid) return;
    const header = session?.header || {};
    if ((header.origin || session?.origin) === 'subagent') return;
    const st = stateFor(sid);
    st.turn = Math.max(st.turn || 0, Math.floor(Number(event.data?.turn) || 0));
    st.cwd = String(header.cwd || session?.cwd || st.cwd || '');
    st.title = titleOf(session) || st.title;
    const { settings } = readSettings(root);
    if (!settings.consolidation.enabled) return;
    const status = consolidationStatus(root, {
      sid,
      everyTurns: settings.consolidation.everyTurns,
      turn: st.turn
    });
    if (status.dueIn > 0 || st.consolidating) return;
    void run(sid, { trigger: 'auto', turn: st.turn });
  }

  function info() {
    const sid = currentSid();
    const st = stateFor(sid);
    const { settings } = readSettings(root);
    const status = consolidationStatus(root, {
      sid,
      everyTurns: settings.consolidation.everyTurns,
      turn: st.turn || 0
    });
    return {
      enabled: settings.consolidation.enabled,
      everyTurns: settings.consolidation.everyTurns,
      maxEntries: settings.consolidation.maxEntries,
      regexHints: settings.consolidation.regexHints,
      retry: settings.consolidation.retry,
      sid,
      title: st.title || titleOf(st.agent?.session) || '',
      turn: st.turn || 0,
      dueIn: status.dueIn,
      lastTurn: status.lastTurn,
      lastOkTurn: status.lastOkTurn,
      lastAt: status.lastAt,
      lastResult: status.lastResult,
      running: Boolean(st.consolidating)
    };
  }

  return { run, noteProject, onSessionEvent, info };
}
