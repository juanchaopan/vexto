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
| lame       | 最新版  | `winget install --id LAME.LAME`                             | `brew install lame`                                |
| gitleaks   | 8.30.1  | `winget install --id Gitleaks.Gitleaks --version 8.30.1`    | `brew install gitleaks`                            |
| actionlint | 1.7.12  | `winget install --id rhysd.actionlint --version 1.7.12`     | `brew install actionlint`                          |
| zizmor     | 1.32.0  | `winget install --id zizmor.zizmor --version 1.32.0`        | `brew install zizmor`                              |

- Node.js 的版本写在 `.nvmrc` 里，`fnm install` 和 `fnm use` 会读它；要让 fnm 进入仓库目录时自动切换，按 fnm 的说明在 shell 配置里加上 `fnm env --use-on-cd`。
- pnpm 的版本写在 `package.json` 的 `packageManager` 里，其他版本的 pnpm 运行时会自动切换到这个版本。
- Homebrew 只装最新版。装好后用 `task --version`、`gitleaks version`、`actionlint --version`、`zizmor --version` 看一下版本，和上表不一致时以上表为准，CI 用的也是上表的版本。
- lame 给本机运行的收集任务和朗读服务把合成的声音编码成 MP3；Cloud Run 的镜像里装的是 Debian 的 lame，不用本机的这个。
- 集成测试、安全测试、端到端测试和 Cloud Run 镜像的构建都要用 Docker，运行前要先启动 Docker Desktop。
- 只有把朗读模型复制到 Google Cloud 时（`task model-upload`）才要 gcloud CLI：`winget install --id Google.CloudSDK` 或 `brew install --cask google-cloud-sdk`。

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

### 朗读模型

收集任务和朗读服务用 Supertonic 3 合成朗读。模型固定在 `config/speech-model.json` 写的 Hugging Face 版本，约 400 MB，不进 git。第一次运行它们之前下载一次：

```sh
task model-download
```

文件下载到 `.models/supertonic-3/<版本>/`，每个文件都按 `config/speech-model.json` 里的大小和 SHA-256 核对，对不上的不会留下；已经下载好、核对通过的文件不再下载。

### 日常命令

```sh
task dev                        # 启动开发服务器，地址是 http://localhost:3000
node src/worker/collect.ts      # 运行一次收集任务
node src/worker/tts.ts          # 启动朗读服务，监听 PORT（默认 8080）
task check                      # 跑本机的全部静态检查
task build                      # 构建 Web 应用和 Cloud Run 的镜像
```

本机运行收集任务和朗读服务时，`MODEL_DIR` 设成下载好的模型目录，例如 `.models/supertonic-3/<版本>`。

### 测试

```sh
task test-unit                    # 单元测试
task test-component               # 组件测试（Chromium 和 WebKit）
task test-integration             # 集成测试，自己起停一次性的 PostgreSQL 和 S3Mock 容器
task test-security                # 安全测试，容器同上
task test-migration               # 迁移测试
task test-e2e                     # 端到端测试，在固定版本的 Playwright 容器里运行
task test-smoke -- <地址>         # 对一个运行中的应用跑冒烟测试
```

测试命令后面可以用 `--` 接文件或测试工具的参数，只跑一部分，例如 `task test-unit -- src/features/health`。

## 成员名单

只有名单里的人能用 vexto。名单存在每个部署目标的数据库里，由项目所有者在自己的电脑上管理：

```sh
task member -- add <邮箱> --target staging      # 加进名单；取消过的人重新设为有效
task member -- revoke <邮箱> --target staging   # 取消资格，删除这个人的个人数据
task member -- list --target staging            # 按加入时间列出名单
```

命令用 Neon CLI 取得目标数据库的连接地址，地址不会显示出来。第一次用之前先登录 Neon：`pnpm dlx neonctl@<版本> auth`，版本是 `Taskfile.yml` 里的 `NEON_CLI_VERSION`。每个目标对应的 Neon 项目、分支和数据库写在 `scripts/neon-targets.json` 里。

全部命令和开发规则见 [`AGENTS.md`](AGENTS.md)。
