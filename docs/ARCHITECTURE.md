# workmem 架构

本文档定实现边界：谁负责什么、数据怎么流、算法怎么算、出错怎么办。

---

## 1. 分层

```
DSH 宿主
  └─ lib/dsh/          适配层：pre-step 注入、工具注册、面板挂载、重启后加载
       ├─ consolidation.mjs  整理运行时：turn/end 自动、面板手动、当前对话模型
       ├─ lib/panel/   面板 JSON 接口（本机同源）
       └─ lib/core/    纯逻辑，不依赖 DSH，可单独测试
            ├─ entry.mjs       Markdown 条目解析/序列化
            ├─ store.mjs       读取、原子写入、mtime 冲突检测
            ├─ stats.mjs       _stats.json 读写
            ├─ weights.mjs     _weights.json、档位、默认值
            ├─ settings.mjs    _settings.json
            ├─ index.mjs       内存索引（每次加载重建）
            ├─ search.mjs      分词、IDF、打分、门槛、手动搜索
            ├─ mutations.mjs   新建/编辑/合并/归档/作废/恢复
            ├─ mode.mjs        三模式、自动分类、手动锁
            ├─ policy.mjs      告诉/跑腿/闲聊判断、写入放行/拒绝
            ├─ health.mjs      健康灯、30 轮统计
            ├─ lifecycle.mjs   冷暖计算、每日冷区扫描
            ├─ events.mjs      events.jsonl 追加与读取
            ├─ audit.mjs       edits.jsonl 追加
            ├─ inject.mjs      注入块渲染（含保底规矩）
            ├─ consolidate.mjs 整理范围/材料/校验/落盘
            ├─ view.mjs        面板视图与自检数据
            └─ snapshot.mjs    目录快照、回滚、安全快照
```

原则：

- `lib/core` 不 import DSH、不读环境变量、不碰网络；路径和数据由调用方传入。
- `lib/dsh` 只做协议转换，不写业务规则。
- 面板接口只调用 `lib/core` 和 `lib/panel`，不直接拼 Markdown。

---

## 2. 数据流

### 2.1 每轮检索

```
用户消息
  → dsh 适配层取最后一条可用 user 消息
  → mode：手动锁 / AI 覆盖 / 本地分类
  → index：每次加载 5 个文件建索引
  → search：分词、IDF、打分、门槛
  → 权重：相关分 × 分类权重 × 单条重要度 × 冷热 × 项目
  → 取 topK，拼注入块（带 id/分类/来源）
  → 插在用户消息前，作为插件快照消息
  → 写 turn 事件
  → 更新命中条目的 stats（hits + last_touched_at）
```

失败策略：**fail-open**。检索或注入失败时原样返回用户消息，只记事件；不阻塞对话。

### 2.2 写入

```
memory_write(...)
  → policy：本轮告诉/跑腿/闲聊 + 是否明说“记一下”
  → 校验分类、来源、必填字段、敏感信息
  → 同分类相似度 ≥0.8 合并，否则新建
  → store：mtime 检查 → 临时文件 → rename
  → audit：改前/改后
  → event：write ok/fail
  → health 红灯条件
```

### 2.3 面板读取

```
面板 → /panel/list|search|detail|timeline|diagnostics|stats
  → core 读文件 + stats + events
  → 返回 JSON（含分类权重、冷热、命中数、审计）
```

面板写入走同一套 `store`，不绕过 mtime 检查和审计。

---

## 3. 检索算法

### 3.1 分词

1. 文本 NFKC 归一化、转小写。
2. 中文：连续汉字滑窗取二字词（bigram）；去掉虚词/停用词；单字只在非停用字时保留。
3. 英文/数字：整词。
4. 标点、空白：跳过。

标签/关键词命中的 token 额外加 0.8 倍 IDF 质量；正文命中只计基础质量。

### 3.2 索引

- 每个条目：id、分类、标题 token 集、关键词 token 集、正文 token 集、完整字串 runs。
- IDF 在全库 active 条目上计算。
- 每次 `loadSearchContext` 重建索引；5 个文件规模下开销可接受，没有跨请求缓存。

### 3.3 相关分

- 命中 token 的 IDF 质量之和。
- 标题/关键词命中额外加分。
- 连续 4 字以上整串撞上，额外加分。
- 覆盖率 = 命中 token 质量 / 查询 token 总质量。
- 输出：`base`、`coverage`、`hitTokens`、`reason`（title/kw/run/body）。

### 3.4 门槛

默认值，写入 `_settings.json`：

