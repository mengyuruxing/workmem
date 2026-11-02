# workmem 数据格式

本文档是实现的唯一格式依据。代码和面板都按这里读写。

---

## 1. 数据目录

默认：`E:/aiwork/data/workmem`，可用环境变量 `WORKMEM_HOME` 覆盖。

```
<WORKMEM_HOME>/
  work/
    rules.md          规矩
    facts.md          事实
    pitfalls.md       坑
    progress.md       进度
  persona/
    persona.md        人设
  _stats.json         命中/打开次数、最后被碰时间
  _weights.json       5×3 权重矩阵与档位数值
  _settings.json      冷暖期限、健康阈值、检索门槛、深挖开关
  _audit/
    edits.jsonl       修改审计（追加）
  _logs/
    events.jsonl      检索/写入/快照/健康事件（追加）
  _snapshots/
    20261102-153000/  整目录快照
```

- 记忆正文只有 5 个文件。
- 边车文件不是记忆本体；删掉统计不会丢正文，删掉正文就是丢记忆。
- 快照是数据目录的副本，不含 `_snapshots` 自身。

---

## 2. 编码与时间

- 文件编码：UTF-8，不带 BOM。
- 换行：写入用 LF；读取同时接受 CRLF。
- 时间：ISO 8601，带时区，例如 `2026-11-02T15:00:00+08:00`。面板显示本地时间。
- 文件大小：单分类文件建议不超过 5 MB；超过时在面板提示，但第一版不自动拆分。

---

## 3. Markdown 分类文件

### 3.1 文件头

每个文件第一行是分类标题：

```markdown
# 规矩
```

标题只是给人看的；分类由文件路径决定，代码不靠标题判断。

### 3.2 条目格式

```markdown
## [a1b2c3d4] 改库前先备份
- 来源：原话
- 状态：正常
- 重要度：★★★★
- 项目：全局
- 关键词：备份, 记忆库, 回滚
- 写入：2026-11-02T15:00:00+08:00
- 更新：2026-11-02T15:00:00+08:00
- 钉住：是

动任何记忆库之前，先整库备份，并当场说明备份位置。
```

- `## [id] 标题` 是条目起点，`id` 固定 8 位小写十六进制。
- 标题最多 40 个字符；建议 6–20 字。
- 元数据行是 `- 键：值`，中文冒号；解析器也接受英文冒号。
- 元数据之后空一行，再写正文。
- 正文可以多段，可以用 `###` 及更低级标题；**不要用 `##`**，`## [` 是条目分隔符。
- 文件末尾保留一个空行。

### 3.3 字段

| 字段 | 必填 | 值 | 说明 |
|---|---|---|---|
| id | 是 | 8 位小写 hex | 全局唯一，永不复用；生成后不改 |
| 标题 | 是 | ≤40 字符 | 一行说清 |
| 来源 | 是 | 原话 / 总结 / 判断 / 工具 | 可信度标记，不是分类 |
| 状态 | 是 | 正常 / 已归档 / 已作废 | 归档/作废都不删行 |
| 重要度 | 是 | ★1–4 | 单条分量 |
| 项目 | 否 | 项目名 / 全局 | 多项目用英文逗号 |
| 关键词 | 否 | 逗号分隔 | 检索加分；可留空 |
| 写入 | 是 | ISO 8601 | 创建时间 |
| 更新 | 是 | ISO 8601 | 最后改正文/元数据的时间 |
| 钉住 | 否 | 是 / 否 | 保底规矩优先选它；默认否 |
| 原话已改 | 否 | 是 | 仅历史数据保留；新原话不再产生此字段 |
| 其他 | 否 | 任意 | 未知 `- 键：值` 行保留并原样写回 |

### 3.4 来源取值

- **原话**：主人原话，**正文和来源锁死只读**；要更正就作废旧条、新建一条。历史 `原话已改：是` 只作为警告保留。
- **总结**：我把一段内容压缩后的总结。
- **判断**：我的推断、认识、评价。
- **工具**：工具输出、命令结果、文件内容。

### 3.5 状态取值

- **正常**：参与检索。
- **已归档**：不参与默认检索；面板可筛出、可恢复。
- **已作废**：主人判定无效；不参与检索；不物理删除。

### 3.6 冷暖

- 不写入文件；由 `_stats.json` 的 `last_touched_at` 计算。
- 冷区阈值来自 `_settings.json` 的 `coldDays`，默认 14。
- 热/冷只影响检索权重（热 1.0 / 冷 0.7），不影响文件内容和位置。

### 3.7 解析容错

