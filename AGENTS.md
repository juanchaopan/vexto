# vexto 开发指南

vexto 是一个手机网页应用，用来听读英文文章、AI 查词和间隔复习生词。这份文件写给在这个仓库里工作的人和代理：用什么语言、有哪些命令、代码怎样组织、改动怎样检查、怎样部署、分支和提交怎样写。

## 文档

文档都在 `.docs/` 里：

- `.docs/brief.md`：项目的目标、用户、范围和语言；
- `.docs/architecture.md`：架构，技术选择、代码结构、检查、测试和部署都以它为准；
- `.docs/decisions/`：每个架构决定的背景、方案和理由；
- `.docs/design/`：界面、接口和数据的设计；
- `.docs/reference/`：参考项目的分析。

评审标准见根目录的 `REVIEW.md`，版本变化记在 `CHANGELOG.md`。

## 语言

| 用途                   | 语言 |
| ---------------------- | ---- |
| 代码注释               | 英文 |
| 文档                   | 中文 |
| 原型和界面文字         | 英文 |
| 学习内容（释义、选项） | 中文 |
| issue 和代码评审评论   | 中文 |

引用 issue 写成 `#12`。

## 命令

所有命令都通过 Task 运行，在 Windows、macOS 和 Linux 上一样。需要额外参数时写在 `--` 后面，例如 `task test-unit -- src/features/health`。

| 命令                                                        | 做什么                                                                                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `task setup`                                                | 安装依赖、组件测试用的 Chromium 和 WebKit，以及 git hook                                                                 |
| `task browsers`                                             | 只安装 Chromium 和 WebKit；CI 加 `--with-deps` 同时装它们的系统库                                                        |
| `task env-pull`                                             | 链接 `scripts/env-pull.json` 里写的 Vercel 项目，把它 Development 环境的值拉到 `.env.local`                              |
| `task model-download`                                       | 按 `config/speech-model.json` 从 Hugging Face 下载固定版本的朗读模型到 `.models/<模型>/<版本>/`，逐个核对大小和校验和    |
| `task model-upload -- <项目 ID>`                            | 再核对一次下载好的模型，用 gcloud 复制到该 Google Cloud 项目的模型存储桶 `<项目 ID>-models` 的 `<模型>/<版本>/` 下       |
| `task dev`                                                  | 启动开发服务器（`next dev`）                                                                                             |
| `task format`                                               | 用 Prettier 格式化文件（默认全部）                                                                                       |
| `task format-check`                                         | 用 Prettier 检查格式（默认全部）                                                                                         |
| `task lint`                                                 | ESLint，不允许任何警告（默认全部）                                                                                       |
| `task docs-lint`                                            | markdownlint-cli2 检查 `.docs/` 和根目录的 Markdown                                                                      |
| `task typecheck`                                            | 生成 Next.js 路由类型后运行 `tsc --noEmit`                                                                               |
| `task build`                                                | 生产构建（`next build`），再用 Docker 构建 Cloud Run 的镜像（不推送）                                                    |
| `task build-worker [IMAGE=<名字:标签>] [CACHE_FROM=<镜像>]` | 只用 `worker.Dockerfile` 构建 Cloud Run 的镜像，默认标签 `vexto-worker:local`；`CACHE_FROM` 复用旧镜像里没变的层         |
| `task arch`                                                 | dependency-cruiser 检查依赖规则（默认 `src`）                                                                            |
| `task duplication`                                          | jscpd 查重复代码                                                                                                         |
| `task licenses`                                             | 检查运行时依赖的许可证                                                                                                   |
| `task audit`                                                | `pnpm audit`，有高危或严重漏洞就失败                                                                                     |
| `task secrets-scan`                                         | gitleaks 扫描整个提交历史里的密钥；传 `--staged` 时只扫暂存的改动                                                        |
| `task workflows-lint`                                       | actionlint 和 zizmor 检查 GitHub Actions 工作流和仓库里的 action                                                         |
| `task commits-check`                                        | commitlint 和项目的提交规则，默认检查 `origin/main..HEAD`，可以传 `FROM`、`TO`、`BRANCH`                                 |
| `task check`                                                | 依次跑格式、lint、文档格式、类型检查、架构规则、重复代码、许可证、依赖漏洞和密钥扫描                                     |
| `task test-unit`                                            | Vitest 单元测试（Node）                                                                                                  |
| `task test-component`                                       | Vitest 浏览器模式的组件测试，Chromium 和 WebKit 各跑一遍                                                                 |
| `task test-integration`                                     | 集成测试，自己起停一次性的 PostgreSQL 和 S3Mock 容器（需要 Docker）                                                      |
| `task test-security`                                        | 安全测试：登录、权限、用户数据隔离、恶意输入；容器和集成测试一样                                                         |
| `task test-migration`                                       | 迁移测试，每次都跑全部                                                                                                   |
| `task test-e2e`                                             | 在固定版本的 Playwright Linux 容器里构建应用并跑端到端测试和截图对比，应用连一次性的 PostgreSQL 和 S3Mock（需要 Docker） |
| `task test-smoke -- <地址> [--production-safe]`             | 对运行中的应用跑打了 `@smoke` 标签的测试；生产只跑同时打了 `@production-safe` 的                                         |
| `task migrate`                                              | 迁移 `DATABASE_URL_UNPOOLED`（没有时用 `DATABASE_URL`）指向的数据库到最新脚本                                            |
| `task member -- add\|revoke <邮箱> --target <环境>`         | 把一个人加进目标环境数据库的成员名单，或者取消他的资格                                                                   |
| `task member -- list --target <环境>`                       | 按加入时间列出目标环境的成员名单                                                                                         |

