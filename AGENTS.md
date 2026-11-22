# vexto 开发指南

vexto 是一个手机网页应用，用来听读英文文章、AI 查词和间隔复习生词。这份文件写给在这个仓库里工作的人和代理：用什么语言、有哪些命令、改动怎样检查、分支和提交怎样写。

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

| 命令                                            | 做什么                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `task setup`                                    | 安装依赖、组件测试用的 Chromium 和 WebKit，以及 git hook                                    |
| `task browsers`                                 | 只安装 Chromium 和 WebKit；CI 加 `--with-deps` 同时装它们的系统库                           |
| `task env-pull`                                 | 链接 `scripts/env-pull.json` 里写的 Vercel 项目，把它 Development 环境的值拉到 `.env.local` |
| `task dev`                                      | 启动开发服务器（`next dev`）                                                                |
| `task format`                                   | 用 Prettier 格式化文件（默认全部）                                                          |
| `task format-check`                             | 用 Prettier 检查格式（默认全部）                                                            |
| `task lint`                                     | ESLint，不允许任何警告（默认全部）                                                          |
| `task docs-lint`                                | markdownlint-cli2 检查 `.docs/` 和根目录的 Markdown                                         |
| `task typecheck`                                | 生成 Next.js 路由类型后运行 `tsc --noEmit`                                                  |
| `task build`                                    | 生产构建（`next build`）                                                                    |
| `task arch`                                     | dependency-cruiser 检查依赖规则（默认 `src`）                                               |
| `task duplication`                              | jscpd 查重复代码                                                                            |
| `task licenses`                                 | 检查运行时依赖的许可证                                                                      |
| `task audit`                                    | `pnpm audit`，有高危或严重漏洞就失败                                                        |
| `task secrets-scan`                             | gitleaks 扫描整个提交历史里的密钥；传 `--staged` 时只扫暂存的改动                           |
| `task workflows-lint`                           | actionlint 和 zizmor 检查 GitHub Actions 工作流和仓库里的 action                            |
| `task commits-check`                            | commitlint 和项目的提交规则，默认检查 `origin/main..HEAD`，可以传 `FROM`、`TO`、`BRANCH`    |
| `task check`                                    | 依次跑格式、lint、文档格式、类型检查、架构规则、重复代码、许可证、依赖漏洞和密钥扫描        |
| `task test-unit`                                | Vitest 单元测试（Node）                                                                     |
| `task test-component`                           | Vitest 浏览器模式的组件测试，Chromium 和 WebKit 各跑一遍                                    |
| `task test-integration`                         | 集成测试                                                                                    |
| `task test-security`                            | 安全测试：登录、权限、用户数据隔离、恶意输入                                                |
| `task test-migration`                           | 迁移测试，每次都跑全部                                                                      |
| `task test-e2e`                                 | 在固定版本的 Playwright Linux 容器里构建应用并跑端到端测试和截图对比（需要 Docker）         |
| `task test-smoke -- <地址> [--production-safe]` | 对运行中的应用跑打了 `@smoke` 标签的测试；生产只跑同时打了 `@production-safe` 的            |
| `task migrate`                                  | 迁移 `DATABASE_URL_UNPOOLED`（没有时用 `DATABASE_URL`）指向的数据库到最新脚本               |

## 改动怎样检查

git hook 由 lefthook 管理，`task setup` 会装好。hook 调用和 CI 相同的 Task 命令，只是范围缩小到暂存的文件或受影响的测试。不要用 `--no-verify` 跳过 hook；跳过了 CI 也会再查一遍。

| 时机       | 检查                                                                                                                                                                   |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 提交前     | 暂存的文件：Prettier、ESLint、markdownlint（只查 `task docs-lint` 范围内的，即 `.docs/` 和根目录的 Markdown）、gitleaks；改了工作流或 action 时跑 actionlint 和 zizmor |
| 写提交信息 | commitlint 和项目的提交规则（类型、issue 号、`Step:` 尾行、步骤允许改的文件）                                                                                          |
| 推送前     | 类型检查，以及相对 `origin/main` 受影响的单元测试                                                                                                                      |

