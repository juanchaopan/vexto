# 设计文档

代码和测试按这里的设计来写。界面文字以截图和原型为准。

## 文档

| 文档            | 内容                                                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `screens.md`    | 每个画面上有什么、字段的规则和提示文字、状态、每种错误的显示、画面之间的跳转、重要的动画和手势                                                |
| `rules.md`      | 成员和条款、权限和数据隔离、取消资格、订阅源和收集流水线（含合成预算）、朗读和存储上限、AI 查词、生词本、间隔复习、并发、错误、通知、用量记录 |
| `data.md`       | 每张表的列、类型、约束、索引，以及删除时连带删掉什么                                                                                          |
| `interfaces.md` | 健康检查、Web 应用的 HTTP 接口和错误代码、朗读服务 `vexto-tts`、收集任务的启动方式、资源和退出码                                              |
| `terms.md`      | 使用条款的英文全文、许可证全文的出处和版本规则                                                                                                |
| `screens/`      | 原型渲染的截图                                                                                                                                |

## 截图

截图都是 390×844 CSS 像素、设备像素比 2 的整页图：页面有多高，图就有多高，固定在底部的播放器和浮窗画在页面底部。演示数据里“现在”是 2026 年 11 月 22 日 10:00，当前用户是演示账号 Alex Chen。