- `minCoverage = 0.20`
- `minCovHard = 0.40`（只在正文蹭到、标题/关键词都没压住时用）
- `relBar = 0.62`（低于榜首的 62% 不要）
- `minScore = 9`，按库大小缩放
- 最多 `topK = 3`，总字数预算 1000
- 保底规矩：每轮固定 1 条 `rules`，绕过门槛，最多 300 字；不增加命中统计

只在前述相关分上做门槛；权重在这之后才参与排序。

### 3.5 权重

```
final = base × categoryWeight × importanceFactor × zoneFactor × projectFactor
```

- `categoryWeight`：`_weights.json` 当前模式列；0 直接过滤。
- `importanceFactor`：★1 0.8 / ★2 1.0 / ★3 1.25 / ★4 1.5。
- `zoneFactor`：热 1.0 / 冷 0.7。
- `projectFactor`：匹配 1.1 / 不匹配 0.9 / 全局 1.0。
- 排序后按 `topK` 和字数预算截断。

### 3.6 手动搜索

- 同一分词、IDF、base 分、项目系数。
- 关闭门槛（coverage/relBar/minScore 全部不拦），按 `final` 排序，取前 50。
- 返回每条因子拆解，面板显示“为什么排这里”。

### 3.7 去重

- 同一会话最近 6 轮已注入过的 id 不重复注入。
- 跨会话不按 id 去重。

---

## 4. 模式

### 4.1 三档

- `work` 干活：矩阵第 1 列。
- `mixed` 混合：第 2 列。
- `companion` 陪人：第 3 列。

### 4.2 自动判断

本地打分，不调模型：

- 干活信号：命令动词（帮我/去/跑/装/改/查/修/部署/生成）、路径、端口、命令、报错、截止时间。
- 陪人信号：在吗/陪我/聊聊/无聊/难过/开心/晚安、情绪词、短寒暄。
- 分数差 + 置信度；置信度低 → 保持上一轮或 `fallback`。
- 平滑：新结果与当前模式不同时，需要连续两轮同向才切换，避免抖动。
- 每个会话独立记录当前模式与来源。

### 4.3 覆盖优先级

1. 面板手动锁（`mode.locked=true`）。
2. AI 工具 `memory_mode_set`（本会话有效）。
3. 本地自动分类。

面板显示：当前模式 + 来源（手动/自动/AI）+ 本模式分类顺序。

### 4.4 扩展

以后加状态 = 在 `_weights.json` 加一列 + 面板矩阵加一列；分类和文件不动。

---

## 5. 写入策略

### 5.1 轮次判断

- `tell`：主人在陈述、纠正、定规矩、说决定/处境。
- `task`：主人在布置动作、要求执行、让工具干活。
- `chat`：寒暄、闲聊、情绪。
- 置信度低 → 按 `chat` 处理（不拦正常写入）。

### 5.2 放行规则

| 轮次 | 自动写入（模型工具） | 手动/面板 | 明说“记一下” |
|---|---|---|---|
| tell | 四类都按内容放行 | 放行 | 放行 |
| chat | 正常放行 | 放行 | 放行 |
| task | **只放行“坑”** | 放行 | 放行 |

- 跑腿轮写非“坑”：`memory_write` 返回失败，`error=task_turn_only_pitfall`，提示“本轮只记踩到的坑；要记别的请主人明说或面板手写”。
- 不静默丢弃：拒绝也要留事件。
- 正常内容写入不受影响：策略只管跑腿轮的自动写入，不封工具、不改其他轮。

### 5.3 内容校验

- 分类必须是 5 个之一。
- 来源必须是 4 个之一。
- 标题非空、正文非空。
- 敏感信息（密码/密钥/token 形态）拒绝并提示。
- 同分类、同项目相似度 ≥0.8 合并；原话近似不合并；作废条目不复活。

---

## 6. 健康灯

数据来源：`_logs/events.jsonl` 最近 30 条 `turn` + 最近 24 小时 `write` 失败 + 文件可读性。

```
读取最近 30 轮：
  hits = picked.length > 0 的轮数
  consecutiveMiss = 从尾部往前数，连续 picked=0 的轮数

红：
  24 小时内 write ok=false
  或 任一记忆文件读不了/解析不了
黄：
  consecutiveMiss >= 10
  或 最近 30 轮 hits/30 < 0.10（至少 10 轮才判断）
  或 有库但最近 30 轮没有写入 / 超过 24 小时没有写入
  或 全库 0 条
  或 还没有 turn 事件
绿：
  其余
```

小字：`近30轮命中 X 次（Y%）· 写入 Z 条 · 最近写入 N 轮前/无 · 最近命中 M 轮前`。

