# lib/panel

面板 JSON 接口层。只做参数校验、调 core、返回统一 JSON。

## 统一返回

```json
{"ok": true, "data": {}, "error": null}
```

## 路由（前缀 `/workmem/panel`）

- `GET /stats`
- `GET /sessions?limit=`
- `GET /list?category=&status=&cold=&project=&source=&q=&limit=`
- `GET /search?q=&limit=&status=`
- `GET /detail?id=`
- `GET /timeline?limit=`
- `GET /diagnostics?limit=`
- `GET /weights`
- `GET /snapshots`
- `GET /health`
- `GET /consolidation`
- `GET /mode`（固定返回单一读法）
- `POST /write`
- `POST /archive`
- `POST /revoke`
- `POST /restore`
- `POST /weights`
- `POST /mode`（兼容保留，忽略入参，不写 settings、不记审计）
- `POST /consolidation`
- `POST /consolidate`
- `POST /snapshot`
- `POST /rollback`

## 约束

- 不直接拼 Markdown、不直接写文件；全部走 `lib/core/store`。
- 面板手写/编辑视为手动写入，放行写入策略。
- 权重修改记审计，字段是 `weights.<分类>`；`/mode` 不再改任何东西。
- 回滚必须二次确认 + 先拍安全快照。
