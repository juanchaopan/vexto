# 0004 AI 服务

## 背景

查词和生成选项要用 AI，费用由项目所有者承担。比较过的价格是每百万 token 的输入和输出价格，每月按约 4500 次查词估算。

## 比较过的方案

- 模型：
  - Claude Opus 5.5：每月约 36 美元；
  - Claude Sonnet 5.5：约 18 美元；
  - Claude Haiku 5.5：约 1 美元；
  - OpenAI GPT-6 Luna（`gpt-6-luna`，输入 0.10 美元、输出 0.50 美元，上下文 105 万 token）：约 1 美元；
  - OpenAI GPT-5.6 Luna：约 2.5 美元。
- 接入方式：服务商的官方 SDK 直接调用，或者 Vercel AI SDK 和 AI Gateway。

## 决定

用 OpenAI 的 `gpt-6-luna`，服务端用 OpenAI 官方 TypeScript SDK 直接调用，不经过网关。模型名放在配置里，不写死在代码里。

## 理由

- 项目所有者选了 Luna 系列的最新一代，又便宜又够用。
- 直接调用少一层依赖，和参考项目 lingocurrent 的设计一致。

## 代价

- 以后要换服务商时，调用代码要跟着改。
- 生僻用法和习语的解释质量，要在查词功能里验证。

## 何时重新考虑

查词质量不够、价格变化，或者 OpenAI 发布了新一代的低价模型时。

Last changed: #1 (2026-11-21)
