# workmem · 工作记忆

面向 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai) 的本地记忆插件。**工作优先，人设另开**：只保留 5 个分类文件，全部本地运行；检索零模型调用，整理按轮次或手动调用当前对话模型。

> 状态：可用版本。核心、面板、DSH 适配层已完成，98 项测试全过，已在作者日常使用中跑着。

## 为什么是"工作优先"

大多数记忆插件把"你今天心情不好"和"这个路径不能写 C 盘"混在一个池子里。workmem 把它们分开：

- **工作记忆 4 类**：规矩、事实、坑、进度。会被高频检索、按重要性注入。
- **人设单独 1 份**：`persona/persona.md`，干活模式默认低权重，不和工作记忆混在一起。

## 安装

1. 把本仓库放到 DSH 的 profile 里（软链或直接复制都行）：

   ```bash
   # 例：Linux / macOS
   git clone https://github.com/mengyuruxing/workmem.git \
     ~/.dsh/profiles/desktop/node_modules/workmem
   ```

   Windows 可以直接用 `mklink /J` 建目录联接，或者把仓库放任意位置后在 profile 的 `package.json` 里写 `"workmem": "link:<绝对路径>"`。

2. 在 profile 的 `package.json` 依赖里加上 `workmem`。
3. 重启 DSH。插件通过自带的 `cordis.patch.yml` 挂进宿主，不需要改 `cordis.yml`。

## 面板

插件自带一个本地面板，独立于 DSH 也能起：

```bash
node start-panel.mjs        # 默认 http://127.0.0.1:8795，只绑本机
node start-panel.mjs 9000   # 换端口
```

Windows 上可以复制 `start-panel.example.vbs` 成 `start-panel.vbs` 双击，无窗口启动。

面板能干的：模式切换（干活/混合/陪人）、健康灯、5×3 权重矩阵点选、分类筛选、搜索、详情编辑（原话正文只读）、时间轴、自检表、目录快照与回滚、整理卡片。

## 已定的基础

- **一个分类一个文件**：不是每条记忆一个文件，也不是单文件数据库。
- **三种模式**：干活 / 混合 / 陪人；按钮切换，不做比例滑杆。
- **权重矩阵**：5 个文件 × 3 种模式，每格五档（忽略/低/正常/高/最高），面板可视化、可点选调整。
- **单条重要度**：★1–4，叠加在分类权重之上。
- **来源是标记不是分类**：原话 / 总结 / 判断 / 工具；**原话正文锁死只读**，要更正就作废新建。
- **冷暖是状态**：14 天没被碰过进冷区；不移动、不删除，命中即回热。
- **只归档不删除**：归档、作废都保留原文，永远能翻回。
- **低成本**：检索、遗忘、自检全靠本地代码；整理手动或每 25 轮调用一次当前对话模型；深挖默认关。

## 已实现

- 5 个分类文件的解析、序列化、原子写入、外部修改冲突检测。
- 本地分词、IDF、门槛、分类权重、冷热、手动搜索。
- 新建/编辑/合并/归档/作废/恢复、审计、统计、事件。
- 目录快照、回滚、回滚前安全快照。
- 健康灯、30 轮小字、无写入黄灯、模式自动判断、手动锁、写入策略、注入渲染。
- 规矩保底：每轮 1 条，pinned 优先；注入总预算 1000 字。
- 整理：手动立即 / 每 25 轮自动；当前对话模型输出 JSON，脚本校验/合并/落盘。
- 面板：模式按钮、健康灯、5×3 权重矩阵、筛选、搜索、详情编辑（原话只读）、时间轴、自检表、快照、整理卡片。
- DSH 适配层：pre-step 注入、8 个工具、面板路由、悬浮入口。

## 文档

| 文档 | 内容 |
|---|---|
| [docs/SPEC.md](docs/SPEC.md) | 需求定稿：分类、模式、权重、面板、写入、检索、遗忘、自检、管理 |
| [docs/DATA-FORMAT.md](docs/DATA-FORMAT.md) | 目录结构、Markdown 条目格式、JSON 边车、审计与事件格式 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 分层、数据流、检索算法、模式分类、写入策略、健康灯、面板接口 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 分阶段实施、验收清单、风险 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 关键决策与已否决方案 |

## 目录

```
workmem/
  docs/                 方案与格式文档
  lib/core/             纯逻辑：解析、索引、检索、权重、健康、策略
  lib/dsh/              DSH 宿主适配层
  lib/panel/            面板 JSON 接口
  panel/                面板前端
  test/                 node:test 测试
  test/fixtures/sample/  测试夹具，锁定格式；不会进正式数据目录
```

## 数据位置

默认 `~/.workmem`，可用环境变量 `WORKMEM_ROOT` 覆盖。数据目录与代码目录分开：升级、重装插件都不会碰你的记忆。

## 测试

```bash
npm test        # node --test，98 项
```

## 许可

MIT · Copyright (c) 2026 MOLULISHANGPOLU
