# 0016 文章朗读的声音

## 背景

文章朗读是关键功能。参考项目 lingocurrent 的 spike 比较过四个样本：

| 样本 | 引擎和声音 |
|---|---|
| A | Kokoro `af_heart` |
| B | Kokoro `am_michael` |
| C | Supertonic F1 |
| D | Supertonic M1 |

项目所有者选了 Supertonic F1。压缩成 MP3 32 kbps 后，大小只有 WAV 的约 4.6%。但那个 spike 没有在云上验证过：按本机的测量，在 Vercel Hobby 上生成整篇文章的朗读，CPU 额度不够；Supertonic 的模型约 400 MB，也可能超过 Vercel 的包大小上限。

## 比较过的方案

- 沿用 Supertonic F1、MP3 32 kbps；或者开新的 spike 重新比较声音。
- 朗读形式：
  - 整篇音频，可以逐句播放并高亮；
  - 只能整篇播放；
  - 点哪句读哪句。

## 决定

- 声音用 Supertonic F1，单声道 MP3 32 kbps。
- 每篇文章生成整篇音频和每句话的时间轴，可以逐句播放并高亮。
- 音频在哪里生成、Speak 用什么判定，等项目所有者在 lingocurrent 那边跟进的 spike 有结论后，回到这一步再定。

## 理由

项目所有者已经试听并选定了这个声音和音质。32 kbps 时一分钟的音频约 240 KB，5 GB 的存储能放约 3900 篇 5 分钟长的文章。

## 代价

- Supertonic 的仓库已经归档，停止维护，许可证是 OpenRAIL-M。
- 生成音频的地方可能要另找托管，比如 GitHub Actions 定时任务或者容器主机。

## 何时重新考虑

spike 证明 Supertonic 跑不起来或者成本太高，或者它的许可证不允许这样用时。

Last changed: #1 (2026-11-21)