## 代码怎样写

- 模块之间用相对路径引用，并且写出文件的扩展名，例如 `import { log } from '../lib/log.ts'`。Cloud Run 的镜像里由 Node 直接运行 `src/` 下的 TypeScript（类型擦除），Node 只认确切的文件名；Next.js、Vitest、tsc 和 dependency-cruiser 也都认这种写法。ESLint 拒绝不带扩展名的相对引用；`tsconfig.json` 开了 `verbatimModuleSyntax`，只用作类型的引用要写成 `import type`。
- `src/worker/` 下是 Cloud Run 的三个入口，只做入口：`collect.ts`（任务 `vexto-collect`）、`tts.ts`（服务 `vexto-tts`）、`billing-guard.ts`（服务 `vexto-billing-guard`）。它们通过功能的 `index.ts` 调用功能模块；本机用 `node src/worker/<入口>.ts` 运行，服务监听 `PORT`（默认 8080）。
- 服务的健康检查是 `GET /health`，不用 `/healthz`：Cloud Run 把以 `z` 结尾的路径留给自己，这类请求到不了容器。
- 依赖方向是 `app` → `features` → `lib` 和 `worker` → `features` → `lib`，`app` 和 `worker` 互不引用；jsdom、@mozilla/readability 和 onnxruntime-node 不能被 `app` 引到。这些规则由 `task arch` 检查。
- 集成测试和安全测试运行时，`DATABASE_URL` 和 `S3_*` 已经指向一次性的容器（`scripts/lib/test-services.ts`），被测代码像在生产环境一样从 `process.env` 读它们。数据库用迁移脚本从空库建起。

## 改动怎样检查

git hook 由 lefthook 管理，`task setup` 会装好。hook 调用和 CI 相同的 Task 命令，只是范围缩小到暂存的文件或受影响的测试。不要用 `--no-verify` 跳过 hook；跳过了 CI 也会再查一遍。

| 时机       | 检查                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提交前     | 暂存的文件：Prettier、ESLint、markdownlint（只查 `task docs-lint` 范围内的，即 `.docs/` 和根目录的 Markdown）、gitleaks；改了工作流或 action 时跑 actionlint 和 zizmor |
| 写提交信息 | commitlint 和项目的提交规则（类型、issue 号、`Step:` 尾行、步骤允许改的文件）                                                                                          |
| 推送前     | 类型检查，以及相对 `origin/main` 受影响的单元测试                                                                                                                      |

迁移相关的文件是：`drizzle/` 下的迁移脚本、`*.migration.test.ts`、各功能的表定义 `src/features/*/server/schema.ts`、跨功能共用的表定义 `src/lib/db/schema.ts`、`drizzle.config.ts` 和 `scripts/migrate.ts`。

