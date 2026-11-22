# lingocurrent 分析：架构

## 组件

模块化单体：一个 Next.js App Router 应用部署在 Vercel，HTTP 接口和后台任务共用同一套应用服务；所有状态都在 Neon（PostgreSQL 加对象存储）。不拆微服务，不加第二个队列，也不另开计算服务器。

| 组件     | 选择                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Web 应用 | Next.js 16 + TypeScript，Route Handlers 提供 `/api/v1` 下的 REST JSON 接口                              |
| 数据库   | Neon PostgreSQL 18，经 Vercel Marketplace 接入                                                          |
| 对象存储 | Neon Object Storage，私有存储桶，S3 协议                                                                |
| 后台任务 | PostgreSQL 里的一张临时任务表，生产环境每 15 分钟唤醒一次（计划用 Vercel Schedules）；不用 Vercel Queue |
| 登录     | Clerk，只允许受邀的 Google 账号                                                                         |
| AI       | OpenAI，服务端直接调用，不经过 AI Gateway                                                               |
| 观测     | `@vercel/otel`，用 Vercel 免费的 Tracing                                                                |

## 技术选型和决策记录

它有 19 条架构决策记录，主要内容：

| 编号        | 决定                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| 0001        | 模块化单体                                                                     |
| 0002 / 0011 | Route Handlers 提供 REST 接口；PostgreSQL 英文全文检索（GIN 索引）             |
| 0003        | 后台任务用一张 PostgreSQL 临时任务表，不用队列服务                             |
| 0005        | 音频缓存按创建时间先进先出淘汰：用到 95% 开始删，删到 90% 以下                 |
| 0006        | Drizzle ORM + Zod                                                              |
| 0007        | Neon PostgreSQL + Neon 对象存储，都由 Vercel 托管接入                          |
| 0008        | drizzle-kit 生成版本化 SQL 迁移脚本                                            |
| 0009        | 前端：TanStack Query、Zustand、Tailwind 语义化颜色变量、容器组件和展示组件分开 |
| 0010        | 测试：Storybook、Vitest + Testing Library、Playwright 功能测试和截图对比       |
| 0012        | 四个环境；main 自动部署 staging，生产从版本标签手动部署                        |
| 0013        | 接受免费套餐较弱的恢复能力，不设 24 小时的 RPO 和 RTO                          |
| 0014        | 用 Vercel Tracing，要求低采样率                                                |
| 0016        | 朗读和语音判定的引擎待 spike 决定                                              |

## 版本

全部依赖写死精确版本。

| 类别   | 版本                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| 运行时 | Node 24.22.1，pnpm 10.24.0，ESM                                                              |
| 框架   | next 16.4.6，react 19.3.0，typescript 6.0.3                                                  |
| 数据   | drizzle-orm 0.45.4，drizzle-kit 0.31.11，postgres（postgres.js）4.1.1，zod 4.6.7             |
| 服务   | @clerk/nextjs 7.10.0，@aws-sdk/client-s3 3.1169.0，@vercel/otel 2.3.0                        |
| 前端   | @tanstack/react-query 5.107.1，zustand 5.1.0，tailwindcss 4.3.3                              |
| 测试   | vitest 5.1.0（含浏览器模式），playwright 1.65.1，storybook 10.6.7，Testing Library，jsdom 31 |
| 检查   | eslint 9 + eslint-config-next，prettier 3.10.1，dependency-cruiser 18.7.2，jscpd 5.4.3       |

main 上只有 next、react、zod、@vercel/otel 和 TanStack Query 的 Provider 真正用到；Drizzle、postgres、Clerk、AWS SDK 和 Zustand 都装了但没用。

## 代码结构

```text
src/
  app/                          路由：布局、首页、/api/health
  features/<功能>/               pages、components、data-access
  client/                       客户端 Provider
  server/application/           应用服务（用例）
  server/modules/<模块>/         domain、repositories、services
                                模块：content、identity、lookup、media、reading、review、usage、vocabulary
  server/infrastructure/        数据库 schema 和外部服务适配
  shared/                       前后端共用的契约（Zod）、工具、UI
  styles/                       颜色变量
```

调用方向：路由 → 应用服务 → 模块服务；只有一个启动装配文件可以连接具体实现；domain 是纯代码，不依赖任何第三方包和 Node 内置模块。

## 架构规则（dependency-cruiser，全部为错误级别）

- 不能有循环依赖，不能有解析不到的导入。
- shared 不依赖 app、features、client 和 server。
- 客户端、功能和 shared 不能导入服务端代码，也不能导入 postgres、drizzle-orm、Clerk 服务端、AWS SDK 和 `@vercel/otel`。
- 展示组件不能导入页面、数据访问层、客户端、app 和服务端，也不能导入 React Query、Zustand、axios、swr 和 `next/navigation`。
- 功能之间互相隔离；路由只能调用应用服务，不能直接用数据库或第三方 SDK。
- 应用服务只用模块的公开接口，不碰基础设施层；模块之间互相隔离，也不向外依赖。
- domain 不能依赖框架；repositories 不能依赖 services；业务代码不能导入 next、react、postgres、drizzle、Clerk、AWS SDK、Vercel 包和 openai。

检查脚本包了一层：分析到的模块数为 0 时直接失败，防止 TypeScript 版本不兼容时检查悄悄失效；还支持一个“已知违规”基线文件。

## 其他代码约定

- ESLint：圈复杂度不超过 10，嵌套深度不超过 3，函数不超过 100 行，禁止 `any`，除 warn 和 error 外禁止 console。
- Prettier：每行 100 字符，单引号；强制 LF 换行。
- 重复代码（jscpd）：阈值 2%，至少 60 个 token、8 行才算重复。
- 提交信息遵守 Conventional Commits，首行不超过 100 字符，由本地 commit-msg hook 和 CI 检查。
- 给 AI 写代码定的规则：代码要读起来像一次写成；先提交重构再提交功能；AI 和对象存储调用不放在数据库事务里，提交前再检查一次；启动时不自动推送 schema。
- Claude Code 的钩子：每次改文件后自动跑 prettier 和 eslint，lint 失败就退出码 2，让 Claude 当场修。

Last changed: #1 (2026-11-21)
