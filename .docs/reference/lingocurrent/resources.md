# lingocurrent 分析：外部资源

2026-11-21 检查。Vercel 和 Neon 用项目所有者的账号登录后只读检查；其余资源只来自仓库、GitHub 设置和公开地址。没有读取任何密钥的值。

## GitHub（`juanchaopan/lingocurrent`，公开）

- 仓库级密钥：`OPENAI_API_KEY`（所有环境共用一个）、`VERCEL_TOKEN`。
- 仓库级变量：`DEPLOY_ENABLED=true`、`PREVIEW_ENABLED=false`。
- 环境 `staging` 和 `production`，都只允许 main 部署，没有指定审批人。
  - 每个环境的密钥：`DATABASE_URL`、`CLERK_SECRET_KEY`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`。
  - 每个环境的变量：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`S3_BUCKET`、`S3_ENDPOINT`、`S3_REGION`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`。
- 没有 Claude 评审需要的 `ANTHROPIC_API_KEY` 或 `CLAUDE_CODE_OAUTH_TOKEN`，所以 AI 评审从来没有真正运行过。
- 预览部署要用的 `NEON_PROJECT_ID`、`NEON_SEED_BRANCH`、`NEON_API_KEY` 和 `preview` 环境都还没建。

## Vercel（检查过）

团队 ID `juanchaopan1`，团队名 juanchaopan，Hobby 套餐。

| 项目                      | 项目 ID                            | 函数地区 | Node | 框架设置                                                | Git    | 部署                                                                            |
| ------------------------- | ---------------------------------- | -------- | ---- | ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| `lingocurrent-staging`    | `prj_NgrKbNMNYpm9D2MyIdjvnNIHxHLS` | iad1     | 24.x | Next.js，`pnpm build`，`pnpm install --frozen-lockfile` | 未连接 | 2026-11-16 部署过一次，状态 Ready，别名 https://lingocurrent-staging.vercel.app |
| `lingocurrent-production` | —                                  | iad1     | 24.x | 同上                                                    | 未连接 | 从未部署                                                                        |

- 团队下没有登记任何域名，所以计划给生产用的 `lingocurrent.dpdns.org` 还没有加到 Vercel 上。
- 同一个团队里还有其他项目（thinklet、education），和 lingocurrent 无关。

## Neon（检查过）

组织 `juanchao`（ID `org-nameless-salad-09414711`），Free 套餐。

| 项目                         | 项目 ID               | 地区          | PostgreSQL | 分支                                                                                   | 数据库                          | 存储桶                                |
| ---------------------------- | --------------------- | ------------- | ---------- | -------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| `lingocurrent-staging-db`    | `bold-water-71503400` | aws-us-east-2 | 18         | `production`（默认，`br-cool-king-bdzirfp0`）、`vercel-dev`（`br-blue-pine-bdh140tz`） | `neondb`，所有者 `neondb_owner` | `lingocurrent-staging-audio`，私有    |
| `lingocurrent-production-db` | `misty-art-39773764`  | aws-us-east-2 | 18         | `production`（默认，`br-mute-sea-bdqamwb7`）、`vercel-dev`（`br-dry-credit-bdhgo73f`） | `neondb`，所有者 `neondb_owner` | `lingocurrent-production-audio`，私有 |

- 每个分支的逻辑大小约 32 MB，这是空库的基础大小，说明没有业务数据，和“迁移从没在这两个库上跑过”的记录一致。
- 计算单元固定 0.25 CU，空闲后自动休眠；历史保留 6 小时。
- `vercel-dev` 分支是 Vercel Marketplace 接入时自动建的，用于本地开发。
- 对象存储的地址按分支区分，是 Neon 分配的 S3 端点（地区 `us-east-2`）。
- 同一个组织里还有其他项目（thinklet、education），和 lingocurrent 无关。

## 没有登录检查的资源

| 资源                          | 用途                                         | 从仓库和 GitHub 能看到的                                                                                                                                     |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Clerk                         | 受邀 Google 登录                             | 实例 `lingocurrent-staging-auth`（开发实例）和 `lingocurrent-production-auth`（生产实例）；生产实例的邀请邮件被 Gmail 以 `550 5.7.1` 拒收，加了 DMARC 也没用 |
| Google Cloud OAuth            | 给两个 Clerk 实例提供 Google 登录            | 两个实例共用一个 OAuth 客户端，违反 Google 的规定，但已被接受；GCP 的账单已关闭                                                                              |
| OpenAI                        | 计划用于查词、选项生成和备选的朗读和语音判定 | 只有 `OPENAI_API_KEY`，从来没有调用过                                                                                                                        |
| 域名 `lingocurrent.dpdns.org` | 生产地址                                     | 在 DigitalPlat 注册，2027-11-16 到期；DNS 在 Cloudflare Free；根域名指向 Vercel，但 Vercel 上没有登记这个域名，访问返回 404 `DEPLOYMENT_NOT_FOUND`           |
| Anthropic / Claude GitHub App | AI 代码评审                                  | 没有配置凭据                                                                                                                                                 |
| 内容来源                      | RSS                                          | 只是候选：NASA 的技术、航空、新闻稿 feed，Hackaday，NIH Research Matters；NOAA 和 NSF 是备选；没有确定的来源清单                                             |

Last changed: #1 (2026-11-21)
