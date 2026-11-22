# 0020 登录 Google Cloud 和调用朗读服务的身份

## 背景

GitHub 的部署任务要推送镜像、更新 Cloud Run 和写 Secret Manager；Web 应用（Vercel）要调用朗读服务。朗读服务不能让别人随便调用，否则费用算在项目所有者头上。项目所有者要求用 Google 官方的认证方式。

## 比较过的方案

- 朗读服务：
  - 自己生成一个共享密钥；
  - Cloud Run 的 IAM 认证，Web 应用保存服务账号的 JSON 密钥；
  - Cloud Run 的 IAM 认证，Web 应用用 Vercel 的 OIDC 令牌经 Google 身份联合换取身份令牌。
- 部署任务：Workload Identity Federation；服务账号的 JSON 密钥。

## 决定

- 朗读服务和结算保护设成需要认证，只有拿到 Run Invoker 权限的服务账号能调用。
- Web 应用用 Vercel 的 OIDC 令牌，经身份联合换成只有 `vexto-tts` 调用权限的服务账号；提供方只接受团队 `juanchaopan1` 的项目 `vexto-staging` 的 Production 环境。
- 部署任务用 Workload Identity Federation，提供方只接受本仓库、GitHub 环境 `staging` 的令牌。
- 每个服务账号只拿到它要用的权限。

## 理由

- 两边都是 Vercel 和 Google 官方支持的做法，不存任何长期密钥，泄露不了。
- 认证由 Google 在请求到达服务之前完成。

## 代价

- 配置步骤多，出了问题比较难查。
- Vercel 项目要开启 OIDC 联合。

## 何时重新考虑

Vercel 或 Google 改变身份联合的支持方式时。

Last changed: #3 (2026-11-22)
