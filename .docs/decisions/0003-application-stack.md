# 0003 应用技术栈

## 背景

团队熟悉 TypeScript、React、Next.js 和 Node.js。截至 2026-11-21 的最新版本：Next.js 16.4.6，Node.js 26 LTS，TypeScript 7.0.2，typescript-eslint 8.73.0（支持的 TypeScript 低于 6.1），ESLint 10，pnpm 12.21.0。eslint-config-next 16.4.6 自带的 eslint-plugin-react、eslint-plugin-import 和 eslint-plugin-jsx-a11y 只支持到 ESLint 9。

## 比较过的方案

- 框架：Next.js 16，或者 React Router 8 的框架模式。
- TypeScript：6.0.3 搭配 ESLint，或者 7.0.2 搭配 Oxlint。
- 包管理器：pnpm 12，或者 npm 11。
- 任务运行器：Task、just、Make。

## 决定

- Next.js 16（App Router），Node.js 26 LTS，TypeScript 6.0.3，ESLint 9，pnpm 12。
- 任务运行器用 Task。

## 理由

- Next.js 团队熟悉，部署到 Vercel 最省事。
- TypeScript 6 和 ESLint 9 能和 typescript-eslint、eslint-config-next 一起用。
- pnpm 安装快、依赖管理严格。
- Task 是单个可执行文件，在 Windows 上不用 POSIX shell 也能直接运行。

## 代价

- TypeScript 和 ESLint 暂时都不是最新的大版本。
- 开发机上的 pnpm 要升级到 12。
- 每台开发机都要装 Task。

## 何时重新考虑

typescript-eslint 支持 TypeScript 7 时，升级 TypeScript；eslint-config-next 自带的插件支持 ESLint 10 时，升级 ESLint。

Last changed: #1 (2026-11-21)
