# lingocurrent 分析：工程体系和部署

## 分支和合并

- GitHub Flow，工作分支名 `codex/<issue>`，合并保留 merge commit，三种合并方式都开着，开了自动合并，合并后删分支。
- 规则集（ruleset）保护默认分支：不能删除，不能强推；必须走 PR，需要 0 个批准，必须解决所有评审对话，新推送会作废旧的批准；必过检查是 `ci`、`risk-gate` 和 `commit-lint`，并且分支必须和 main 同步。没有旁路用户。
- Actions 的默认令牌只读，Actions 不能批准 PR。开了密钥扫描和推送保护；Dependabot 安全更新关着。

## CI 任务

`ci` 工作流在 PR、merge queue 和推送 main 时运行，同一个 ref 上的旧运行会被取消。

| 任务 | 内容 | 在 main 上的耗时 |
|---|---|---|
| `app` | 在固定版本的 Playwright 容器里依次跑：安装、格式检查、lint、架构规则、类型检查、Vitest 单元测试，以及 Storybook 里的浏览器测试和可访问性测试、构建、构建 Storybook、Playwright 端到端测试；失败时上传测试证据 | 约 70 秒 |
| `local-stack` | 用 docker compose 起两个应用副本、nginx、PostgreSQL 17、S3Mock 和 AI 桩服务，检查负载均衡确实打到两个副本、存储桶可用，再拆掉 | 约 88 秒 |
| `duplication` | jscpd | 约 19 秒 |
| `ci` | 汇总，三个任务都通过才算通过 | 约 4 秒 |

整条流水线约 1.5 分钟。

其他工作流：

- `commit-lint`：检查 PR 里每个提交的信息格式。在 merge queue 里这一步被跳过，所以总是通过。
- `ai-review`：
  - `risk`：按目标分支上的风险规则文件给 PR 打 `risk:low`、`risk:medium` 或 `risk:high` 标签；有新提交时去掉 `human-reviewed`。
  - `claude-review`：用 claude-code-action 做代码评审，提示词是中文，评审深度看风险等级；发行内评论，标 [Important]、[Nit]、[Pre-existing]，加一条总结；最多 3 轮；只给读权限，从不批准。
  - `risk-gate`：中、高风险的 PR 必须有 `human-reviewed` 标签才通过。
- `security-review`：另一个 Claude 安全评审，只报有具体攻击路径的问题。
- `claude`：响应 `@claude` 提及，有写权限。
- 评审评测：把以前的有 bug 和没 bug 的 diff 交给 `claude -p` 重放并打分，用来比较评审效果；目前还没有评测用例。

风险规则：

- 高风险：CI 和 Claude 配置、AGENTS / CLAUDE / REVIEW 文件、lint 和架构规则配置、截图基线、登录、迁移和 SQL、`.env*`、Dockerfile、基础设施、身份模块、基础设施层、脚本、Storybook 和测试配置。
- 低风险：Markdown 文件、文档目录、txt 文件。
- 其余都是中风险。release 分支一律算高风险，从 main 合回来的 PR 算低风险。

## 依赖更新

Dependabot 每周更新 npm 依赖（最多同时开 5 个 PR）和 GitHub Actions。另外还装了 Renovate 应用，它的初始化 PR 被仓库自己的 Prettier 和 commit-lint 拦住了，两个工具功能重叠。

## 环境和部署

| 环境 | Vercel 项目 | Neon 项目 | Clerk 实例 | 地址 |
|---|---|---|---|---|
| staging | `lingocurrent-staging` | `lingocurrent-staging-db` | `lingocurrent-staging-auth`（开发实例） | https://lingocurrent-staging.vercel.app |
| production | `lingocurrent-production` | `lingocurrent-production-db` | `lingocurrent-production-auth`（生产实例） | 计划用 `lingocurrent.dpdns.org`，从未部署 |

两个 Vercel 项目都关掉了 Git 自动部署，由 GitHub Actions 部署：

- **staging（自动）**：`ci` 在 main 上通过后触发（还要求仓库变量 `DEPLOY_ENABLED` 为 `true`）。流程：确定要部署的精确 SHA，在 GitHub 的 `staging` 环境里安装依赖、跑数据库迁移，再用固定版本的 Vercel CLI 以 `--prod` 部署，环境变量通过命令行参数传给 Vercel。部署后不跑冒烟测试。
- **生产（手动）**：手动触发并输入版本标签。先检查标签在 `origin/main` 的历史里，并且这个提交在 main 上的 CI 通过了，然后在 `production` 环境里部署。同一个环境同时只跑一个部署，不取消正在进行的。回滚就是重新部署更早的标签。
- **PR 预览（手动，目前关闭）**：从 main 手动触发，输入 PR 号和批准的 SHA。检查 PR 来自本仓库、头提交正是那个 SHA、CI 通过；然后从种子分支建 Neon 分支 `pr-N`，签发只能访问这个分支的存储凭据，跑迁移，部署到 staging 项目的预览环境。控制脚本从 main 检出，应用代码从 PR 的 SHA 检出，PR 代码改不了部署流程。PR 关闭时删掉预览部署和 Neon 分支。
- **截图基线（手动）**：在 Playwright 容器里重新生成截图，作为产物上传。

本地环境：docker compose 起两个应用副本（多阶段构建的 standalone 镜像，以非 root 用户运行）、nginx、PostgreSQL 17、S3Mock 和 AI 桩服务，端口只绑在 127.0.0.1。另有一个专门的 Dockerfile，用来复现 Linux 下的截图环境。

## 可以给 vexto 借鉴的做法

- 风险分级加 `human-reviewed` 标签的人工审批，以及有新提交就自动去掉标签。
- 没配 Claude 凭据时跳过 AI 评审任务，不让 CI 失败；但要清楚：被跳过不等于评审通过。
- 架构规则检查在分析到 0 个模块时直接失败。
- 生产只能部署 main 上通过 CI 的版本标签。
- PR 预览：控制脚本从 main 来、应用代码从 PR 来，每个 PR 一个 Neon 分支，PR 关闭时清理。
- 截图测试固定在同一个 Linux 容器里跑。

Last changed: #1 (2026-11-21)
