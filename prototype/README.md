# vexto 手机原型（#3）

这个目录是 #3（阅读、查词和复习）的界面原型，只在 `scratch/3-reading-and-review` 分支上，不合并。

- `vexto-phone.html`：可以直接用浏览器打开的单文件原型。它从 lingocurrent 已认可的 mockup（`lingocurrent-input-design.html`）而来，只保留手机触屏布局，颜色、字号、密度和组件沿用原稿，再按 #3 的设计决定补上 vexto 需要的画面。
- `render.mjs`：把每个状态渲染成 PNG。
- `screens/`：渲染出的截图，文件名是 `NN-状态名.png`，`NN` 是顺序号。

## 原型里的数据

- 演示数据和时间都是固定的：“现在”是 2026 年 11 月 22 日 10:00（设备本地时间）。日期在当年时不写年份。
- 文章来自五个订阅源：NASA Technology、NASA Aeronautics、NIH Research Matters、NIST News、Library of Congress 的 Inside Adams。标题和正文是为原型写的，不是原文。来源图标是配置里的一两个字母和颜色。
- 当前用户是演示账号 Alex Chen，头像字母由姓名算出。
- 播放是模拟的，每句 1.8 秒（1× 时），没有接真实音频；查词结果来自页面里的演示词典，约 0.7 秒后出现。
- 许可证全文按原文放在页面的 `<script type="text/plain" id="license-text">` 里（来自 `https://huggingface.co/Supertone/supertonic-3/raw/main/LICENSE`），条款页的使用限制从其中的 Attachment A 读出。许可证页按手机宽度重排段落，文字不变。
- 图标是 Lucide 图标的形状，直接写在页面里，离线也能显示。

## 失败的画法

- 操作失败用顶栏下方的白色小提示框（和 `28-save-saved.png` 同一个位置和样式）。能重试的失败在提示框里带 Retry 按钮；带 Retry 的提示框不会自动消失，点 Retry、出现新提示或换页时才消失。对话框开着时提示框画在对话框里，盖在遮罩上面，Retry 仍能点。
- 列表、文章、词卡或下一道复习题加载失败时，失败信息和 Retry 画在内容本来的位置；下一批加载失败时画在 Load more 的位置。
- 提示文字是英文短句，句首大写，以句号结尾。

## 怎样进入某个状态

- 直接操作：打开 `vexto-phone.html`，像在手机上一样点按。左滑词卡露出 Delete、长按词卡进入选择模式、横滑例句切换，需要触摸输入（浏览器开发者工具的手机模拟即可）。
- 断网：在浏览器开发者工具里把网络切到 Offline，再查词、换例句、收藏、替换、删除、同意条款、播放文章或加载下一批，会看到对应的失败画面。
- 用地址：在地址后面加 `#状态名`，例如 `vexto-phone.html#lookup-nested`。每个状态都从一份新的演示数据开始，动画和过渡关闭。
- 用脚本：`window.vexto.presets` 列出全部状态（顺序和名字），`window.vexto.show('状态名')` 切换到某个状态。

## 怎样渲染

需要 Playwright 和它的 Chromium（`task setup` 会装好）。在仓库根目录运行：

```sh
node prototype/render.mjs                         # 全部状态，先清空 screens/ 里的 PNG
node prototype/render.mjs --only reader,lookup    # 只渲染列出的状态
```

脚本先在当前仓库找 Playwright；如果当前目录没有装依赖，用环境变量 `PLAYWRIGHT_DIR` 指向一个 `node_modules` 里有 `playwright` 的目录。

每个状态按 390×844 CSS 像素、设备像素比 2 打开，再把视口拉到整页高度后截图，所以图片是整页，固定在底部的播放器和浮窗画在页面底部。脚本同时检查每个状态里可见的按钮、链接和输入框是否至少 44×44 CSS 像素（卡片标题由整张卡片承担点击，复选框和单选框由 44 像素高的标签承担，进度条横跨播放器），有不达标的或页面报错时退出码为 1。

