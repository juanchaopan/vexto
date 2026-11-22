# vexto

vexto 是一个手机网页应用：听读英文订阅源里的文章，选中不认识的词，查看 AI 结合上下文给出的中文解释，存进生词本，再用 Speak、Spell、Translate 三种间隔复习记住它。

项目的目标和范围见 [`.docs/brief.md`](.docs/brief.md)，架构见 [`.docs/architecture.md`](.docs/architecture.md)。

## 本机运行

### 准备工具

| 工具       | 版本    | Windows（winget）                                           | macOS（Homebrew）                                  |
| ---------- | ------- | ----------------------------------------------------------- | -------------------------------------------------- |
| Node.js    | 26.13.1 | `winget install Schniz.fnm`，然后在仓库里运行 `fnm install` | `brew install fnm`，然后在仓库里运行 `fnm install` |
| pnpm       | 12.21.0 | `npm install --global pnpm@12.21.0`                         | `npm install --global pnpm@12.21.0`                |
| Task       | 3.54.0  | `winget install --id Task.Task --version 3.54.0`            | `brew install go-task`                             |
| Docker     | 最新版  | `winget install --id Docker.DockerDesktop`                  | `brew install --cask docker`                       |
| gitleaks   | 8.30.1  | `winget install --id Gitleaks.Gitleaks --version 8.30.1`    | `brew install gitleaks`                            |
| actionlint | 1.7.12  | `winget install --id rhysd.actionlint --version 1.7.12`     | `brew install actionlint`                          |
| zizmor     | 1.32.0  | `winget install --id zizmor.zizmor --version 1.32.0`        | `brew install zizmor`                              |

- Node.js 的版本写在 `.nvmrc` 里，`fnm install` 和 `fnm use` 会读它；要让 fnm 进入仓库目录时自动切换，按 fnm 的说明在 shell 配置里加上 `fnm env --use-on-cd`。
- pnpm 的版本写在 `package.json` 的 `packageManager` 里，其他版本的 pnpm 运行时会自动切换到这个版本。
- Homebrew 只装最新版。装好后用 `task --version`、`gitleaks version`、`actionlint --version`、`zizmor --version` 看一下版本，和上表不一致时以上表为准，CI 用的也是上表的版本。
- 端到端测试在 Docker 容器里运行，运行前要先启动 Docker Desktop。

### 第一次运行

```sh
task setup
```

安装依赖、组件测试用的浏览器（Chromium 和 WebKit），以及 git hook。

### 本机的环境变量

本机开发用的环境变量和密钥放在 Vercel 项目 `vexto-staging` 的 Development 环境里；项目和它所在的团队写在 `scripts/env-pull.json` 里。第一次运行时，以及这些值有变化后，运行：

```sh
task env-pull
```

它用 Vercel CLI 把仓库链接到这个项目（写进 `.vercel/`），再把 Development 环境的值拉到 `.env.local`。`.vercel/` 和 `.env.local` 都不进 git。第一次用时 Vercel CLI 会先让你登录 Vercel。要用别的项目或团队时，改 `scripts/env-pull.json`，或者只在这一次传参数，例如 `task env-pull VERCEL_PROJECT=<项目> VERCEL_SCOPE=<团队>`；设成同名的环境变量也可以。

### 日常命令

```sh
task dev     # 启动开发服务器，地址是 http://localhost:3000
task check   # 跑本机的全部静态检查
```

### 测试

```sh
task test-unit                    # 单元测试
task test-component               # 组件测试（Chromium 和 WebKit）
task test-integration             # 集成测试
task test-security                # 安全测试
task test-migration               # 迁移测试
task test-e2e                     # 端到端测试，在固定版本的 Playwright 容器里运行
task test-smoke -- <地址>         # 对一个运行中的应用跑冒烟测试
```

测试命令后面可以用 `--` 接文件或测试工具的参数，只跑一部分，例如 `task test-unit -- src/features/health`。

全部命令和开发规则见 [`AGENTS.md`](AGENTS.md)。