- 只把匹配 `^## \[([0-9a-f]{8})\] (.+)$` 的行当条目起点。
- 元数据行必须在正文第一个非空行之前；正文开始后不再解析元数据。
- 未知元数据键值对保留在 `extra`，序列化时按原顺序写回，避免手写字段被吞。
- 缺少必填字段：该条目进入“损坏条目”列表，面板可见；不参与检索；不自动删除。
- 重复 id：后出现的标记为冲突，面板可见；不参与检索。
- 正文中的 `## ` 视为格式错误，解析时归入上一条正文并记警告；序列化不主动改写。

---

## 4. `_stats.json`

```json
{
  "version": 1,
  "entries": {
    "a1b2c3d4": {
      "hits": 3,
      "views": 1,
      "last_touched_at": "2026-11-02T15:20:00+08:00"
    }
  }
}
```

- `hits`：被自动检索注入的次数。
- `views`：面板打开详情的次数。
- `uses`：面板显示“用过几次” = hits + views（计算值，不存）。
- `last_touched_at`：命中、打开、编辑三者取最新。
- 缺失条目按 `hits=0, views=0, last_touched_at=写入时间` 处理。
- 写入统计失败：记事件；健康灯不因此转红（正文没坏），但要能看到黄色提示。

---

## 5. `_weights.json`

```json
{
  "version": 1,
  "levels": {
    "ignore": 0,
    "low": 0.5,
    "normal": 1.0,
    "high": 1.5,
    "max": 2.0
  },
  "importanceFactors": {
    "1": 0.8,
    "2": 1.0,
    "3": 1.25,
    "4": 1.5
  },
  "coldFactor": 0.7,
  "matrix": {
    "rules":    { "work": "max",    "mixed": "high",   "companion": "normal" },
    "facts":    { "work": "high",   "mixed": "normal", "companion": "low" },
    "pitfalls": { "work": "high",   "mixed": "normal", "companion": "low" },
    "progress": { "work": "normal", "mixed": "normal", "companion": "low" },
    "persona":  { "work": "low",    "mixed": "normal", "companion": "max" }
  }
}
```

- 分类键：`rules` / `facts` / `pitfalls` / `progress` / `persona`。
- 模式键：`work` / `mixed` / `companion`。
- 非法档位、缺列：按默认值补齐，并记警告；不阻塞启动。
- 面板改一格，立即写回本文件并记审计。

---

## 6. `_settings.json`

```json
{
  "version": 1,
  "coldDays": 14,
  "mode": {
    "default": "auto",
    "locked": false,
    "fallback": "mixed"
  },
  "retrieval": {
    "topK": 3,
    "budgetChars": 1000,
    "minCoverage": 0.2,
    "minCovHard": 0.4,
    "relBar": 0.62,
    "minScore": 9,
    "manualTopK": 50,
    "baseline": {
      "enabled": true,
      "maxItems": 1,
      "maxChars": 300,
      "category": "rules",
      "modes": ["work", "mixed"]
    }
  },
  "health": {
    "windowTurns": 30,
    "yellowConsecutiveMiss": 10,
    "yellowRate": 0.1,
    "redWriteHours": 24,
    "yellowNoWriteTurns": 30,
    "yellowNoWriteHours": 24
  },
  "consolidation": {
    "enabled": true,
    "everyTurns": 25,
    "maxEntries": 5,
    "maxChars": 1200,
    "merge": true,
    "regexHints": true,
    "retry": 1,
    "scope": {
      "currentProject": true,
      "mentionedProjects": true,
      "modifiedProjects": true,
      "global": false
    }
  },
  "deepDive": {
    "enabled": false
  }
}
```

- `mode.default`：`auto` / `work` / `mixed` / `companion`。
- `mode.locked`：手动锁定；true 时自动分类不生效。
- `fallback`：自动分类置信度太低时用的模式。
- `retrieval.baseline`：保底规矩；每轮固定 1 条，绕过相关度门槛。
- `health.yellowNoWrite*`：有库但长时间没写入的黄灯阈值。
- `consolidation.*`：整理开关、轮数、条数上限、范围；手动和自动共用。
- 缺字段按默认补齐；不因配置缺失启动失败。

---

## 6.5 `_consolidation.json`

按会话记录整理游标和上次结果：

```json
{
  "version": 1,
  "sessions": {
    "session-ab54c648": {
      "lastTurn": 50,
      "lastOkTurn": 50,
      "lastAt": "2026-11-02T18:30:00+08:00",
      "lastResult": {"ok": true, "wrote": 2, "merged": 1, "skipped": 0}
    }
  }
}
```