| 截图                                          | 画面           | 状态                                                                              |
| --------------------------------------------- | -------------- | --------------------------------------------------------------------------------- |
| `screens/01-sign-in.png`                      | 登录           | Clerk 托管的登录页：vexto、Continue with Google、Secured by Clerk                 |
| `screens/02-not-a-member.png`                 | 没有资格       | Google 账号不在名单里：邮箱、说明、Log out                                        |
| `screens/03-terms.png`                        | 使用条款       | 登录后第一次确认：条款全文，底部 Log out 和 I agree                               |
| `screens/04-license.png`                      | 许可证         | 公开的 `/license`：许可证全文，右上角关闭                                         |
| `screens/05-articles.png`                     | Articles       | 默认列表：按收集时间从新到旧，已加载 20 篇，底部 Load more                        |
| `screens/06-articles-filter-source.png`       | Articles       | Source 筛选浮层，勾了两个来源                                                     |
| `screens/07-articles-filter-category.png`     | Articles       | Source 筛选已生效，Category 筛选浮层打开                                          |
| `screens/08-articles-sort.png`                | Articles       | 排序浮层                                                                          |
| `screens/09-articles-search.png`              | Articles       | 搜索 satellite 的结果，All loaded                                                 |
| `screens/10-articles-search-empty.png`        | Articles       | 搜索没有结果：No articles match.                                                  |
| `screens/11-articles-loading-more.png`        | Articles       | 加载下一批：Loading…                                                              |
| `screens/12-articles-empty.png`               | Articles       | 还没有文章：No articles yet.，Play all 禁用                                       |
| `screens/13-reader.png`                       | 阅读页         | 未播放：← Articles、文章头、每句的播放键、文末署名、底部播放器                    |
| `screens/14-reader-playing.png`               | 阅读页         | 连续播放中，第 3 句高亮                                                           |
| `screens/15-reader-sentence-selected.png`     | 阅读页         | 选中第 5 句，它的按钮变成停止                                                     |
| `screens/16-reader-speed.png`                 | 阅读页         | 速度浮层，当前 1.25×                                                              |
| `screens/17-reader-continuous.png`            | 阅读页         | Play all 连续播放，播放器多出下一篇按钮                                           |
| `screens/18-reader-attribution.png`           | 阅读页         | 文末署名：来源、署名文字、作者、Original 链接、收集时间                           |
| `screens/19-reader-tap-to-continue.png`       | 阅读页         | 自动播放被拦下：Tap to continue                                                   |
| `screens/20-lookup-loading.png`               | 查词浮窗       | 正在解释：Explaining…，加号禁用                                                   |
| `screens/21-lookup.png`                       | 查词浮窗       | 结果：词条、读音按钮、词性、中文、例句 1 / 2                                      |
| `screens/22-lookup-example-2.png`             | 查词浮窗       | 例句 2 / 2                                                                        |
| `screens/23-lookup-word-audio-generating.png` | 查词浮窗       | 单词读音生成中：读音按钮转圈                                                      |
| `screens/24-lookup-audio-unavailable.png`     | 查词浮窗       | 读音不可用：Audio isn't available right now. 和 Retry                             |
| `screens/25-lookup-failed.png`                | 查词浮窗       | 解释失败：Couldn't explain this. 和 Retry                                         |
| `screens/26-lookup-too-long.png`              | 查词           | 选了超过 8 个词：Select up to 8 words.                                            |
| `screens/27-lookup-nested.png`                | 查词浮窗       | 嵌套的两层浮窗                                                                    |
| `screens/28-save-saved.png`                   | 保存           | 保存成功：加号变成对勾，Saved to Vocabulary.                                      |
| `screens/29-save-replace.png`                 | 保存           | 替换对话框：Replace saved word?，左右对比                                         |
| `screens/30-vocabulary.png`                   | Vocabulary     | All 标签：模式按钮和数字、Speak 写 Coming soon、默认按词 A–Z                      |
| `screens/31-vocabulary-new.png`               | Vocabulary     | New 标签                                                                          |
| `screens/32-vocabulary-ongoing.png`           | Vocabulary     | Ongoing 标签                                                                      |
| `screens/33-vocabulary-archived.png`          | Vocabulary     | Archived 标签，为空：No words match.                                              |
| `screens/34-vocabulary-search.png`            | Vocabulary     | 搜索 adjective（按词性）                                                          |
| `screens/35-vocabulary-swipe-half.png`        | Vocabulary     | 左滑删除的中间帧：卡片左移 40 像素                                                |
| `screens/36-vocabulary-swipe-open.png`        | Vocabulary     | 左滑打开：露出 80 像素的 Delete                                                   |
| `screens/37-vocabulary-delete-one.png`        | Vocabulary     | 单个删除确认：Delete word?                                                        |
| `screens/38-vocabulary-long-press.png`        | Vocabulary     | 长按进入选择模式：1 selected                                                      |
| `screens/39-vocabulary-multi-select.png`      | Vocabulary     | 多选：3 selected                                                                  |
| `screens/40-vocabulary-batch-delete.png`      | Vocabulary     | 批量删除确认：Delete 3 words?                                                     |
| `screens/41-vocabulary-empty.png`             | Vocabulary     | 生词本为空                                                                        |
| `screens/42-card-detail.png`                  | 词卡详情       | 词条、读音、词性、中文、例句区、三个进度组                                        |
| `screens/43-review-spell.png`                 | Spell 复习     | 听写题：中文、词性、Play example、挖空例句、输入框、Round 3、Submit               |
| `screens/44-review-spell-correct.png`         | Spell 复习     | 答对：Correct · Next review in 4 days                                             |
| `screens/45-review-spell-wrong.png`           | Spell 复习     | 答错：resilient · Try again in 10 mins                                            |
| `screens/46-review-translate.png`             | Translate 复习 | 英文词、词性、例句、四个中文选项                                                  |
| `screens/47-review-translate-answered.png`    | Translate 复习 | 答对后选项只读                                                                    |
| `screens/48-review-empty.png`                 | 复习           | 没有题：No reviews due. Next review in 4 hours.                                   |
| `screens/49-review-offline.png`               | 复习           | 断网提交：Not saved. Reconnect to check the result.，Retry                        |
| `screens/50-review-changed.png`               | 复习           | 别的设备改了这个词：This word changed on another device.                          |
| `screens/51-account-menu.png`                 | 账号菜单       | Terms、License、Log out                                                           |
| `screens/52-articles-load-failed.png`         | Articles       | 第一批加载失败：列表位置是 Couldn't load articles. 和 Retry，Play all 禁用        |
| `screens/53-articles-load-more-failed.png`    | Articles       | 下一批加载失败：已加载的保留，Load more 位置是 Couldn't load more articles.       |
| `screens/54-reader-play-failed.png`           | 阅读页         | 播放失败：短提示 Couldn't play this article. 和 Retry                             |
| `screens/55-reader-article-gone.png`          | Articles       | 文章已被淘汰：短提示 This article is no longer available.                         |
| `screens/56-lookup-offline.png`               | 查词浮窗       | 断网：You're offline. Connect to look up words. 和 Retry                          |
| `screens/57-lookup-refresh-failed.png`        | 查词浮窗       | 刷新例句失败：原例句保留，短提示 Couldn't get a new example. 和 Retry             |
| `screens/58-save-failed.png`                  | 保存           | 保存失败：浮窗保持打开，短提示 Couldn't save the word. 和 Retry                   |
| `screens/59-replace-failed.png`               | 保存           | 替换失败：对话框保持打开，短提示 Couldn't replace the word. 画在遮罩上面          |
| `screens/60-vocabulary-delete-failed.png`     | Vocabulary     | 批量删除失败：仍在选择模式，3 个词保持选中，短提示 Couldn't delete. Try again.    |
| `screens/61-terms-accept-failed.png`          | 使用条款       | 确认失败：短提示 Couldn't save your answer. 和 Retry                              |
| `screens/62-terms-read-only.png`              | 使用条款       | 从账号菜单打开的只读条款：右上角关闭，版本行下面是 Accepted Nov 22.，没有底部按钮 |
| `screens/63-review-translate-wrong.png`       | Translate 复习 | 答错：所选项标红带叉，正确选项的中文 · Try again in 10 mins                       |
| `screens/64-reader-select-words-helper.png`   | 阅读页         | 选词辅助浮层：Sentence、From、To 和 Look up                                       |
| `screens/65-vocabulary-round-filter.png`      | Vocabulary     | Spell round 筛选浮层：Round 1–7 和 Complete                                       |
| `screens/66-vocabulary-sort.png`              | Vocabulary     | 排序浮层：7 个字段和两个方向                                                      |
| `screens/67-vocabulary-load-failed.png`       | Vocabulary     | 第一批加载失败：词卡位置是 Couldn't load words. 和 Retry                          |
| `screens/68-vocabulary-load-more-failed.png`  | Vocabulary     | 下一批加载失败：已加载的保留，Load more 位置是 Couldn't load more words.          |
| `screens/69-reader-load-failed.png`           | 阅读页         | 文章加载失败：保留 ← Articles，Couldn't load this article. 和 Retry，没有播放器   |
| `screens/70-card-detail-load-failed.png`      | 词卡详情       | 词卡加载失败：保留关闭按钮，Couldn't load this word. 和 Retry                     |
| `screens/71-review-load-failed.png`           | 复习           | 题面加载失败：保留模式名和关闭按钮，Couldn't load the next review. 和 Retry       |
| `screens/72-review-submit-failed.png`         | Spell 复习     | 提交失败（不是断网）：答案保留可改，短提示 Couldn't save your answer. 和 Retry    |

