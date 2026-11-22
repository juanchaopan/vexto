# 0010 各组件在开发机和 CI 里怎么运行

## 背景

开发机是 Windows，装有 Docker；CI 用 GitHub 的 Linux 运行机。朗读模型约 400 MB，合成一篇文章要几分钟 CPU。MinIO 的容器镜像从 2025 年 10 月起不再更新。

## 比较过的方案

- 应用：本机直接用 Node 运行；或者在容器里运行。
- PostgreSQL：容器；或者 Neon 的开发分支。
- 对象存储：容器里的 S3 模拟器（Adobe S3Mock、Floci）；或者 Neon 开发分支上的存储桶。
- OpenAI 和 Clerk：CI 用测试替身、本机用开发密钥；或者本机和 CI 都用测试替身。
- 朗读合成：CI 里跑真实的模型；或者用测试替身，真实合成由 staging 的冒烟测试检查。

## 决定

- 应用、收集任务和朗读服务：本机直接用 Node 运行；模型由一个 Task 命令按固定版本从 Hugging Face 下载到不提交的目录并核对校验和，ffmpeg 装在本机。本机的 Web 应用直接调用本机的朗读服务，不带身份令牌。
- PostgreSQL：用 `postgres:18` 容器，测试命令自己起停一次性的容器。
- 对象存储：Adobe S3Mock 容器，测试命令自己起停。
- OpenAI 和 Clerk：CI 里 OpenAI 用 MSW 测试替身、Clerk 用它的测试模式和 @clerk/testing；本机连真实的 OpenAI 和 Clerk 开发实例，密钥放在不提交的 `.env.local` 里。
- 朗读合成：CI 里用测试替身，返回固定的音频夹具；Cloud Run 的镜像在 CI 里只构建不推送；真实的合成由 staging 的冒烟测试检查。
- Cloud Scheduler 不在本机运行，需要时手动运行收集任务。

## 理由

- 开发反馈快。
- 不联网也能跑测试，不占 Neon 和 Google Cloud 的免费额度。
- CI 不花钱，也不依赖外网，不用每次下载 400 MB 的模型。
- S3Mock 专门用于测试，维护活跃，Apache-2.0，lingocurrent 也选了它。

## 代价

- S3Mock 不校验预签名地址的签名，这一点由单元测试和 staging 的冒烟测试确认。
- 本机调用 OpenAI 要花少量费用。
- CI 发现不了真实模型的问题，要等部署到 staging 后的冒烟测试。

## 何时重新考虑

模拟器和 Neon 的行为差异造成问题时；朗读合成的问题经常要到 staging 才发现时。

Last changed: #3 (2026-11-22)
