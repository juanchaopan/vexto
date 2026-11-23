# 0015 平台设置、环境变量和密钥

## 背景

- 公开仓库在 GitHub 的任何套餐下都强制执行分支规则和必过检查，也支持按环境保存密钥。
- 应用运行在 Vercel 上，运行时只能读 Vercel 项目里的环境变量；收集任务和朗读服务运行在 Google Cloud Run 上，读 Cloud Run 的环境变量和 Secret Manager。
- GitHub 的密钥写进去以后读不回来，所以本机开发用的值不能只放在 GitHub。
- 参考项目 lingocurrent 部署时把密钥放进命令行参数，在运行机的进程列表里看得到；所有环境共用一个 OpenAI 密钥。
- Vercel 不允许命令行登录的会话创建令牌。
- 现在只有 staging。

## 比较过的方案

- 分支规则：按工作流的标准设置；或者同样的规则，但允许项目所有者绕过。
- 远程 issue 分支：永久保留；或者合并后删除。
- App：只装 Renovate；或者再装 Claude GitHub App。
- 值的存放：
  - 运行时的值只放在 Vercel 项目里，GitHub 环境只放部署用的令牌和 ID；
  - 全部放在 GitHub 环境里，部署时经标准输入同步到 Vercel 和 Google Cloud；
  - 全部放在 GitHub 环境里，部署时用 `vercel deploy --env` 传给 Vercel。
- 本机开发的值：放在 `vexto-staging` 的 Development 环境，用 `vercel env pull` 取；或者只在本机的 `.env.local` 里手工维护。
- OpenAI 密钥：每个环境一个；或者共用一个。

## 决定

- main 用规则集保护：
  - 必须走 PR；
  - 必过检查全部通过，并且分支和 main 同步；
  - 必须解决所有评审对话；
  - 只允许 squash 合并；
  - 禁止强推和删除；
  - 没有旁路用户。
- 远程 issue 分支永久保留。
- 打开密钥扫描、推送保护和 Dependabot 漏洞提醒。
- 只装 Mend Renovate App。
- staging 和 production 的全部变量和密钥，都以 GitHub 环境 `staging`、`production` 为准。部署任务在构建之前，把运行时的值经标准输入写进该目标 Vercel 项目的 Production 环境，密钥写成 Sensitive；Cloud Run 用的密钥经标准输入写进该目标 Google Cloud 项目的 Secret Manager，值没变就不写新版本，写了新版本就删掉旧版本；变量写成 Cloud Run 的环境变量。
- 本机开发的值放在 Vercel 项目 `vexto-staging` 的 Development 环境，用 `task env-pull` 生成 `.env.local`。
- OpenAI 密钥每个环境一个。
- `VERCEL_TOKEN` 由项目所有者在 Vercel 网页上新建，每个目标一个。
- 登录 Google Cloud 不用长期密钥，见 0020。

## 理由

- 规则由平台强制执行，网站上的操作也绕不过去。
- 保留分支，留下每个步骤的提交记录。
- 每个目标的值只在一个地方修改，staging 的值不会被用到生产上。
- 值走标准输入，不出现在命令行参数和日志里。
- 每个环境一个 OpenAI 密钥：泄露了只换一个，费用也能分开看。
- Secret Manager 免费 6 个活动版本，Cloud Run 只用 3 个密钥，删掉旧版本就一直在免费额度以内。

## 代价

- 紧急情况下也只能走 PR。
- 令牌到期前要换新的。
- Vercel 和 Secret Manager 里保存着副本，有人在网页上改了值，下次部署会被覆盖。
- Neon 集成在 Vercel 里自动加的数据库变量，可能不允许覆盖；如果不行，要回到 architect 重新决定。
- 本机的值放在 Vercel，不在 GitHub。

## 何时重新考虑

有了其他贡献者，或者搭建生产环境时。

Last changed: #3 (2026-11-22)
