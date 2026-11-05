# 机忆（workmem）

面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) 的本地记忆插件。**只做工作记忆**：4 个分类文件，全部本地运行；检索零模型调用，整理按轮次或手动调用当前对话模型。

> 2026-11-05 起面板并入 DSH 原生面板，显示名改为「机忆」，模式只保留工作模式。插件包名 / 内部 id 仍是 `workmem`，数据目录不动。

## 是什么

四条分类，各一个文件：

| 分类 | 文件 | 装什么 |
|---|---|---|
| 规矩 | `work/rules.md` | 必须一直守的 |
| 事实 | `work/facts.md` | 环境、路径、端口、结论 |
| 坑 | `work/pitfalls.md` | 踩过一次别再踩的 |
| 进度 | `work/progress.md` | 一条线做到哪了 |

没有"人设"分类，也没有陪人/混合读法。记忆只为一件事服务：让下一轮干活少问一遍、少踩一次。

## 面板

左侧栏点「机忆」图标，在中央面板区打开。**是 DSH 原生面板**，不是 iframe：跟随宿主主题明暗、跟随宿主字号、跟随宿主 locale，用的全是 `--dsw-alias-*` token。

四个页签：

- **条目**：搜索、分类 chip、状态/冷暖/对话筛选；右侧滑出详情与编辑（原话正文只读）；新建。
- **权重**：4 个分类各一档（忽略/低/正常/高/最高），改完立即生效。
- **自检**：最近 30 轮的问句、命中与否、未命中原因、差一点命中、耗时。
- **整理**：自动整理开关与轮次、立即整理、目录快照与回滚、事件时间轴。

同源 JSON 接口在 `/workmem/panel/*`，面板和外部脚本都用它；`/workmem/panel/` 那个 HTML 现在只是一张说明页，界面不再由它渲染。

独立起接口服务（不装 DSH 也能用）：

```bash
node start-panel.mjs        # 默认 http://127.0.0.1:8795，只绑本机
node start-panel.mjs 9000   # 换端口
```

## 安装

1. 把本仓库放到 DSH 的 profile 里（软链或直接复制都行）：

   ```bash
   # 例：Linux / macOS
   git clone https://github.com/mengyuruxing/workmem.git \
     ~/.dsh/profiles/desktop/node_modules/workmem
   ```

   Windows 可以直接用 `mklink /J` 建目录联接，或者把仓库放任意位置后在 profile 里写 `"workmem": "link:<绝对路径>"`。

2. 在 profile 的 `package.json` 依赖里加上 `workmem`。
3. 重启 DSH。插件通过自带的 `cordis.patch.yml` 挂进宿主，不需要改 `cordis.yml`。

## 已定的基础

- **一个分类一个文件**：不是每条记忆一个文件，也不是单文件数据库。
- **只有工作模式**：`MODES = ['work']`。老数据里的 `mixed` / `companion` 列在读取时被静默丢弃，不需要迁移脚本。
- **权重矩阵**：4 个分类 × 1 列，每格五档（忽略/低/正常/高/最高），面板可视化、可点选。
- **单条重要度**：★1–4，叠加在分类权重之上。
- **来源是标记不是分类**：原话 / 总结 / 判断 / 工具；**原话正文锁死只读**，要更正就作废新建。
- **冷暖是状态**：14 天没被碰过进冷区；不移动、不删除，命中即回热。
- **只归档不删除**：归档、作废都保留原文，永远能翻回。
- **低成本**：检索、遗忘、自检全靠本地代码；整理手动或每 25 轮调用一次当前对话模型；深挖默认关。

## 已实现

- 4 个分类文件的解析、序列化、原子写入、外部修改冲突检测。
- 本地分词、IDF、门槛、分类权重、冷热、手动搜索。
- 新建/编辑/合并/归档/作废/恢复、审计、统计、事件。
- 目录快照、回滚、回滚前安全快照。
- 健康灯、30 轮小字、无写入黄灯、写入策略、注入渲染。
- 规矩保底：每轮 1 条，pinned 优先；注入总预算 1000 字。
- 整理：手动立即 / 每 25 轮自动；当前对话模型输出 JSON，脚本校验/合并/落盘。
- DSH 原生面板（`sidebar.panellist` + `main` 槽）：条目、权重、自检、整理四页。
- DSH 适配层：pre-step 注入、7 个工具、`/workmem/panel` 路由。

## 工具

`workmem_write` / `workmem_read` / `workmem_search` / `workmem_update` / `workmem_archive` / `workmem_revoke` / `workmem_snapshot`。

原先的 `workmem_mode_set` 已删除——只有一种读法，没有可切的东西。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | 需求定稿：分类、权重、面板、写入、检索、遗忘、自检、管理 |
| [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) | 目录结构、Markdown 条目格式、JSON 边车、审计与事件格式 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层、数据流、检索算法、写入策略、健康灯、面板接口 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 分阶段实施、验收清单、风险 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 关键决策与已否决方案 |

## 目录

```
workmem/
  docs/                 方案与格式文档
  lib/core/             纯逻辑：解析、索引、检索、权重、健康、策略
  lib/dsh/              DSH 宿主适配层
  lib/panel/            面板 JSON 接口
  panel/                接口说明页（界面已迁到 client.js）
  client.js             DSH 原生面板（React，注册 sidebar.panellist + main）
  locale/               面板显示名与描述（zh / en）
  icon.svg              插件图标
  test/                 node:test 测试
  test/fixtures/sample/  测试夹具，锁定格式；不会进正式数据目录
```

## 数据位置

默认 `~/.workmem`；DSH 插件里用 `WORKMEM_HOME`，没设就用 `E:/aiwork/data/workmem`。数据目录与代码目录分开：升级、重装插件都不会碰你的记忆。

## 测试

```bash
npm test        # node --test，107 项
```

## 许可

MIT · Copyright (c) 2026 MOLULISHANGPOLU
