# 0005 登录

## 背景

只有项目所有者邀请的人能用。参考项目 lingocurrent 用 Clerk 做受邀 Google 登录，它有两个 Clerk 应用：staging 用的 `lingocurrent-staging-auth`（开发实例）和生产用的 `lingocurrent-production-auth`（生产实例），名字和设置都属于 lingocurrent。

## 比较过的方案

- 登录库：Better Auth、自己写会话、Auth.js，或者 Clerk。
- Clerk 应用：沿用 lingocurrent 的 Clerk 应用，或者给 vexto 建自己的 Clerk 应用。
- 登录方式：受邀 Google 登录、项目所有者创建的邮箱加密码账号，或者两种都开。

## 决定

- 用 Clerk，给 vexto 建自己的 Clerk 应用 `vexto`。它的开发实例给 staging 和本机开发用；生产用 `vexto` 的生产实例还是 lingocurrent 的 `lingocurrent-production-auth`，在搭建生产环境时决定。
- 只开 Google 登录，关掉密码和邮箱验证码登录。
- Clerk 上的注册是开放的，谁能用以每个目标数据库的成员表为准：服务端每次请求都确认用户仍在允许名单里。

## 理由

- 不用自己处理密码。
- 应用的名字、登录页和设置都属于 vexto，和停用的 lingocurrent 分开。
- 项目所有者用一个名单就能控制谁能登录，不用在 Clerk 上另管一份。

## 代价

- 依赖第三方服务。
- 任何 Google 账号都能在 Clerk 上注册成用户，只是不在名单里就用不了应用；Clerk 的用户列表里会有这样的用户。
- 有两个已知问题，都要在搭建生产环境时解决：
  - 生产实例的邀请邮件被 Gmail 拒收，可以改为直接把对方加进允许名单、不发邮件；
  - 两个实例共用一个 Google OAuth 客户端，违反 Google 的规定。

## 何时重新考虑

Clerk 的免费额度或条款变化，或者需要 Google 以外的登录方式时。

Last changed: #3 (2026-11-22)
