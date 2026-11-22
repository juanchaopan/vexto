# lingocurrent 分析：概览

lingocurrent 是 GitHub 公开仓库 `juanchaopan/lingocurrent`，描述为“English reading, vocabulary, and practice workspace”。本分析于 2026-11-21 完成，覆盖它的全部分支、GitHub 上的 issue、PR 和仓库设置，以及它用到的 Vercel 和 Neon 资源（只读检查）。Clerk、Google Cloud、域名注册商和 Cloudflare 没有登录检查，相关内容只来自仓库和 GitHub。

本目录的文件：

| 文件 | 内容 |
|---|---|
| `overview.md` | 目标、范围、进度和对 vexto 的结论 |
| `architecture.md` | 组件、技术选型、代码结构和架构规则 |
| `product-design.md` | 数据模型、各功能的设计和实现状态、AI 与存储的用法 |
| `engineering.md` | CI、检查、AI 评审、风险分级、依赖更新、部署流程 |
| `resources.md` | 外部资源清单和检查结果 |
| `spikes.md` | spike #7 的问题、证据和结论 |
| `findings.md` | 文档和实现之间的差异、缺陷和薄弱点 |

## 目标和范围（按它的文档）

给受邀学习者用的英文阅读和练习工具。完整的使用流程：

1. 从 RSS 每天收集英文文章，每篇生成完整的朗读音频和逐句时间轴。
2. 逐句听读。
3. 在上下文里选中单词或短语，AI 用中文解释。
4. 存成生词卡。
5. 三种互相独立的间隔复习：Speak（读出来）、Spell（拼写）、Translate（选中文释义）。
6. 三种都完成后，卡片归档。

用户和约束：

- 只能受邀登录，用 Clerk 的 Google 登录；第一年最多 1000 个账号，同时 100 人在线。
- 一个人维护，没有管理后台。
- 界面全英文，学习内容（释义、选项）是中文。
- 一个响应式网页同时适配电脑、平板和手机。
- 性能目标：列表和已生成的正文 P95 ≤ 3 秒，AI 查词和语音判定 P95 ≤ 10 秒；月可用性 99.5%；总费用目标每月 30 美元（是目标，不是上限）；Vercel 和 Neon 都保持免费套餐。
- 不做：文章配图、付费、社交、原生 App、离线、导出、费用看板（用量和费用会记录）、微服务。
- 只收全文 RSS，不抓网页；频道清单通过管理脚本导入数据库。

需求编号 REQ-001 到 REQ-039，AI 给出的默认决定 D-001 到 D-016、E-001 到 E-008，未决问题 Q-001 到 Q-038，都写在它的产品文档里。

## 进度

| 阶段 | 状态 |
|---|---|
| 项目简介和架构 | 2026-11-15 定稿 |
| 设计 | 2026-11-16 定稿 |
| 工程骨架 | 2026-11-16 发布到 main：一个欢迎页和 `/api/health`，没有任何产品功能 |
| 路线图 | 5 个 issue，全部未关闭 |

| Issue | 类型 | 内容 | 里程碑 |
|---|---|---|---|
| #6 R1 | chore | 环境、GitHub 配置、登录骨架、频道导入 | M0 可部署骨架与选型 |
| #7 R2 | spike | 朗读（TTS）、Speak 判定、全文 RSS | M0 |
| #8 R3 | feature | 收集、音频、阅读、播放 | M1 完整首版 |
| #9 R4 | feature | 查词、收藏、生词本 | M1 |
| #10 R5 | feature | 三种复习、staging 验收、发布 | M1 |

- #6 的环境已经建好，staging 部署过一次；生产从未部署；预览环境推迟；频道导入没做；生产的邀请邮件被 Gmail 拒收。
- #7 只完成了朗读部分：选定 Supertonic F1 声音、MP3 单声道 32 kbps。Speak 和 RSS 都没有结论。
- 一个超出 #6 范围的业务骨架（11 张表、登录、阅读页）留在草稿 PR #12 里，没有合并，也没有部署。

## 对 vexto 的结论

vexto 的功能范围以 lingocurrent 为准，只改了四处：只做手机布局；RSS 只给摘要时可以抓原网页；订阅源写在随版本发布的配置文件里；用户只有少数几个人。

lingocurrent 的产品功能代码几乎为零，所以 vexto 不需要沿用它的代码。它能用作模板的是下面这些：

1. **托管方式**：Next.js 应用在 Vercel Hobby，staging 和生产是两个独立的 Vercel 项目，都不连 Git，由 GitHub Actions 部署；PostgreSQL 和文件都在 Neon Free，staging 和生产各一个 Neon 项目，文件放在 Neon 的私有对象存储（S3 协议）。
2. **工程体系**：CI 任务、架构规则检查、按风险分级的人工审批标签、Claude 代码评审和安全评审、只能从 main 上已通过 CI 的版本标签手动部署生产。
3. **定稿的设计**：查词按“句子 + 选区”缓存、生词卡的数据结构、只保存每种模式一行进度的无会话复习算法、带租约的后台任务表、音频存储的容量控制和淘汰规则。
4. **朗读的选型**：Supertonic F1、MP3 单声道 32 kbps。音频在哪里生成还没有验证，按它的测量，在 Vercel Hobby 上生成整篇文章的朗读 CPU 额度不够。

lingocurrent 没有调用过 OpenAI 的 Luna 模型。查词用哪个模型，它的文档写的是“满足质量的低价模型”，没有具体定下来。代码里唯一出现的 OpenAI 模型是 `gpt-realtime-2.1`，只在 spike 里作为朗读和语音判定的付费备选，从来没有真正调用过。

项目所有者打算停用 lingocurrent，由 vexto 接手它的 Vercel 项目、Neon 项目和 Clerk 应用。lingocurrent 的数据库是空的，生产从未部署过，所以接手时不需要迁移数据。

Last changed: #1 (2026-11-21)