迁移相关的文件是：`drizzle/` 下的迁移脚本、`*.migration.test.ts`、表定义 `src/features/*/server/schema.ts`、`drizzle.config.ts` 和 `scripts/migrate.ts`。

开 PR 前，在本机依次做：

1. `task arch` 和 `task duplication`；
2. 受影响的单元、组件、集成（含安全用例）和端到端测试；改了迁移相关的文件时跑 `task test-migration`；
3. `/simplify`，然后 `/code-review medium` 和 `/security-review`，评审标准见 `REVIEW.md`。

CI 总是跑全部检查。PR 上的每一项都是必过检查：

- 工作流 `ci`：`format-check`、`lint`、`docs-lint`、`typecheck`、`build`、`arch`、`duplication`、`licenses`、`audit`、`secrets-scan`、`workflows-lint`、`test-unit`、`test-component`、`test-integration`、`test-security`、`test-migration`、`test-e2e`、`commits`；
- 工作流 `pr-title`：`pr-title`，改了 PR 标题也会重新检查；
- 工作流 `codeql`：`codeql (javascript-typescript)`、`codeql (actions)`；
- 工作流 `risk`：`risk-gate`。

要不要跑迁移测试由 CI 的 `test-migration` 任务判断：PR 或推送改了迁移相关的文件时才运行 `task test-migration`，没有改时直接报告成功。`task test-migration` 本身不做这个判断，每次都跑全部迁移测试。

风险和人工审批：`risk` 用目标分支上的 `.github/risk-rules.txt` 和分级脚本给 PR 打上 `risk:low`、`risk:medium` 或 `risk:high`；GitHub 最多列出 3000 个改动的文件，列出的数目达到 3000 或者和 PR 记录的不一致时，一律算高风险。中、高风险的 PR 要有人看过之后加上 `human-reviewed` 标签，`risk-gate` 才会通过；它只认在 PR 当前的最新提交到达之后加上的标签，所以有新提交后要看过新提交再重新加上（有新提交时 `risk` 也会去掉这个标签）。规则和分级脚本取自目标分支，PR 改了它们要合并后才生效；但工作流 `.github/workflows/risk.yml` 在 PR 上跑的是 PR 自己的版本，改了它的 PR 可以改掉自己的门禁。这样的 PR 一律是高风险，评审时要检查门禁的改动。

合并到 main 后，`ci` 再完整跑一遍，全部通过后自动部署 staging，并跑冒烟测试。main 上每个提交的 `ci` 各自运行，后来的推送不会取消前面的，所以先推送的提交可能后跑完。部署 staging 时排队，一次只部署一个；轮到某个提交部署时，如果它已经不是 main 的最新提交，就跳过部署，任务照样算成功，日志里写明跳过的原因，这样晚跑完的旧提交不会把 staging 上的新代码盖掉。手动部署用工作流 `deploy`：选目标 staging 或 production，填版本标签（如 `v1.2.3`），staging 也可以填 main 上的提交 SHA；这个提交必须在 main 上，并且它在 main 上的 `ci` 已经跑完、全部检查通过。手动部署不检查是不是 main 的最新提交，可以有意部署旧版本。

环境变量和密钥：每个部署目标（staging，以后还有 production）的变量和密钥只存在同名的 GitHub 环境里。应用在运行时读的值列在 `scripts/lib/runtime-env.ts` 里，密钥存成 GitHub 环境的 secret，其余存成 variable。每次部署在拉取、构建和部署之前，把这些值写进目标 Vercel 项目的 Production 环境，覆盖 Vercel 上原有的副本；密钥在 Vercel 上存成 Sensitive。GitHub 环境里没有设置的名字会跳过，Vercel 上原有的值不动，所以一个目标可以逐个设置。新增运行时值时，在这个列表里加一行，再到每个 GitHub 环境里设置，工作流不用改。本机开发用的值在 `scripts/env-pull.json` 写的 Vercel 项目（`vexto-staging`）的 Development 环境里，用 `task env-pull` 拉到 `.env.local`；要换项目或团队时改这个文件，或者传 `VERCEL_PROJECT=<项目>`、`VERCEL_SCOPE=<团队>`（写在命令后面或设成环境变量都可以）。

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
