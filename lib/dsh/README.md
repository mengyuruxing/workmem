# lib/dsh

DSH 宿主适配层。只做协议转换，不写业务规则。

## 职责

- 在 `agent/pre-step` 取最后一条可用 user 消息，调 core 检索，把注入块作为插件快照消息插在用户消息前；不改写用户原文。
- 注册 7 个工具：`workmem_write`、`workmem_read`、`workmem_search`、`workmem_update`、`workmem_archive`、`workmem_revoke`、`workmem_snapshot`。`workmem_mode_set` 已删除（只有一种读法）。
- 注册 `/workmem/panel` 前缀路由，每个请求先过 `lib/panel/guard.mjs` 的跨来源检查与 1 MiB 请求体上限。
- 面板界面不在这里：它由 `client.js` 注册进 `sidebar.panellist` 与 `main` 两个槽。
- 子会话（subagent）默认不注入、不写入。
- 任何异常 fail-open：原样返回对话，只记事件。

## 约束

- 不在这里判断告诉/跑腿/闲聊；调 `policy.mjs`。
- 不在这里拼 Markdown；调 `entry.mjs`/`store.mjs`。
- 不直接读写数据目录；走 `store`。
- 重启 DSH 才生效的改动，先征求主人同意。
