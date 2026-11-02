# lib/panel

面板 JSON 接口层。只做参数校验、调 core、返回统一 JSON。

## 统一返回

```json
{"ok": true, "data": {}, "error": null}
```

## 路由（前缀 `/workmem/panel`）

- `GET /stats`
- `GET /list?category=&status=&cold=&project=&source=`
- `GET /search?q=`
- `GET /detail?id=`
- `GET /timeline?limit=`
- `GET /weights`
- `GET /snapshots`
- `POST /write`
- `POST /archive`
- `POST /revoke`
- `POST /restore`
- `POST /weights`
- `POST /mode`
- `POST /snapshot`
- `POST /rollback`

## 约束

- 不直接拼 Markdown、不直接写文件；全部走 `lib/core/store`。
- 面板手写/编辑视为手动写入，放行写入策略。
- 权重修改、模式修改要记审计/事件。
- 回滚必须二次确认 + 先拍安全快照。
