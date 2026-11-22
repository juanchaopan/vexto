# 0010 各组件在开发机和 CI 里怎么运行

## 背景

开发机是 Windows，装有 Docker；CI 用 GitHub 的 Linux 运行机。

## 比较过的方案

- 应用：本机直接用 Node 运行；或者在容器里运行。
- PostgreSQL：容器；或者 Neon 的开发分支。
- 对象存储：容器里的 S3 模拟器；或者 Neon 开发分支上的存储桶。
- OpenAI 和 Clerk：CI 用测试替身、本机用开发密钥；或者本机和 CI 都用测试替身。

## 决定

- 应用：本机直接用 Node 运行。
- PostgreSQL：用 `postgres:18` 容器，测试命令自己起停一次性的容器。
- 对象存储：用容器里的 S3 模拟器，具体用哪个由第一个用到文件的功能 issue 定。
- OpenAI 和 Clerk：CI 里 OpenAI 用 MSW 测试替身、Clerk 用它的测试模式；本机连真实的 OpenAI 和 Clerk 开发实例，密钥放在不提交的 `.env.local` 里。

## 理由

- 开发反馈快。
- 不联网也能跑测试，不占 Neon 的免费额度。
- CI 不花钱，也不依赖外网。

## 代价

- 模拟器未必校验预签名地址，这一点要靠 staging 上的冒烟测试确认。
- 本机调用 OpenAI 要花少量费用。

## 何时重新考虑

模拟器和 Neon 的行为差异造成问题时。

Last changed: #1 (2026-11-21)