开 PR 前，在本机依次做：

1. `task arch` 和 `task duplication`；
2. 受影响的单元、组件、集成（含安全用例）和端到端测试；改了迁移相关的文件时跑 `task test-migration`；
3. `/simplify`，然后 `/code-review medium` 和 `/security-review`，评审标准见 `REVIEW.md`。

CI 总是跑全部检查。PR 上的每一项都是必过检查：

- 工作流 `ci`：`format-check`、`lint`、`docs-lint`、`typecheck`、`build`（含 Cloud Run 镜像的构建）、`arch`、`duplication`、`licenses`、`audit`、`secrets-scan`、`workflows-lint`、`test-unit`、`test-component`、`test-integration`、`test-security`、`test-migration`、`test-e2e`、`commits`；
- 工作流 `pr-title`：`pr-title`，改了 PR 标题也会重新检查；
- 工作流 `codeql`：`codeql (javascript-typescript)`、`codeql (actions)`；
- 工作流 `risk`：`risk-gate`。

要不要跑迁移测试由 CI 的 `test-migration` 任务判断：PR 或推送改了迁移相关的文件时才运行 `task test-migration`，没有改时直接报告成功。`task test-migration` 本身不做这个判断，每次都跑全部迁移测试。

风险和人工审批：`risk` 用目标分支上的 `.github/risk-rules.txt` 和分级脚本给 PR 打上 `risk:low`、`risk:medium` 或 `risk:high`；GitHub 最多列出 3000 个改动的文件，列出的数目达到 3000 或者和 PR 记录的不一致时，一律算高风险。中、高风险的 PR 要有人看过之后加上 `human-reviewed` 标签，`risk-gate` 才会通过；它只认在 PR 当前的最新提交到达之后加上的标签，所以有新提交后要看过新提交再重新加上（有新提交时 `risk` 也会去掉这个标签）。规则和分级脚本取自目标分支，PR 改了它们要合并后才生效；但工作流 `.github/workflows/risk.yml` 在 PR 上跑的是 PR 自己的版本，改了它的 PR 可以改掉自己的门禁。这样的 PR 一律是高风险，评审时要检查门禁的改动。

## 部署

合并到 main 后，`ci` 再完整跑一遍，全部通过后自动部署 staging，并跑冒烟测试。main 上每个提交的 `ci` 各自运行，后来的推送不会取消前面的，所以先推送的提交可能后跑完。部署 staging 时排队，一次只部署一个；轮到某个提交部署时，如果它已经不是 main 的最新提交，就跳过部署，任务照样算成功，日志里写明跳过的原因，这样晚跑完的旧提交不会把 staging 上的新代码盖掉。手动部署用工作流 `deploy`：选目标 staging 或 production，填版本标签（如 `v1.2.3`），staging 也可以填 main 上的提交 SHA；这个提交必须在 main 上，并且它在 main 上的 `ci` 已经跑完、全部检查通过。手动部署不检查是不是 main 的最新提交，可以有意部署旧版本。

一次部署（`.github/workflows/deploy-target.yml`）按这个顺序：把 Web 应用的运行时值写进 Vercel → 迁移数据库 → 构建 Web 应用 → 用 Workload Identity Federation 登录 Google Cloud → 把 Cloud Run 的密钥写进 Secret Manager → 构建并推送镜像 → 更新 Cloud Run 任务和服务 → 部署 Web 应用 → 冒烟测试。Web 应用和 Cloud Run 总是同一个提交。Google Cloud 的登录会在工作区写一个短期的凭据文件，所以会运行项目构建代码的两步（迁移和 Web 应用的构建）放在登录之前，镜像的构建上下文只收 `.dockerignore` 里列出的文件。

### Google Cloud 的资源名字

每个目标的 Google Cloud 资源名字都由 GitHub 环境里的 `GCP_PROJECT_ID` 和 `GCP_REGION` 推出来，不另设变量。部署用到的名字写在 `scripts/lib/google-cloud.ts` 和 `scripts/lib/cloud-run.ts` 里，其余资源由搭建时按同样的约定建：

