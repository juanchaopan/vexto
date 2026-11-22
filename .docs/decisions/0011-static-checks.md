# 0011 静态检查

## 背景

- 技术栈是 TypeScript 和 Next.js，仓库公开，托管在 GitHub。
- 项目不部署容器，需要检查的配置主要是 GitHub Actions 工作流。
- 2026 年 trivy-action 出过 tag 被劫持的事件。

## 比较过的方案

- 格式：Prettier；或者 Biome。
- 架构规则：dependency-cruiser；或者 eslint-plugin-boundaries。
- 重复代码：jscpd；或者不检查。
- 安全扫描：CodeQL、Semgrep CE；或者不做。
- 依赖漏洞：pnpm audit 加 Dependabot 提醒；或者 OSV-Scanner。
- 密钥泄露：gitleaks 加 GitHub 推送保护；或者只开推送保护。
- 许可证：检查并禁止 GPL 类许可；或者不检查。
- 工作流：actionlint 加 zizmor；或者只用 actionlint。
- 提交信息：commitlint 加项目自己的规则；或者全部用项目自己的脚本。
- 文档：Prettier 加 markdownlint-cli2；或者只用 markdownlint-cli2；或者不检查。
- git hook：lefthook、husky 加 lint-staged，或者仓库里的 hook 脚本。
- AI 评审：本机加 CI、只在本机、只在 CI。
- AI 安全评审：只在本机；或者本机加 CI。

## 决定

- 格式和 lint：Prettier、ESLint（加 typescript-eslint 和 eslint-config-next）。
- 架构和重复代码：dependency-cruiser、jscpd（阈值 2%）。
- 安全和依赖：
  - CodeQL；
  - `pnpm audit` 加 Dependabot 漏洞提醒；
  - gitleaks 加 GitHub 密钥扫描和推送保护；
  - license-checker-rseidelsohn，禁止 GPL、AGPL 和未知许可。
- 工作流：actionlint 和 zizmor。
- 提交和 PR：commitlint 加项目自己的脚本，检查类型和分支对应、issue 号、`Step:` 尾行、步骤允许改的文件、PR 标题。
- 文档：Prettier 和 markdownlint-cli2。
- git hook：lefthook。
- AI 检查都在本机、开 PR 前做：`/simplify`、`/code-review medium` 和 `/security-review`。

## 理由

- 尽量用社区标准工具，并且每一层只用一个工具。
- 全都是免费工具，公开仓库能用上 GitHub 的免费安全功能。
- AI 检查只在本机做，不需要额外的密钥和费用。

## 代价

- 检查多，PR CI 要跑几分钟。
- 网站上直接做的改动不会经过 AI 评审。
- 步骤检查和类型对应检查是项目自己维护的脚本。

## 何时重新考虑

有了不在本机工作的贡献者时，考虑在 CI 里加 AI 评审；某个工具停止维护时也要重新考虑。

Last changed: #1 (2026-11-21)
