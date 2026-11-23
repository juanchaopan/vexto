# 0007 代码结构

## 背景

一份代码里会有阅读、查词、生词本、复习、收集、朗读等多个功能，有两个运行的地方：Vercel 上的 Next.js 应用，和 Google Cloud Run 上的收集任务、朗读服务和结算保护（见 0017）。

## 比较过的方案

- 结构：按功能分模块、模块内再分层；或者按技术类型分目录。
- Cloud Run 的代码：和 Web 应用放在同一个仓库、共用 `features/`；或者另开一个包。
- 测试：按层规定测试类型；或者不按层规定。
- 命名：全部小写加连字符；或者组件文件用 PascalCase。

## 决定

- `src/app/` 只放 Web 应用的路由和页面入口；`src/worker/` 只放 Cloud Run 的入口；`src/features/<功能>/` 下分 `domain`、`server`、`ui` 三层，对外只通过 `index.ts`；`src/lib/` 放共用代码；随版本发布的配置（如订阅源）放在 `config/`。
- 依赖方向是 app → features → lib 和 worker → features → lib，app 和 worker 互不引用。只在 Cloud Run 里用的库不能被 app 引到。`domain` 不依赖框架和外部服务，不允许循环依赖。这些规则由 dependency-cruiser 检查。
- 每层的测试：`domain` 写单元测试，`server` 写用真实数据库的集成测试，有交互的 `ui` 写组件测试，`worker` 的入口写集成测试，页面流程写端到端测试。测试文件放在被测文件旁边。
- 文件名全部小写加连字符。

## 理由

- 一个功能的代码都在一处，Web 应用和 Cloud Run 共用同一套业务逻辑。
- 业务规则能单独测试。
- 重的库不会进 Vercel 的函数包。
- 小写文件名在 Windows 和 Linux 之间不会因为大小写出问题。

## 代价

- 跨功能复用要先想清楚放在哪里。
- 规则多，新代码要照着写。

## 何时重新考虑

功能多到一个模块难以管理，或者规则频繁被迫例外时。

Last changed: #3 (2026-11-22)