| 资源                             | 名字                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Artifact Registry 仓库（Docker） | `vexto`，在 `GCP_REGION`；清理策略只保留最近两个版本                                                                                                |
| 镜像                             | `<GCP_REGION>-docker.pkg.dev/<GCP_PROJECT_ID>/vexto/worker:<提交 SHA>`，最近一次部署的镜像另有标签 `latest`，下次构建复用它没变的层                 |
| 模型存储桶                       | `<GCP_PROJECT_ID>-models`，在 `GCP_REGION`；模型放在 `<模型>/<版本>/` 下，挂载到 `/models`，`MODEL_DIR` 是 `/models/<模型>/<版本>`                  |
| Cloud Run 任务和服务             | `vexto-collect`（任务）、`vexto-tts`、`vexto-billing-guard`（服务）                                                                                 |
| 它们的运行身份                   | 和资源同名的服务账号，例如 `vexto-tts@<GCP_PROJECT_ID>.iam.gserviceaccount.com`                                                                     |
| Secret Manager 密钥              | 和运行时值同名：`DATABASE_URL`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`                                                                          |
| Cloud Scheduler 任务             | `vexto-collect`，`*/15 * * * *`，UTC，用服务账号 `vexto-scheduler` 启动任务                                                                         |
| 预算通知                         | Pub/Sub 主题 `vexto-budget`，推送订阅 `vexto-budget-push` 用服务账号 `vexto-budget-push` 调用 `vexto-billing-guard` 的 `POST /budget-notifications` |
| Web 应用调用朗读服务的身份       | GitHub 环境变量 `GCP_TTS_INVOKER_SERVICE_ACCOUNT` 写的服务账号，只有 `vexto-tts` 的 Run Invoker                                                     |

部署不创建以上的基础设施（存储桶、Artifact Registry 仓库、服务账号和它们的权限、密钥本身、Cloud Scheduler、预算、Pub/Sub、两个身份联合提供方），它们在搭建时用 gcloud 建一次。Cloud Run 的任务和服务由部署创建和更新，每次部署都把它们的设置重新写一遍：收集任务 2 vCPU、2 GiB、最长 3600 秒、不重试、一次一个；朗读服务 1 vCPU、2 GiB、0 到 1 个实例；结算保护 1 vCPU、256 MiB、0 到 1 个实例；两个服务都只允许有 Run Invoker 的身份调用。

冒烟测试里，部署任务用 `gcloud auth print-identity-token` 以部署的服务账号为 `TTS_SERVICE_URL` 取一个身份令牌，在日志里遮住，只通过环境变量交给测试，测试带着它请求 `vexto-tts` 的 `GET /health`。

### 环境变量和密钥

每个部署目标（staging，以后还有 production）的变量和密钥只存在同名的 GitHub 环境里。应用在运行时读的值列在 `scripts/lib/runtime-env.ts` 里，每个值写明谁读它（Web 应用、收集任务、朗读服务），密钥存成 GitHub 环境的 secret，其余存成 variable。每次部署都把这些值写到读它的地方，覆盖原有的副本：

- Web 应用读的值写进目标 Vercel 项目的 Production 环境，密钥在 Vercel 上存成 Sensitive；
- 收集任务和朗读服务读的密钥经标准输入写进目标的 Secret Manager，值没变就不加新版本，写完只留最新的一个版本；Cloud Run 按名字引用它们的 `latest` 版本；
- 收集任务和朗读服务读的变量写成 Cloud Run 的环境变量。

GitHub 环境里没有设置的名字会跳过，原有的副本不动，所以一个目标可以逐个设置。写值的每一步在 `.github/workflows/deploy-target.yml` 里按名字只拿它要写的值：密钥只从 `secrets` 取，变量只从 `vars` 取，每个名字另有一个标志，说明另一种里是不是也存了这个名字；有值存错了种类，或者列表里的名字这一步没有拿，同步就失败，什么都不写。新增运行时值时，在列表里加一行并写明谁读它，把它和它的标志加进对应步骤的 `env`，再到每个 GitHub 环境里设置；单元测试比对列表和这些步骤的 `env`，不一致时失败，并列出应有的写法。部署任务自己的设置（`VERCEL_TOKEN`、`DATABASE_URL_UNPOOLED`、`GCP_*` 等）不是运行时值，不在列表里。

本机开发用的值在 `scripts/env-pull.json` 写的 Vercel 项目（`vexto-staging`）的 Development 环境里，用 `task env-pull` 拉到 `.env.local`；要换项目或团队时改这个文件，或者传 `VERCEL_PROJECT=<项目>`、`VERCEL_SCOPE=<团队>`（写在命令后面或设成环境变量都可以）。

成员名单：`task member` 修改目标环境数据库里的 `members` 表，目标名就是部署目标的名字。连接地址由 Neon CLI（`neonctl`，用 `pnpm dlx` 临时运行，版本是 `Taskfile.yml` 里的 `NEON_CLI_VERSION`）按 `scripts/neon-targets.json` 里该目标的 Neon 项目、分支和数据库取得；没写数据库时，用分支里唯一的那个。地址只在脚本的内存里，不显示，不写进文件，也不传给别的命令；出错时只报错误的种类。第一次用之前，先用 `pnpm dlx neonctl@<NEON_CLI_VERSION> auth` 登录 Neon。邮箱存成小写，比对不分大小写。`add` 对取消过的人把他设回有效；`revoke` 在一个事务里删除这个人的个人数据，清空绑定的 Clerk 用户和条款确认记录，再设为 `revoked`。个人数据表的删除语句写在 `scripts/lib/members.ts` 的 `memberDataRemovals` 里，每加一张存个人数据的表，就在那里加上它的语句。不用 GitHub 工作流管理名单，因为公开仓库的运行日志谁都能看。

## 分支和提交

分支：

| 分支                                                      | 用途                                             |
| --------------------------------------------------------- | ------------------------------------------------ |
| `<feature\|fix\|refactor\|maintenance>/<issue 号>-<短名>` | 一个 issue 的工作，例如 `feature/12-word-lookup` |
| `scratch/<issue 号>-<短名>`                               | 一个 issue 的原型和实验，不合并                  |
| `release/<版本>`                                          | 发版，PR 一律算高风险                            |
| `renovate/...`                                            | Renovate 开的依赖更新                            |
| `main`                                                    | 默认分支，只能通过 PR 合并                       |

ops 和 spike 类型的 issue 不开 PR，没有 issue 分支。

提交信息用 Conventional Commits：

- 第一行写成 `<类型>(<范围>): <说明> (#<issue 号>)`，不超过 100 个字符，结尾的 issue 号必须是分支的 issue；
- 类型和分支的 issue 类型对应：`feature` 用 `feat`，`fix` 用 `fix`，`refactor` 用 `refactor`，`maintenance` 用 `chore`；
- issue 分支上的每个提交在最后一段写 `Step:` 尾行，说明是哪个步骤的提交，每个步骤只能改下表里的文件：

| `Step:`     | 允许改的文件                                  |
| ----------- | --------------------------------------------- |
| `kickoff`   | `.docs/brief.md`、`.docs/reference/**`        |
| `architect` | `.docs/architecture.md`、`.docs/decisions/**` |
| `design`    | `.docs/design/**`                             |
| `scaffold`  | `.docs/` 以外的文件                           |
| `implement` | `.docs/` 以外的文件                           |

- 依赖更新的提交和 PR 标题写成 `fix(deps): ...`（应用运行时的依赖）或 `chore(deps): ...`（其余），不带 issue 号，也不带 `Step:` 尾行。

例子：

```text
feat(word-lookup): explain a selected phrase in its sentence (#12)

Step: implement
```

把 main 的新提交带进分支时，用 `git merge origin/main`，不要 rebase 或强推；把 main 合进来的合并提交不参与步骤检查。

PR 只能 squash 合并，PR 标题就是 main 上的提交，规则和提交的第一行一样；发版 PR 的标题是 `chore(release): <版本>`。合并后，工作流 `release` 按 `VERSION` 打上 `v<版本>` 标签，并用 `CHANGELOG.md` 里这个版本的一节创建 GitHub Release。

## Next.js 说明

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
