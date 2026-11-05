# panel

`/workmem/panel/*` 的说明与静态兜底。界面已经不在这一层——它由 `client.js` 在 DSH 原生面板槽里用 React 渲染。

## 这里还剩什么

- `index.html`：一张说明页，告诉人界面搬哪去了、接口有哪些。访问 `/workmem/panel/` 时返回它。
- 后端 JSON 接口在 `../lib/panel/api.mjs`，路由挂在宿主 webServer 的 `/workmem/panel` 前缀上。

## 接口

| 路径 | 方法 | 用途 |
|---|---|---|
| `/stats` | GET | 概览、健康灯、分类计数、模式（固定 work） |
| `/sessions` | GET | 按对话聚合 |
| `/list` | GET | 条目列表，支持 category/status/cold/project/q |
| `/search` | GET | 手动搜索，带因子拆解 |
| `/detail` | GET | 单条详情 + 审计（会 bump 使用次数） |
| `/timeline` | GET | 审计与事件的合并时间轴 |
| `/diagnostics` | GET | 最近 N 轮检索诊断 |
| `/weights` | GET / POST | 读 / 改分类权重（只有 work 一列） |
| `/snapshots` | GET | 快照列表 |
| `/health` | GET | 健康灯 |
| `/consolidation` | GET / POST | 整理设置 |
| `/consolidate` | POST | 立即整理 |
| `/mode` | GET / POST | 恒返回 work；保留只为老客户端不 404 |
| `/write` | POST | 新建或编辑 |
| `/archive` `/revoke` `/restore` | POST | 改状态 |
| `/snapshot` `/rollback` | POST | 拍快照 / 回滚 |

## 约束

- 所有请求同源，走 `/workmem/panel/*`，不直接读本地文件。
- 跨来源请求由 `lib/panel/guard.mjs` 挡掉；请求体上限 1 MiB。
- 页面不再引外部 CDN、不再自带主题切换——明暗跟随宿主。