## 原型

原型的源码在分支 `scratch/3-reading-and-review` 的 `prototype/` 目录里，这个分支不合并：

- `prototype/vexto-phone.html`：单文件原型，浏览器直接打开就能像在手机上一样点按（左滑、长按、横滑例句要用触摸输入，浏览器开发者工具的手机模拟即可）。地址后面加 `#状态名` 直接进入某个状态，例如 `vexto-phone.html#lookup-nested`；脚本里 `window.vexto.presets` 列出全部状态，`window.vexto.show('状态名')` 切换。
- `prototype/render.mjs`：把每个状态渲染成 `prototype/screens/` 里的 PNG。

原型里的许可证全文取自 `supertone-oss-archive/supertonic-3@aafc6e32416a594460b32413efc49d7fe4ce6d46` 的 LICENSE。

渲染需要 Playwright 和它的 Chromium（`task setup` 会装好）。在那个分支的仓库根目录运行：

```sh
node prototype/render.mjs                         # 全部状态，先清空 screens/ 里的 PNG
node prototype/render.mjs --only reader,lookup    # 只渲染列出的状态
```

当前目录没有装依赖时，用环境变量 `PLAYWRIGHT_DIR` 指向一个 `node_modules` 里有 `playwright` 的目录。脚本同时检查每个状态里可见的按钮、链接和输入框是否至少 44×44 CSS 像素，有不达标的或页面报错时退出码为 1。渲染好的截图复制到这里的 `screens/`。

Last changed: #3 (2026-11-22)
