# 0002 组件

## 背景

抓取网页、调用 AI、语音合成和语音判定都必须放在服务端。项目一个人维护。参考项目 lingocurrent 用的是一个 Next.js 应用加 Neon 的方案。文章朗读一篇 5 分钟的文章约要 680 秒 CPU，Vercel Hobby 的函数最多运行 300 秒、只有 1 个 vCPU、每月 4 小时 CPU，放不下。

## 比较过的方案

- 一个 TypeScript 全栈应用，或者前端和后端分开成两个应用。
- 数据库用 PostgreSQL，或者 SQLite 系（如 Turso）。
- 文章用定时任务提前抓好，或者在用户打开时再抓。
- 收集和朗读放在：Vercel 函数；GitHub Actions；Google Cloud Run；Railway 或 Fly.io 这类容器主机。

## 决定

- 一个 Next.js 全栈应用，部署在 Vercel，提供页面和接口。
- 同一份代码的另一个入口打成一个容器镜像，运行在 Google Cloud Run 上：收集任务（收集、整理、文章朗读）、朗读服务（单词和例句读音）和结算保护（见 0019）。
- PostgreSQL（Neon）。
- 音频放在 Neon 对象存储；朗读模型放在 Google Cloud Storage。
- 文章由定时任务提前收集，触发方式见 0018。
- Speak 判定由 spike #4 决定。

## 理由

- 只有一份代码，Web 应用和 Cloud Run 用同一个提交部署，代码和数据库结构的版本总是一致。
- Cloud Run 的免费额度够这个规模用，按需服务几秒就能合成单词读音，不会排在文章合成后面。
- PostgreSQL 最通用，托管选择多，本机用容器就能跑。
- 文章提前收集好，打开时快；原网站出了问题也不影响阅读。

## 代价

- 一个应用的边界要靠架构规则来守，`app` 和 `worker` 两个入口互不引用。
- 多了一个要维护的平台（Google Cloud），也要绑定结算账户。
- 朗读服务没人用时缩到 0，之后第一次查词要等冷启动，大约十几秒。

## 何时重新考虑

Speak 的 spike 有结论时；文章数超出 Google Cloud 的免费额度时；Vercel 能直接运行朗读模型时。

Last changed: #3 (2026-11-22)
