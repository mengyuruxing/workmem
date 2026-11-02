# lib/dsh

DSH 宿主适配层。只做协议转换，不写业务规则。

## 职责

- 在 `agent/pre-step` 取最后一条可用 user 消息，调 core 检索，把注入块作为插件快照消息插在用户消息前；不改写用户原文。
- 注册工具：`memory_write`、`memory_read`、`memory_search`、`memory_update`、`memory_archive`、`memory_revoke`、`memory_snapshot`、`memory_mode_set`。
- 注册面板入口/侧边栏 tab。
- 子会话（subagent）默认不注入、不写入。
- 任何异常 fail-open：原样返回对话，只记事件。

## 约束

- 不在这里判断告诉/跑腿/闲聊；调 `policy.mjs`。
- 不在这里拼 Markdown；调 `entry.mjs`/`store.mjs`。
- 不直接读写数据目录；走 `store`。
- 重启 DSH 才生效的改动，先征求主人同意。
