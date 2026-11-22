# 接口

## 健康检查

说明应用正在运行，供冒烟测试和人工检查使用。它不检查数据库等依赖。

| 项         | 内容                                               |
| ---------- | -------------------------------------------------- |
| 方法和路径 | `GET /api/health`                                  |
| 权限       | 公开，不需要登录                                   |
| 缓存       | 响应头 `Cache-Control: no-store`                   |
| 其他方法   | `HEAD` 和 `GET` 相同，但没有正文；其他方法返回 405 |

成功时的响应：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"status":"ok","service":"vexto"}
```

Last changed: #1 (2026-11-21)
