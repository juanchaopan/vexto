# 0014 依赖更新

## 背景

- 项目要更新的有 npm 包、Node 版本、`packageManager` 里的 pnpm 和 GitHub Actions。
- zizmor 要求 action 固定到提交 SHA。

## 比较过的方案

- 工具：Renovate（免费的 Mend 托管 App）；或者 Dependabot。
- 节奏：每周一次，小版本合并成组；或者每个依赖单独开 PR。

## 决定

- 用 Renovate，配置基于 `config:best-practices`。
- 每周一开 PR：所有非大版本的升级合并成一个 PR，每个大版本单独一个 PR；安全更新随时开。
- PR 标题：产品运行时的依赖用 `fix(deps)`，其余用 `chore(deps)`。
- 保留 Dependabot 漏洞提醒，关掉 Dependabot 的版本更新。

## 理由

- Renovate 能更新 Node 和 pnpm 的版本，能把 action 固定到 SHA，只升 LTS 大版本，还能等新版发布几天后再升。
- 按周分组，PR 数量少。

## 代价

- 要装一个 App。
- 免费托管的 App 每 4 小时才运行一次。

## 何时重新考虑

Renovate 的托管服务条款变化，或者 PR 太多、太少时。

Last changed: #1 (2026-11-21)
