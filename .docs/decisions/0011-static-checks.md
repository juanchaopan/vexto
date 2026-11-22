# 0011 静态检查

## 背景

- 技术栈是 TypeScript 和 Next.js，仓库公开，托管在 GitHub。
- 项目不部署容器，需要检查的配置主要是 GitHub Actions 工作流。
- 2026 年 trivy-action 出过 tag 被劫持的事件。
- Next.js 的可选依赖 sharp 带着 libvips 的平台包，许可证是 LGPL-3.0-or-later；Next.js 自带的 caniuse-lite 是 CC-BY-4.0。license-checker-rseidelsohn 不列出可选依赖。
- Vercel CLI 自己固定了一些有高危漏洞、而且没有修复版的依赖。

## 比较过的方案

- 格式：Prettier；或者 Biome。
- 架构规则：dependency-cruiser；或者 eslint-plugin-boundaries。
- 重复代码：jscpd；或者不检查。
- 安全扫描：CodeQL、Semgrep CE；或者不做。
- 依赖漏洞：pnpm audit 加 Dependabot 提醒；或者 OSV-Scanner。
- 密钥泄露：gitleaks 加 GitHub 推送保护；或者只开推送保护。
- 许可证：检查并禁止 GPL 类许可；或者不检查。对 sharp 和 caniuse-lite：写明例外后放行；或者去掉 sharp。
- Vercel CLI：在 CI 里用 `pnpm dlx` 临时运行；装进项目并让 audit 忽略这些漏洞；或者用 pnpm overrides 强制升级它的依赖。
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
  - 许可证用 license-checker-rseidelsohn 加 `pnpm licenses list`，后者能看到可选依赖；禁止 GPL、AGPL、其他 LGPL 和未知许可，只放行两项例外：sharp 的 `@img/sharp-*` 平台包可以是 LGPL-3.0-or-later，`caniuse-lite` 可以是 CC-BY-4.0。
- Vercel CLI 不作为项目依赖，在 CI 和 `Taskfile.yml` 里用 `pnpm dlx` 临时运行，版本写死并由 Renovate 更新。
- 工作流：actionlint 和 zizmor。
- 提交和 PR：commitlint 加项目自己的脚本，检查类型和分支对应、issue 号、`Step:` 尾行、步骤允许改的文件、PR 标题。
- 文档：Prettier 和 markdownlint-cli2。
- git hook：lefthook。
- AI 检查都在本机、开 PR 前做：`/simplify`、`/code-review medium` 和 `/security-review`。

## 理由

- 尽量用社区标准工具，并且每一层只用一个工具。
- 全都是免费工具，公开仓库能用上 GitHub 的免费安全功能。
- libvips 是动态链接的库，vexto 是自己运行的网站、不分发软件，LGPL 的义务基本用不上；caniuse-lite 只要求署名。
- Vercel CLI 只在部署时运行，不进产品和锁文件，audit 的规则不用放松。
- AI 检查只在本机做，不需要额外的密钥和费用。

## 代价

- 检查多，PR CI 要跑几分钟。
- 网站上直接做的改动不会经过 AI 评审。
- 步骤检查、类型对应检查和许可证的合并检查是项目自己维护的脚本。
- Vercel CLI 的依赖漏洞不在 audit 的范围里。
- actionlint 还不认 zizmor 要求的 `$/` 本仓库引用写法，工作流里保留 `./` 写法，并对 zizmor 逐行注明忽略的理由。

## 何时重新考虑

有了不在本机工作的贡献者时，考虑在 CI 里加 AI 评审；某个工具停止维护时；actionlint 支持 `$/` 写法时；sharp 或 Vercel CLI 的依赖情况变化时。

Last changed: #1 (2026-11-21)