- `lastTurn`：上次尝试整理的轮次；失败也推进，避免每轮重试。
- `lastOkTurn`：上次成功整理的轮次。
- 只保留最近 200 个会话。
- 不进快照之外；快照会复制这个文件。

---

## 7. 审计 `_audit/edits.jsonl`

每行一个 JSON：

```json
{"ts":"2026-11-02T15:21:00+08:00","actor":"主人","action":"update","item_id":"a1b2c3d4","category":"rules","field":"content","before":"旧正文","after":"新正文","note":"压缩表述"}
```

字段：

| 字段 | 值 |
|---|---|
| ts | ISO 8601 |
| actor | 主人 / 小喵 / 系统 / 文件 |
| action | create / update / archive / revoke / restore / weights / mode / consolidation |
| item_id | 条目 id；权重修改为 null |
| category | rules/facts/pitfalls/progress/persona；权重修改为 null |
| field | content/title/source/importance/project/keywords/status/weights.rules.work 等 |
| before | 改前值（长文本截断到 2000 字，完整旧文靠快照） |
| after | 改后值 |
| note | 备注 |

- 追加写；不修改历史行。
- 直接手改文件：插件无法可靠知道是谁改的，不冒充实名审计；写入前发现 mtime 变了会中止并提示刷新。要留“谁改的”请走面板或工具。
- 审计文件损坏不影响记忆正文；面板提示。

---

## 8. 事件 `_logs/events.jsonl`

每行一个 JSON。至少包含以下类型。

### turn（每轮检索）

```json
{
  "ts": "2026-11-02T15:22:00+08:00",
  "type": "turn",
  "sid": "ab54c648",
  "mode": "work",
  "modeSource": "auto",
  "query": "如果不行，就帮我把反代模型弄进去",
  "candidates": 12,
  "passed": 2,
  "picked": [
    {"id":"a1b2c3d4","category":"rules","base":0.72,"categoryWeight":2.0,"importance":1.25,"zone":1.0,"project":1.0,"score":1.80,"reason":"title+kw"}
  ],
  "missReason": null,
  "nearMiss": [],
  "ms": 3
}
```

### write

```json
{"ts":"...","type":"write","ok":true,"id":"a1b2c3d4","category":"rules","actor":"小喵","error":null}
```

### 其他

- `view`：面板打开条目。
- `manual-search`：手动搜索（不影响 30 轮健康统计）。
- `cold_sweep`：每日冷暖扫描（新沉入/回热 id）。
- `edit`：修改条目。
- `archive` / `revoke` / `restore`。
- `snapshot` / `rollback`。
- `cold_sweep`：本轮新沉入冷区的 id 列表、总数。
- `health`：健康灯状态变化。
- `consolidate`：整理结果；字段 `trigger`（manual/auto）、`fromTurn`、`toTurn`、`scope`、`wrote`、`merged`、`skipped`、`ok`、`error`、`model`、`ms`。

事件文件按 10 MB 轮转一次；第一版不做自动清理，面板可显示大小并手动归档。

---

## 9. 快照

目录：

```
_snapshots/
  20261102-153000/
    work/*.md
    persona/*.md
    _stats.json
    _weights.json
    _settings.json
    _consolidation.json
    _audit/
    _logs/
```

- 快照名：`YYYYMMDD-HHmmss`。
- 创建：复制数据目录（排除 `_snapshots`）。
- 回滚：
  1. 先创建 `pre-rollback-YYYYMMDD-HHmmss` 安全快照；
  2. 用目标快照覆盖 `work/`、`persona/` 和边车；
  3. 记 `rollback` 事件与审计；
  4. 保留目标快照，不删。
- 不自动删除快照。

---

## 10. 写入与并发

- 每次改分类文件：写同目录临时文件 → `fsync`（能则做）→ `rename` 覆盖。
- 单进程内串行化写入；面板和模型同时写时排队。
- 写前检查文件 mtime：
  - 与上次读取一致 → 正常写；
  - 已被外部修改 → 中止，返回“文件已被外部修改，请刷新后重试”，不覆盖。
- 不做跨请求缓存；每次检索/面板请求按 5 个文件重建内存索引。
- 解析失败：保留原文件，不写回；面板显示损坏条目；健康灯红（读不了/解析不了）。
- 任何写失败：记 `write` 事件 `ok=false`，健康灯红。

---

## 11. 样例

`test/fixtures/sample/` 是格式样例，仅供测试；正式数据目录不会读取它，也不会预置任何记忆。
