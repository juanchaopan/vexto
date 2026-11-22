# 0006 库

## 背景

参考项目 lingocurrent 选好了一套库，它的架构规则和设计也是按这些库写的。收集、正文整理和朗读要另外几个库。项目的许可证检查只允许宽松的许可证，不允许 GPL 和 LGPL。

## 比较过的方案

- 数据访问：Drizzle ORM、Prisma、Kysely。
- 其余 Web 应用的库：沿用 lingocurrent 的选择，或者等各功能 issue 再一个个选。
- 解析 RSS：fast-xml-parser；rss-parser（2023 年以后没有新版）。
- 正文提取：@mozilla/readability 加 jsdom；@mozilla/readability 加 linkedom（更轻，但 Readability 没在它上面测试过）。
- 句子切分：Node 自带的 `Intl.Segmenter`；第三方的切分库。
- 朗读：Supertonic 官方的 Node.js 版本加 onnxruntime-node；Python 的 supertonic 包。
- MP3 编码：镜像里的 ffmpeg 命令；镜像里的 lame 命令；lamejs、@breezystack/lamejs（LGPL，停止维护）；@mediabunny/mp3-encoder（MPL-2.0，内含 LGPL 的 LAME）；ffmpeg-static（GPL）。
- 端到端测试里的登录：@clerk/testing；自己写。

## 决定

- 数据访问用 Drizzle ORM 和 postgres.js 驱动，接口输入、AI 输出、外部数据和配置都用 Zod 校验。
- 其余 Web 应用的库沿用 lingocurrent 的选择：
  - TanStack Query 和 Zustand；
  - Tailwind CSS；
  - Clerk 的 Next.js SDK；
  - AWS S3 SDK，用来访问 Neon 对象存储；
  - `@vercel/otel`；
  - `server-only`。
- 再加上 OpenAI 官方 SDK。
- 收集和朗读：fast-xml-parser、@mozilla/readability 加 jsdom、`Intl.Segmenter`、onnxruntime-node；Supertonic 官方仓库的 Node.js 推理代码（MIT）复制进项目，保留版权声明并标明改动。
- MP3 用镜像里的 lame 命令编码。
- Cloud Run 的镜像只装它的入口用到的库，只给 Web 应用用的库不进镜像。
- 调用朗读服务：google-auth-library 和 @vercel/oidc。
- 端到端测试里的登录用 @clerk/testing。
- 各个库由第一个用到它的 issue 安装。

## 理由

- Drizzle 轻量，在无服务器环境里启动快，自带生成迁移脚本的工具。
- 沿用 lingocurrent 的库，就能直接借用它定稿的设计和架构规则。
- Readability 就是 Firefox 阅读模式用的库，jsdom 是它官方测试用的 DOM。
- 全项目只用 TypeScript 一种语言，收集和整理的代码可以和 Web 应用共用测试和检查。
- Node 里能编码 MP3 的库都是 GPL 或 LGPL，过不了许可证检查；lame 作为系统程序装在私有镜像里，由代码调用，不是项目的依赖。
- Artifact Registry 免费存 0.5 GB，要放下最近两个版本的镜像。Debian 的 ffmpeg 包连同它带进来的库压缩后约 170 MB，装 ffmpeg 的镜像约 390 MB，两个版本就超出免费额度；lame 只做 MP3 编码，连同它的库不到 10 MB。Web 应用的库（Next.js 和它的平台编译器、React、Clerk 等）在 Cloud Run 里用不到，不装它们，压缩后的镜像又少约 100 MB。

## 代价

- Drizzle 还没到 1.0。
- 库多了以后，升级的工作量也会变大。
- Supertonic 的仓库已经归档，复制进来的推理代码要自己维护。
- jsdom 比较重，只能在 Cloud Run 里用，由架构规则挡在 Web 应用之外。

## 何时重新考虑

某个库停止维护，或者一个功能 issue 发现它不合适时，在那个 issue 的 architect 步骤里重新选。

Last changed: #3 (2026-11-22)
