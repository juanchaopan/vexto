# 0012 测试

## 背景

- 兼容性指标是 iOS Safari 和 Android Chrome，没有性能指标。
- 前后端在同一个仓库里，一起部署。
- 项目有登录，用户之间的数据要隔离。
- 仓库公开，GitHub 标准运行机的 CI 分钟不限量。

## 比较过的方案

- 单元和组件：Vitest 加 Testing Library，组件在真实浏览器里跑；或者再加 Storybook。
- 集成：Vitest 加 Testcontainers 加 MSW；或者 Vitest 加 docker compose。
- 端到端：Playwright，手机尺寸的 WebKit 和 Chromium；或者平时只跑 Chromium。
- 自动安全扫描（ZAP）：不加；或者合并后跑。
- 运行时机：参考表的标准安排；或者提交前和推送前少跑一些。
- 本机范围：开 PR 前跑全部；或者只跑受影响的。
- 迁移测试：写；或者不写。
- 覆盖率下限：不设；或者设 80%。

## 决定

- 单元：Vitest。
- 组件：Vitest 浏览器模式加 Testing Library。
- 集成和安全用例：Vitest 加 Testcontainers 加 MSW。
- 端到端和冒烟：Playwright，在手机尺寸的 WebKit 和 Chromium 上各跑一遍；截图基线固定在 Playwright 的 Linux 容器里生成。
- 迁移测试：凡是改动已有表的脚本都写。
- 不做的：合同测试、性能测试、自动安全扫描、覆盖率下限。
- 运行时机按 `.docs/architecture.md` 的表；本机只跑代理判断受影响的测试，CI 总是跑全部。

## 理由

- 测试工具和 Next.js、Vite 的生态一致。
- 集成测试用真实数据库，测的表结构就是部署的表结构。
- WebKit 能覆盖 iPhone 上的 Safari。

## 代价

- 本机只跑受影响的测试，代理漏判的测试要等 CI 才发现失败。
- 端到端测试跑两种浏览器，CI 时间大约翻倍。

## 何时重新考虑

CI 变得太慢时；或者本机漏判造成的 CI 失败变得频繁时，改为开 PR 前跑全部。

Last changed: #1 (2026-11-21)
