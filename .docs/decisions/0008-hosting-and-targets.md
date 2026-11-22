# 0008 托管和部署目标

## 背景

- 参考项目 lingocurrent 在 Vercel 团队 `juanchaopan1`（Hobby）里已经有 `lingocurrent-staging` 和 `lingocurrent-production` 两个项目，在 Neon 组织 `juanchao`（Free）里有两个空库和两个私有存储桶，都在 aws-us-east-2。
- vexto 接替 lingocurrent。
- Vercel Hobby 的 cron 每天最多一次。Neon Free 每个项目 1 GB 存储、5 GB 对象存储。

## 比较过的方案

- 托管：
  - Vercel Hobby + Neon Free；
  - Vercel Pro（每月 20 美元）+ Neon Free；
  - 容器主机 + Neon Free。
- 资源：直接用 lingocurrent 现有的；或者在同一账号下新建。
- 名字：改成 vexto；或者保持原名。
- 函数地区：cle1；或者 iad1。
- 生产地址：先用 vercel.app 地址；沿用 lingocurrent.dpdns.org；或者换新域名。
- 基础设施：用命令行直接操作；或者用 OpenTofu。

## 决定

- 直接用 lingocurrent 的 Vercel 项目、Neon 项目和存储桶，有 staging 和生产两个目标，都是每月 0 美元。
- 函数地区设为 cle1，和数据库在同一个 AWS 地区。
- 本 issue 只搭 staging：Vercel 项目改名为 `vexto-staging`，Neon 项目改名为 `vexto-staging-db`，Node 版本改为 26.x。生产的改名、地址和密钥以后单独搭建。
- 用 `vercel` 和 `neon` 命令行直接创建和修改资源，执行过的操作写回 `.docs/architecture.md` 的部署目标一节。

## 理由

- 资源现成、免费，两个库都是空的，不需要迁移数据。
- 资源很少，用不着基础设施即代码。

## 代价

- 存储桶不能改名，名字里还是 lingocurrent。
- 在网页控制台里手工做的改动，不会被发现。
- vexto 部署之前，要先关掉 lingocurrent 的自动部署。
- Hobby 只适合个人、非商业用途。

## 何时重新考虑

需要更频繁的定时任务、商业化，或者免费额度不够时。

Last changed: #1 (2026-11-21)
