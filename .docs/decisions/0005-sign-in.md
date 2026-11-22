# 0005 登录

## 背景

只有项目所有者邀请的人能用。参考项目 lingocurrent 已经建好了两个 Clerk 实例：`lingocurrent-staging-auth` 是开发实例，`lingocurrent-production-auth` 是生产实例。vexto 接手它们。

## 比较过的方案

- 登录库：Better Auth、自己写会话、Auth.js，或者沿用 lingocurrent 的 Clerk 应用。
- 登录方式：受邀 Google 登录、项目所有者创建的邮箱加密码账号，或者两种都开。

## 决定

沿用 lingocurrent 的 Clerk 应用，只允许受邀的 Google 账号登录。服务端每次请求都确认用户仍在允许名单里。

## 理由

- 资源已经存在，不用自己处理密码。
- 项目所有者用一个名单就能控制谁能登录。

## 代价

- 依赖第三方服务。
- 有两个已知问题，都要在搭建生产环境时解决：
  - 生产实例的邀请邮件被 Gmail 拒收，可以改为直接把对方加进允许名单、不发邮件；
  - 两个实例共用一个 Google OAuth 客户端，违反 Google 的规定。

## 何时重新考虑

Clerk 的免费额度或条款变化，或者需要 Google 以外的登录方式时。

Last changed: #1 (2026-11-21)
