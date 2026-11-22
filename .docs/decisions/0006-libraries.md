# 0006 数据访问和前端的库

## 背景

参考项目 lingocurrent 选好了一套库，它的架构规则和设计也是按这些库写的。

## 比较过的方案

- 数据访问：Drizzle ORM、Prisma、Kysely。
- 其余的库：沿用 lingocurrent 的选择，或者等各功能 issue 再一个个选。

## 决定

- 数据访问用 Drizzle ORM 和 postgres.js 驱动，接口输入、AI 输出和配置都用 Zod 校验。
- 其余沿用 lingocurrent 的选择：
  - TanStack Query 和 Zustand；
  - Tailwind CSS；
  - Clerk 的 Next.js SDK；
  - AWS S3 SDK，用来访问 Neon 对象存储；
  - `@vercel/otel`；
  - `server-only`。
- 再加上 OpenAI 官方 SDK。
- 各个库由第一个用到它的功能 issue 安装。

## 理由

- Drizzle 轻量，在无服务器环境里启动快，自带生成迁移脚本的工具。
- 沿用 lingocurrent 的库，就能直接借用它定稿的设计和架构规则。

## 代价

- Drizzle 还没到 1.0。
- 库多了以后，升级的工作量也会变大。

## 何时重新考虑

某个库停止维护，或者一个功能 issue 发现它不合适时，在那个 issue 的 architect 步骤里重新选。

Last changed: #1 (2026-11-21)