## 状态清单

| 文件                                  | 画面           | 显示什么                                                                                                                                                                            | 在原型里怎样到达                                                            |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `01-sign-in.png`                      | 登录           | Clerk 托管登录页的占位：vexto、Continue with Google、Secured by Clerk                                                                                                               | 账号菜单 → Log out                                                          |
| `02-not-a-member.png`                 | 没有资格       | Google 账号不在邀请名单：显示邮箱、说明、Log out                                                                                                                                    | 只能用 `#not-a-member`                                                      |
| `03-terms.png`                        | 使用条款       | 登录后全屏英文条款：AI 声音（Supertonic 3，OpenRAIL-M）、许可证链接、Attachment A 的 (a)–(m) 原文、分享音频要注明机器生成、文章只用于语言学习且不是医疗建议；底部 Log out / I agree | `#terms`；点 I agree 进入应用                                               |
| `04-license.png`                      | 许可证         | 公开的 `/license` 页面：许可证全文，右上关闭                                                                                                                                        | 条款页的 Read the full license、账号菜单的 License                          |
| `05-articles.png`                     | Articles       | 默认列表：按采集时间倒序，已加载 20 篇，底部 Load more；有访问时才显示 Last visited                                                                                                 | 打开页面；顶部文章图标                                                      |
| `06-articles-filter-source.png`       | Articles       | Source 筛选浮层，五个来源带字母图标，勾了两个                                                                                                                                       | 点 Source 筛选（楼房图标）                                                  |
| `07-articles-filter-category.png`     | Articles       | Source 已生效（图标高亮、10 articles），Category 筛选浮层打开                                                                                                                       | Source 选 NASA Technology、NIST News → Apply → 点 Category 筛选（标签图标） |
| `08-articles-sort.png`                | Articles       | 排序浮层：Collected、Last visited、Article、Source、Category，升序/降序                                                                                                             | 点右侧排序图标                                                              |
| `09-articles-search.png`              | Articles       | 搜索正文 “satellite”，2 篇结果，All loaded                                                                                                                                          | 在搜索框输入 satellite 并搜索                                               |
| `10-articles-search-empty.png`        | Articles       | 搜索 “volcano” 没有结果：No articles match.                                                                                                                                         | 搜索 volcano                                                                |
| `11-articles-loading-more.png`        | Articles       | 加载下一批：Load more 位置显示 Loading…                                                                                                                                             | 点 Load more（或滚到底自动加载）                                            |
| `12-articles-empty.png`               | Articles       | 还没有文章：No articles yet.，Play all 禁用                                                                                                                                         | 只能用 `#articles-empty`                                                    |
| `13-reader.png`                       | 阅读页         | 未播放：左上 ← Articles 返回、来源和分类、标题、字数和时长、只有图标的播放键、选词辅助键、每句一行的播放键、文末署名、底部播放器                                                    | 点一张文章卡片                                                              |
| `14-reader-playing.png`               | 阅读页         | 连续播放中：第 3 句高亮，播放器显示 3/10                                                                                                                                            | 阅读页点顶部播放键                                                          |
| `15-reader-sentence-selected.png`     | 阅读页         | 选中第 5 句：只播这一句，它的按钮变成停止；顶部播放键仍然只有图标，按下从这一句播到文末                                                                                             | 点某句左侧的播放键                                                          |
| `16-reader-speed.png`                 | 阅读页         | 速度浮层 0.75×–2×，当前 1.25×                                                                                                                                                       | 点播放器右侧的速度按钮                                                      |
| `17-reader-continuous.png`            | 阅读页         | Play all 连续播放：播放器多出下一篇按钮                                                                                                                                             | 文章列表点 Play all 或某篇的播放键                                          |
| `18-reader-attribution.png`           | 阅读页         | 文末署名：来源图标和名称、配置里的署名文字、作者、Original 链接、采集时间                                                                                                           | 打开 “Trade cards…” 并滚到文末                                              |
| `19-reader-tap-to-continue.png`       | 阅读页         | 跨篇播放被浏览器拦下：播放器显示 Tap to continue                                                                                                                                    | 只能用 `#reader-tap-to-continue`                                            |
| `20-lookup-loading.png`               | 查词浮窗       | 正在解释：选中的词、占位条、Explaining…，收藏键禁用                                                                                                                                 | 阅读页点正文里的一个词                                                      |
| `21-lookup.png`                       | 查词浮窗       | 结果：词头、Play word、词性、中文、例句 1 / 2                                                                                                                                       | 等解释出现                                                                  |
| `22-lookup-example-2.png`             | 查词浮窗       | 例句 2 / 2，下一条按钮禁用                                                                                                                                                          | 点例句下方的右箭头或横滑例句                                                |
| `23-lookup-word-audio-generating.png` | 查词浮窗       | 单词读音生成中：读音按钮的图标换成转圈，没有文字                                                                                                                                    | 点 Play word                                                                |
| `24-lookup-audio-unavailable.png`     | 查词浮窗       | 读音不可用：Audio isn't available right now. 和 Retry                                                                                                                               | 只能用 `#lookup-audio-unavailable`                                          |
| `25-lookup-failed.png`                | 查词浮窗       | AI 失败：Couldn't explain this. 和 Retry                                                                                                                                            | 只能用 `#lookup-failed`                                                     |
| `26-lookup-too-long.png`              | 查词           | 选了超过 8 个词：提示 Select up to 8 words.，不打开浮窗                                                                                                                             | 长按正文并拖出超过 8 个词                                                   |
| `27-lookup-nested.png`                | 查词浮窗       | 嵌套：在例句里再查 coating，后一层左移、不可操作                                                                                                                                    | 在浮窗例句里点一个词                                                        |
| `28-save-saved.png`                   | 收藏           | 收藏 adapt 后加号变成对勾，提示 Saved to Vocabulary.，Vocabulary 上的黄色数字加 2                                                                                                   | 查 adapt → 点浮窗标题栏的加号                                               |
| `29-save-replace.png`                 | 收藏           | 已有同义词卡：Replace saved word? 左右对比已存和这次的中文与例句，Review progress stays the same.，Cancel / Replace                                                                 | 查 resilient → 点加号                                                       |
| `30-vocabulary.png`                   | Vocabulary     | All 标签，也是复习模式选择：Speak 禁用并写 Coming soon，Spell、Translate 带红（到期）黄（新词）数字；词卡上 Speak 进度照常显示；默认按词 A–Z                                        | 顶部书本图标                                                                |
| `31-vocabulary-new.png`               | Vocabulary     | New 标签                                                                                                                                                                            | 点 New                                                                      |
| `32-vocabulary-ongoing.png`           | Vocabulary     | Ongoing 标签                                                                                                                                                                        | 点 Ongoing                                                                  |
| `33-vocabulary-archived.png`          | Vocabulary     | Archived 标签：Speak 还不能完成，#3 里为空，显示 No words match.                                                                                                                    | 点 Archived                                                                 |
| `34-vocabulary-search.png`            | Vocabulary     | 搜索 “adjective”（按词性），3 个词                                                                                                                                                  | 在搜索框输入 adjective 并搜索                                               |
| `35-vocabulary-swipe-half.png`        | Vocabulary     | 左滑删除的中间帧：卡片跟手左移 40 px，露出一半 Delete                                                                                                                               | 向左拖动第一张词卡，不松手                                                  |
| `36-vocabulary-swipe-open.png`        | Vocabulary     | 左滑超过 35 px 松手后停在打开位置，露出 80 px 的红色 Delete                                                                                                                         | 向左滑第一张词卡后松手                                                      |
| `37-vocabulary-delete-one.png`        | Vocabulary     | 单个删除确认：Delete word?，Review progress will also be deleted.，Cancel 默认聚焦                                                                                                  | 左滑后点 Delete                                                             |
| `38-vocabulary-long-press.png`        | Vocabulary     | 长按 500 ms 进入选择模式：复选框出现，长按的那张已选，操作条 1 selected，模式按钮禁用                                                                                               | 长按一张词卡                                                                |
| `39-vocabulary-multi-select.png`      | Vocabulary     | 选了 3 个词，操作条有 Loaded、3 selected、删除、取消                                                                                                                                | 选择模式里点卡片或复选框；或点页头的选择图标                                |
| `40-vocabulary-batch-delete.png`      | Vocabulary     | 批量删除确认：Delete 3 words? 列出词名                                                                                                                                              | 选择模式点操作条的删除图标                                                  |
| `41-vocabulary-empty.png`             | Vocabulary     | 生词本为空：No words yet. Select a word while reading to look it up.                                                                                                                | 只能用 `#vocabulary-empty`                                                  |
| `42-card-detail.png`                  | 词卡详情       | 右上关闭、词头和 Play word、词性、中文、例句区（选词辅助、Play example、Refresh、1 / 2）、三个进度组，没有删除                                                                      | 点一张词卡                                                                  |
| `43-review-spell.png`                 | Spell 复习     | 听写题：中文、词性、Play example（播放含目标词的完整例句）、挖空例句 1 / 2、输入框、Round 3、Submit                                                                                 | Vocabulary 点 Spell（键盘图标）                                             |
| `44-review-spell-correct.png`         | Spell 复习     | 答对：Correct · Next review in 4 days，输入只读，Next                                                                                                                               | 输入 resilient → Submit                                                     |
| `45-review-spell-wrong.png`           | Spell 复习     | 答错：resilient · Try again in 10 mins                                                                                                                                              | 输入别的拼写 → Submit                                                       |
| `46-review-translate.png`             | Translate 复习 | 英文词、词性、不挖空的例句、四个中文选项、Submit                                                                                                                                    | Vocabulary 点 Translate（翻译图标）                                         |
| `47-review-translate-answered.png`    | Translate 复习 | 选对后：Correct · Next review in 4 days，选项只读                                                                                                                                   | 选第二项 → Submit                                                           |
| `48-review-empty.png`                 | 复习           | 没有到期和新词：No reviews due. Next review in 4 hours.                                                                                                                             | 把某个模式的题做完                                                          |
| `49-review-offline.png`               | 复习           | 断网提交：Not saved. Reconnect to check the result.，答案保留只读，Retry                                                                                                            | 离线时 Submit                                                               |
| `50-review-changed.png`               | 复习           | 别的设备改了这个词：This word changed on another device.，Next                                                                                                                      | 只能用 `#review-changed`                                                    |
| `51-account-menu.png`                 | 账号菜单       | 右上头像打开：Terms、License、Log out                                                                                                                                               | 点右上的头像字母                                                            |
| `52-articles-load-failed.png`         | Articles       | 列表第一次加载失败：列表位置显示 Couldn't load articles. 和 Retry，不显示篇数，Play all 禁用                                                                                        | 只能用 `#articles-load-failed`                                              |
| `53-articles-load-more-failed.png`    | Articles       | 下一批加载失败：已加载的 20 篇保留，Load more 位置显示 Couldn't load more articles. 和 Retry                                                                                        | 离线时点 Load more（或滚到底）                                              |
| `54-reader-play-failed.png`           | 阅读页         | 播放失败：提示 Couldn't play this article. 和 Retry，播放器停在未播放                                                                                                               | 离线时点播放键                                                              |
| `55-reader-article-gone.png`          | Articles       | 文章已被存储清理删除：回到列表，提示 This article is no longer available.，没有 Retry；连续播放时跳过它播下一篇                                                                     | 只能用 `#reader-article-gone`                                               |
| `56-lookup-offline.png`               | 查词浮窗       | 断网：You're offline. Connect to look up words. 和 Retry，收藏键禁用，浮窗和 AI 失败时相同                                                                                          | 离线时点正文里的一个词                                                      |
| `57-lookup-refresh-failed.png`        | 查词浮窗       | 换例句失败：保留原例句，提示 Couldn't get a new example. 和 Retry                                                                                                                   | 离线时点例句的 Refresh                                                      |
| `58-save-failed.png`                  | 收藏           | 收藏失败：浮窗保持打开，加号仍可点，提示 Couldn't save the word. 和 Retry                                                                                                           | 离线时点浮窗标题栏的加号                                                    |
| `59-replace-failed.png`               | 收藏           | 替换失败：Replace saved word? 对话框保持打开，提示 Couldn't replace the word. 和 Retry 画在遮罩上面                                                                                 | 离线时在替换对话框点 Replace                                                |
| `60-vocabulary-delete-failed.png`     | Vocabulary     | 批量删除失败：对话框关闭，仍在选择模式，3 个词保持选中，提示 Couldn't delete. Try again. 和 Retry                                                                                   | 离线时确认批量删除                                                          |
| `61-terms-accept-failed.png`          | 使用条款       | 同意没有保存：条款页不变，提示 Couldn't save your answer. 和 Retry                                                                                                                  | 离线时点 I agree                                                            |
| `62-terms-read-only.png`              | 使用条款       | 从账号菜单打开：只读，右上关闭，版本行下写 Accepted Nov 22.（和版本同一天），没有 Log out / I agree                                                                                 | 账号菜单 → Terms                                                            |
| `63-review-translate-wrong.png`       | Translate 复习 | 选错后：所选项标红并带叉，反馈写正确的中文 · Try again in 10 mins，选项只读                                                                                                         | 选第一项 → Submit                                                           |
| `64-reader-select-words-helper.png`   | 阅读页         | 选词辅助浮层：Sentence、From、To 三个下拉和 Look up，选了第 3 句的 resilient                                                                                                        | 阅读页点播放键旁的选词辅助键                                                |
| `65-vocabulary-round-filter.png`      | Vocabulary     | Spell round 筛选浮层：Round 1–7 和 Complete，勾了 Round 3，Clear / Apply                                                                                                            | 点 Spell round 筛选（键盘图标）                                             |
| `66-vocabulary-sort.png`              | Vocabulary     | 排序浮层：Word 和各模式的 round、next，默认 Word 升序                                                                                                                               | 点右侧排序图标                                                              |
| `67-vocabulary-load-failed.png`       | Vocabulary     | 词表加载失败：词卡位置显示 Couldn't load words. 和 Retry，不显示词数                                                                                                                | 只能用 `#vocabulary-load-failed`                                            |
| `68-vocabulary-load-more-failed.png`  | Vocabulary     | 下一批加载失败：25 个词里已加载的 20 个保留，Load more 位置显示 Couldn't load more words. 和 Retry                                                                                  | 离线时点 Load more（或滚到底）                                              |
| `69-reader-load-failed.png`           | 阅读页         | 文章加载失败：保留 ← Articles 返回，正文位置显示 Couldn't load this article. 和 Retry，没有播放器                                                                                   | 只能用 `#reader-load-failed`                                                |
| `70-card-detail-load-failed.png`      | 词卡详情       | 词卡加载失败：保留右上关闭，内容位置显示 Couldn't load this word. 和 Retry                                                                                                          | 只能用 `#card-detail-load-failed`                                           |
| `71-review-load-failed.png`           | 复习           | 下一道题加载失败：保留模式名和关闭，题目位置显示 Couldn't load the next review. 和 Retry                                                                                            | 只能用 `#review-load-failed`                                                |
| `72-review-submit-failed.png`         | Spell 复习     | 服务器没有保存答案：输入的答案保留、可再提交，提示 Couldn't save your answer. 和 Retry；断网时是 `49-review-offline.png`                                                            | 只能用 `#review-submit-failed`                                              |