- 健康状态变化写 `health` 事件。
- 统计文件写失败：黄灯提示“命中计数写不进去”，不算红灯（正文没坏）。
- 红灯点击进入自检页，显示具体失败原因和最近 30 轮表。

---

## 6.5 整理

- 触发：手动 `POST /consolidate`；自动 `turn/end` 且距上次尝试 ≥ 25 轮。
- 范围：当前对话增量 + 当前项目 + 对话提到/本会话写过的项目；全局默认不进。
- 脚本：`consolidate.mjs` 收集增量、正则候选提示、找相似旧条、校验 JSON、落盘；不做语义判断。
- 模型：`lib/dsh/consolidation.mjs` 调当前对话模型，要求输出 JSON 动作；失败重试一次，仍失败记 `consolidate` 失败。
- 原话：`source=quote` 必须是用户原文子串；否则校验失败。
- 合并：同分类/来源/项目/非原话；否则拒绝。
- 游标：`_consolidation.json`，失败也推进 `lastTurn`，避免每轮重试。

---

## 7. 面板接口

本机同源，由宿主提供；不对外监听。路由前缀 `/workmem/panel`。

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/stats` | 条数、冷热、健康、30 轮小字、当前模式 |
| GET | `/list?category=&status=&cold=&project=&source=` | 列表 |
| GET | `/search?q=` | 手动搜索（无门槛，前 50） |
| GET | `/detail?id=` | 条目详情 + 审计 + 当前权重 |
| GET | `/timeline?limit=` | 时间轴 |
| GET | `/diagnostics?limit=` | 自检：最近 30 轮、命中因子、未命中原因、差一点命中 |
| GET | `/weights` | 矩阵与档位 |
| GET | `/snapshots` | 快照列表 |
| POST | `/write` | 新建/编辑（面板手动，放行） |
| POST | `/archive` | 归档 |
| POST | `/revoke` | 作废 |
| POST | `/restore` | 恢复 |
| POST | `/weights` | 改一格/恢复默认 |
| POST | `/mode` | 手动锁/解锁/切模式 |
| POST | `/snapshot` | 一键快照 |
| POST | `/rollback` | 回滚（二次确认 + 安全快照） |

返回统一：

```json
{"ok": true, "data": {}, "error": null}
```

失败时 `ok=false`，`error` 给人类可读原因；面板直接显示。

---

## 8. DSH 适配层

只做协议转换：

- `agent/pre-step`：取最后一条可用 user 消息 → 调 core → 把注入块作为插件快照消息插在用户消息前；不改写用户原文；失败原样返回。
- 工具：`memory_write`、`memory_read`、`memory_search`、`memory_update`、`memory_archive`、`memory_revoke`、`memory_snapshot`、`memory_mode_set`。
- 面板：注册启动入口/侧边栏 tab，加载 `panel/`。
- 子会话（subagent）默认不注入、不写入。
- 重启 DSH 才生效的改动，先征求主人同意。

---

## 9. 错误处理

| 场景 | 行为 |
|---|---|
| 检索异常 | fail-open，原样对话；记 turn.missReason=error |
| 注入异常 | 同上 |
| 写入失败 | 返回错误；记 write ok=false；红灯 |
| 文件被外部改 | 中止写入，提示刷新；不覆盖 |
| 解析失败 | 保留原文件；损坏条目面板可见；红灯 |
| stats 写失败 | 记事件；黄灯提示；不影响正文 |
| 快照失败 | 记事件；黄灯；不影响现有数据 |
| 回滚失败 | 保留安全快照；报错；不删任何快照 |
| 配置缺失 | 用默认值补齐；不阻塞启动 |

---

## 10. 性能与容量

- 5 个文件、几千条以内：启动/变更时全量解析，内存索引，O(N) 打分，足够快。
- 单分类文件 >5 MB 或单条 >20 KB：面板提示；第一版不自动拆分。
- 每次写入重写一个分类文件；几千条文本量很小。
- 快照复制 5 个文件 + 边车；目录小，秒级完成。
- 不做数据库、不做向量索引；以后规模真的变大再考虑，不在第一版。

---

## 11. 安全与隐私

- 不主动上传记忆、不外发；检索/分词/健康/快照无外部请求；整理只走当前对话模型。
- 数据目录只在本机；建议放在用户目录或受控盘符。
- 不存密码、密钥、token；写入前做形态检查。
- 面板接口不对外监听；只由宿主同源提供。
- 快照包含全部记忆和审计，按同样敏感级别保护。
