# lib/core

纯逻辑层，不依赖 DSH、不读环境变量、不联网。所有函数接收明确的路径/数据参数，方便单测。

## 模块

| 模块 | 职责 | 主要输入/输出 |
|---|---|---|
| `entry.mjs` | 解析/序列化 Markdown 条目 | `parseCategoryFile(text, category)` → `{entries, warnings}`；`serializeCategoryFile(entries, category)` |
| `store.mjs` | 读 4 个分类文件、原子写、mtime 冲突 | `loadStore(root)`；`saveCategory(root, category, entries, { expectedMtimeMs })` |
| `stats.mjs` | 命中/打开计数、最后被碰 | `readStats(root)`；`bump(root, id, kind)`；`zoneOf(entry, stat, coldDays, now)` |
| `weights.mjs` | 4×1 矩阵、档位、默认值 | `readWeights(root)`；`setCell(weights, category, mode, level)`；`factor(weights, category, mode)`；`normalizeMode(mode)` |
| `settings.mjs` | 配置默认值、缺字段补齐 | `readSettings(root)`；`writeSettings(root, settings)` |
| `index.mjs` | 加载上下文、检索入口 | `loadSearchContext(root)`；`searchStore(root, query, opts)`；`manualSearchStore(...)` |
| `search.mjs` | 分词、打分、门槛、手动搜索 | `buildIndex(entries, { statuses })`；`search(index, query, opts)` → `{picks, diagnostics}` |
| `mode.mjs` | 单一读法（恒 `work`），保留展示接口 | `MODE`；`resolveMode()`；`modeLabel()`；`modeHint()`；`modeOrder(weights)`；`categoryWeight(weights, category)` |
| `policy.mjs` | 告诉/跑腿/闲聊、写入放行 | `classifyTurnKind(text)`；`canAutoWrite({ turnKind, category, explicit })` |
| `health.mjs` | 绿/黄/红、30 轮小字 | `computeHealth(root, { now })` |
| `lifecycle.mjs` | 冷暖计算、每日冷区扫描 | `computeZones(root)`；`sweepCold(root)`；`maybeSweepCold(root)` |
| `events.mjs` | 追加/读取 JSONL | `appendEvent(root, event)`；`readEvents(root, opts)`；`readTurns(root, n)` |
| `audit.mjs` | 追加审计 | `appendAudit(root, record)`；`readAudit(root, { itemId })` |
| `mutations.mjs` | 新建/编辑/合并/状态 | `createEntry(root, input, opts)`；`updateEntry(root, id, patch)`；`setStatus(...)` |
| `inject.mjs` | 注入块渲染 | `renderInjection(picks, { mode, maxChars, hint })` |
| `view.mjs` | 面板视图 | `listView` / `searchView` / `detailView` / `statsView` / `timelineView` / `diagnosticsView` / `weightsView` / `snapshotsView` / `sessionsView` |
| `snapshot.mjs` | 目录快照、回滚、安全快照 | `createSnapshot(root, { name })`；`rollback(root, name, { actor })`；`listSnapshots(root)` |
| `consolidate.mjs` | 整理计划（合并散条目） | `planConsolidation(...)` |

## 约定

- 所有写操作返回 `{ok, error}`，不抛到面板层。
- 所有时间用 ISO 8601 带时区字符串或毫秒时间戳，模块内统一。
- 解析器不丢未知字段；序列化按稳定顺序输出。
- 核心层不记录日志到控制台；事件由调用方写。
