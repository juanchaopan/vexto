# 数据

数据都在一个 Neon PostgreSQL 18 数据库里，音频文件在 Neon 私有存储桶里。这份文件写每张表的列、类型、约束、索引，以及删除一行时还会删掉什么。表里的值怎样产生、怎样变化见 `rules.md`。

## 约定

- 主键用 UUID，时间用 `timestamptz`，存 UTC，界面按设备本地时间显示。没有写“可空”的列都非空。
- 约束同时写成 SQL CHECK 和 Zod 校验。
- 个人数据的表都有 `owner_id`，指向 `members.id`；每个查询都按当前用户的 `owner_id` 过滤。子表（`examples`、`vocabulary_examples`、`translation_sets`）不存 `owner_id`，读写时连接父行校验所有者。
- 文字位置用 UTF-16 的左闭右开区间 `[start, end)`，不能切开代理对。
- 订阅源、分类、来源标记和颜色只在随版本发布的配置里，数据库里没有这些表；文章行只存配置的键。
- 表定义的位置：`members` 归 `account` 功能（`src/features/account/server/schema.ts`）；`operation_receipts` 在共用的 `src/lib/db/schema.ts`；收集流水线的状态（`seen_items`、`feed_cursors`、`job_leases`、`synthesis_cpu_months`）归收集功能，只在收集任务里用；`audio_assets` 归音频功能，别的功能通过它的 `index.ts` 使用；其余的表归各自的功能。
- 每一列都有规则、界面或接口用到；索引按界面提供的每种排序和搜索建，索引里的 `owner_id` 都在最前面。

## 成员

### members

受邀成员名单和条款确认记录，由 `task member` 管理（见 `rules.md`）。

| 列                  | 类型          | 约束                               | 说明                                         |
| ------------------- | ------------- | ---------------------------------- | -------------------------------------------- |
| `id`                | `uuid`        | 主键                               |                                              |
| `email`             | `text`        | 唯一，CHECK `email = lower(email)` | 邀请时写入，存小写                           |
| `clerk_user_id`     | `text`        | 可空，唯一                         | 第一次登录时按已验证邮箱绑定；取消资格时清空 |
| `status`            | `text`        | CHECK 取值 `active`、`revoked`     |                                              |
| `terms_version`     | `integer`     | 可空                               | 确认过的条款版本，没确认过时为空             |
| `terms_accepted_at` | `timestamptz` | 可空                               | 确认时间，只读条款页显示                     |
| `created_at`        | `timestamptz` |                                    | 加入时间，`list` 按它排序                    |

## 文章

### articles

收集任务写入的文章。只有 `state = 'ready'` 的文章出现在列表和阅读页里。

| 列                | 类型          | 约束                                      | 说明                                                                         |
| ----------------- | ------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| `id`              | `uuid`        | 主键                                      |                                                                              |
| `feed_key`        | `text`        |                                           | 配置里订阅源的键；订阅源停用后文章仍按这个键显示名称                         |
| `category_key`    | `text`        |                                           | 收集时这个订阅源的分类的键                                                   |
| `source_url`      | `text`        |                                           | 原文地址，阅读页的 Original 链接                                             |
| `title`           | `text`        |                                           |                                                                              |
| `author`          | `text`        | 可空                                      | 订阅源给出作者时才有，阅读页署名用                                           |
| `body_text`       | `text`        |                                           | 规范正文：句子之间一个空格，段落之间两个 LF                                  |
| `body_hash`       | `text`        | 唯一                                      | 规范正文的 SHA-256，挡住地址不同但正文相同的文章                             |
| `body_fts`        | `tsvector`    | 由 `body_text` 生成（`english` 配置）     | 全文搜索只查正文                                                             |
| `state`           | `text`        | CHECK 取值 `preparing`、`ready`、`failed` |                                                                              |
| `attempts`        | `integer`     | 默认 0，CHECK 0 到 5                      | 已经开始的合成次数；因合成预算推迟的不算                                     |
| `retry_at`        | `timestamptz` | 可空                                      | 下次可以合成的时间（写入时、重试退避或下个月初）；`ready` 和 `failed` 时为空 |
| `last_error_code` | `text`        | 可空，CHECK 取值见下文                    | 最近一次合成失败的原因                                                       |
| `audio_asset_id`  | `uuid`        | 可空，外键 `audio_assets.id`              | 整篇音频                                                                     |
| `created_at`      | `timestamptz` |                                           | 写入时间，`failed` 文章的保留期限从它算起                                    |
| `collected_at`    | `timestamptz` | 可空                                      | 文章变成 `ready` 的时间，列表的 Collected                                    |

CHECK：`state = 'ready'` 时 `audio_asset_id` 和 `collected_at` 都非空。

`last_error_code` 的取值：`tts_error`（模型推理出错）、`encode_error`（ffmpeg 编码失败）、`upload_error`（写存储桶失败）、`interrupted`（上一次执行在合成中途退出）。

索引：

| 索引                                                 | 用途                        |
| ---------------------------------------------------- | --------------------------- |
| `(state, collected_at, id)`                          | Collected 排序，两个方向    |
| `(state, lower(title), id)`                          | Article 排序                |
| `(state, feed_key, id)`、`(state, category_key, id)` | Source、Category 筛选和排序 |
| GIN `(body_fts)`                                     | 搜索                        |
| `(state, retry_at)`                                  | 收集任务找要合成的文章      |

Last visited 排序用 `visits` 的索引。

### article_sentences

每篇文章的句子和时间轴。

| 列                | 类型      | 约束                           | 说明                                      |
| ----------------- | --------- | ------------------------------ | ----------------------------------------- |
| `article_id`      | `uuid`    | 外键 `articles.id`，随文章删除 |                                           |
| `sentence_index`  | `integer` |                                | 从 0 开始                                 |
| `paragraph_index` | `integer` |                                | 段落序号，阅读页段落之间加大间距          |
| `text`            | `text`    |                                |                                           |
| `body_start`      | `integer` |                                | 在 `body_text` 里的起点，查词重建上下文用 |
| `body_end`        | `integer` |                                | 在 `body_text` 里的终点                   |
| `start_ms`        | `integer` | 可空                           | 在整篇音频里的起点，合成后写入            |
| `end_ms`          | `integer` | 可空                           | 在整篇音频里的终点                        |

主键：`(article_id, sentence_index)`。

### seen_items

见过的条目，跨订阅源去重。收下的和跳过的条目都有一行；文章被淘汰后这一行保留，防止再收一次。

| 列              | 类型          | 约束 | 说明                     |
| --------------- | ------------- | ---- | ------------------------ |
| `url_hash`      | `text`        | 主键 | 规范化原文地址的 SHA-256 |
| `first_seen_at` | `timestamptz` |      | 保留期限从它算起         |

索引：`(first_seen_at)`，用于清理。

### feed_cursors

每个订阅源处理到的收集时间点。

| 列                   | 类型          | 约束                 | 说明                           |
| -------------------- | ------------- | -------------------- | ------------------------------ |
| `feed_key`           | `text`        | 主键                 | 配置里订阅源的键               |
| `last_occurrence_at` | `timestamptz` |                      | 最近一个处理完的收集时间点     |
| `failed_attempts`    | `integer`     | 默认 0，CHECK 0 到 5 | 下一个时间点读订阅源失败的次数 |
| `retry_at`           | `timestamptz` | 可空                 | 读失败后下次可以再读的时间     |

### job_leases

防止收集任务重叠执行的租约。迁移时插入 `name = 'collect'`、`expires_at = '-infinity'` 的一行。

| 列           | 类型          | 约束 | 说明                                  |
| ------------ | ------------- | ---- | ------------------------------------- |
| `name`       | `text`        | 主键 |                                       |
| `holder`     | `uuid`        | 可空 | 持有租约的那次执行的 ID，释放时核对它 |
| `expires_at` | `timestamptz` |      | 早于数据库当前时间就可以取得          |

### synthesis_cpu_months

每个 UTC 月份文章合成的运行时间合计，用于合成预算（规则见 `rules.md`）。每次合成结束时用 `INSERT … ON CONFLICT (month) DO UPDATE` 把这次的秒数加上去。

| 列                  | 类型            | 约束                    | 说明                                              |
| ------------------- | --------------- | ----------------------- | ------------------------------------------------- |
| `month`             | `date`          | 主键，CHECK 是月的 1 日 | UTC 月份                                          |
| `synthesis_seconds` | `numeric(12,1)` | 默认 0，CHECK ≥ 0       | 合成的运行秒数，乘 vCPU 数和内存 GiB 得出两项用量 |

每月一行，一直保留。

### visits

每个用户每篇文章一行，进入阅读页时写入。

| 列               | 类型          | 约束                           | 说明                                        |
| ---------------- | ------------- | ------------------------------ | ------------------------------------------- |
| `owner_id`       | `uuid`        | 外键 `members.id`              |                                             |
| `article_id`     | `uuid`        | 外键 `articles.id`，随文章删除 |                                             |
| `last_opened_at` | `timestamptz` |                                | 列表的 Last visited；用数据库时间，只增不减 |

主键：`(owner_id, article_id)`。索引：`(owner_id, last_opened_at, article_id)`，用于 Last visited 排序。

## 查词

### lookup_entries

每个用户自己的查词缓存。同一用户、同一上下文、同一选区只有一行，不同文章里的同一句话共用；视觉换行不进键。

| 列                | 类型      | 约束                           | 说明                                         |
| ----------------- | --------- | ------------------------------ | -------------------------------------------- |
| `id`              | `uuid`    | 主键                           |                                              |
| `owner_id`        | `uuid`    | 外键 `members.id`              |                                              |
| `context_text`    | `text`    |                                | 服务端重建的上下文                           |
| `context_hash`    | `text`    |                                | 规范化上下文的 SHA-256；哈希相同时仍核对原文 |
| `selection_start` | `integer` |                                | 选区在 `context_text` 里的起点               |
| `selection_end`   | `integer` |                                | 选区终点                                     |
| `selected_text`   | `text`    |                                | 等于 `context_text` 在选区上的切片，浮窗标题 |
| `lemma`           | `text`    |                                | 词条                                         |
| `lemma_key`       | `text`    |                                | 规范化的词条，规则见 `rules.md`              |
| `pos`             | `text`    | CHECK 取值为固定的词性列表     | 列表见 `rules.md`                            |
| `meaning_zh`      | `text`    | CHECK 最多 30 个字符（含标点） | 中文释义                                     |
| `accepted_forms`  | `text[]`  | CHECK 至少 1 项                | Spell 接受的词形                             |

唯一约束：`(owner_id, context_hash, selection_start, selection_end)`。

### examples

查词结果的例句，每次查词 2 条。

| 列                | 类型      | 约束                                     | 说明                                                     |
| ----------------- | --------- | ---------------------------------------- | -------------------------------------------------------- |
| `id`              | `uuid`    | 主键                                     | 刷新时换新的 ID                                          |
| `lookup_entry_id` | `uuid`    | 外键 `lookup_entries.id`，随查词结果删除 |                                                          |
| `position`        | `integer` | CHECK ≥ 0                                | 显示顺序，从 0 开始；刷新时新例句沿用原来的位置          |
| `text`            | `text`    |                                          | 英文例句                                                 |
| `target_ranges`   | `jsonb`   | 非空数组                                 | 目标词在例句里的位置，每项 `[start, end]`，可以有多段    |
| `content_hash`    | `text`    |                                          | 例句文字的 SHA-256；刷新出同组已有的例句时由唯一约束挡住 |

唯一约束：`(lookup_entry_id, position)`、`(lookup_entry_id, content_hash)`。

## 生词本

### vocabulary_cards

| 列                       | 类型          | 约束                                       | 说明                                                   |
| ------------------------ | ------------- | ------------------------------------------ | ------------------------------------------------------ |
| `id`                     | `uuid`        | 主键                                       |                                                        |
| `owner_id`               | `uuid`        | 外键 `members.id`                          |                                                        |
| `source_lookup_entry_id` | `uuid`        | 可空，外键 `lookup_entries.id`，删除时置空 | 保存或最近一次替换用的查词结果；查词结果据此显示已保存 |
| `lemma`                  | `text`        |                                            |                                                        |
| `lemma_key`              | `text`        |                                            |                                                        |
| `pos`                    | `text`        | CHECK 取值为固定的词性列表                 |                                                        |
| `meaning_zh`             | `text`        | CHECK 最多 30 个字符（含标点）             |                                                        |
| `accepted_forms`         | `text[]`      | CHECK 至少 1 项                            |                                                        |
| `created_at`             | `timestamptz` |                                            | 新词按它出题                                           |
| `updated_at`             | `timestamptz` |                                            | 替换和刷新例句时更新；替换请求带上它，用于发现改动     |

索引：`(owner_id, lemma_key, pos)`，保存时找同一词条、同一词性的卡；`(owner_id, lemma_key, id)`，Word 排序；`(owner_id, created_at, id)`，新词出题；`(source_lookup_entry_id)`，查词结果找已保存的卡。同一个意思只有一张卡由保存的流程保证（见 `rules.md`），表上没有唯一约束，也不存义项键。

### vocabulary_examples

词卡自己的例句。保存时从查词结果整组复制，用新的 ID；之后查词结果和词卡各自刷新，互不影响。列和约束与 `examples` 相同，只是 `lookup_entry_id` 换成 `card_id`（外键 `vocabulary_cards.id`，随词卡删除），另加一列由 `text` 生成的 `text_fts`（`tsvector`，`english` 配置），建 GIN 索引，用于 Vocabulary 搜索。

### translation_sets

Translate 的四个选项，保存时生成，替换词卡时重新生成。

| 列                  | 类型    | 约束                                         | 说明                                                                        |
| ------------------- | ------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `card_id`           | `uuid`  | 主键，外键 `vocabulary_cards.id`，随词卡删除 |                                                                             |
| `options`           | `jsonb` | 恰好 4 项                                    | 每项 `{ id, pos, meaningZh }`，`id` 是随机 UUID；顺序在生成时定下，之后不变 |
| `correct_option_id` | `uuid`  |                                              | 恰好是 `options` 里的一项                                                   |

### review_progress

每张词卡每种模式一行，保存词卡时同时建三行。

| 列         | 类型          | 约束                                          | 说明               |
| ---------- | ------------- | --------------------------------------------- | ------------------ |
| `owner_id` | `uuid`        | 外键 `members.id`                             |                    |
| `card_id`  | `uuid`        | 外键 `vocabulary_cards.id`，随词卡删除        |                    |
| `mode`     | `text`        | CHECK 取值 `speak`、`spell`、`translate`      |                    |
| `round`    | `integer`     | CHECK 0 到 7                                  | 0 是新词，7 是完成 |
| `due_at`   | `timestamptz` | 可空；CHECK 只有 `round` 为 0 或 7 时可以为空 |                    |

主键：`(owner_id, card_id, mode)`。索引：`(owner_id, mode, due_at, card_id)`，出题、计数和 Next 排序；`(owner_id, mode, round, card_id)`，Round 排序和轮次筛选。

词卡的状态由三行派生，不存列：三行都是 `round = 0` 且 `due_at` 为空是 New，三行都是 `round = 7` 是 Archived，其余是 Ongoing。

Vocabulary 搜索先用 `owner_id` 的索引缩小到一个用户的词卡，再逐行做子串匹配；例句的全文搜索用 `text_fts` 的 GIN 索引。一个用户的词卡不多，不建三元组索引。

## 音频

### audio_assets

文章、单词和例句的音频。单词和例句的音频不分用户，所有人共用。

| 列                | 类型          | 约束                                      | 说明                                                             |
| ----------------- | ------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| `id`              | `uuid`        | 主键                                      | 对象键里用它                                                     |
| `cache_key`       | `text`        |                                           | 规则见 `rules.md`                                                |
| `object_key`      | `text`        | 唯一                                      | `speech/<id>.mp3` 或 `articles/<id>.mp3`                         |
| `state`           | `text`        | CHECK 取值 `pending`、`ready`、`retiring` | `pending`：在等合成；`ready`：可以播放；`retiring`：正在删除对象 |
| `byte_size`       | `bigint`      | 可空，CHECK > 0                           | 标成 `ready` 时写入；存储容量按它的合计计算                      |
| `duration_ms`     | `integer`     | 可空，CHECK > 0                           | 标成 `ready` 时写入                                              |
| `voice`           | `text`        |                                           | 例如 `F1`                                                        |
| `model_revision`  | `text`        |                                           | 模型的固定提交                                                   |
| `encoding`        | `text`        |                                           | 编码版本，例如 `mp3-mono-32k-v1`                                 |
| `created_at`      | `timestamptz` |                                           | 淘汰按它从早到晚；`pending` 的行按它清理                         |
| `retire_attempts` | `integer`     | 默认 0                                    | 删除对象失败的次数                                               |

CHECK：`state = 'ready'` 时 `byte_size` 和 `duration_ms` 非空。`retiring` 的行保留标记前的值，从 `pending` 过期来的为空，不计入容量。

索引：部分唯一索引 `(cache_key) WHERE state <> 'retiring'`，插入用 `ON CONFLICT DO NOTHING`；`(state, created_at, id)`，淘汰、清理和找待删除对象的行。

文章用 `articles.audio_asset_id` 引用整篇音频；单词和例句的音频按 `cache_key` 查找，没有引用表。

## 操作和用量

### operation_receipts

写操作的去重回执，保留 24 小时。

| 列                | 类型          | 约束              | 说明                                         |
| ----------------- | ------------- | ----------------- | -------------------------------------------- |
| `owner_id`        | `uuid`        | 外键 `members.id` |                                              |
| `operation_id`    | `uuid`        |                   | 客户端生成                                   |
| `kind`            | `text`        | CHECK 取值见下文  | 操作类型，和请求摘要一起判断是不是同一个请求 |
| `request_digest`  | `text`        |                   | 请求内容的 SHA-256                           |
| `response_status` | `integer`     |                   | 第一次的 HTTP 状态                           |
| `response_body`   | `jsonb`       | 可空              | 第一次的响应正文，204 时为空                 |
| `created_at`      | `timestamptz` |                   | 保留期限从它算起                             |

主键：`(owner_id, operation_id)`。索引：`(created_at)`，用于清理。

`kind` 的取值：`lookup.create`、`lookup.refresh-example`、`vocabulary.save`、`vocabulary.replace`、`vocabulary.refresh-example`、`vocabulary.delete`、`vocabulary.bulk-delete`、`review.submit`。

### usage_records

每次实际的外部调用一行：调用前插入 `pending`，调用后补上结果。项目所有者直接查这张表看用量和估算费用。

| 列                | 类型            | 约束                                                                                                     | 说明                                    |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `id`              | `uuid`          | 主键                                                                                                     |                                         |
| `kind`            | `text`          | CHECK 取值 `lookup`、`meaning_match`、`example`、`translation`、`article_tts`、`word_tts`、`example_tts` |                                         |
| `provider`        | `text`          |                                                                                                          | 例如 `openai`、`supertonic`             |
| `model`           | `text`          |                                                                                                          | 例如 `gpt-6-luna`、`supertonic-3`       |
| `engine_revision` | `text`          | 可空                                                                                                     | 朗读模型的固定提交                      |
| `request_id`      | `text`          | 可空                                                                                                     | 服务商返回的请求 ID，和服务商的账单对照 |
| `status`          | `text`          | CHECK 取值 `pending`、`succeeded`、`failed`、`unknown`                                                   |                                         |
| `input_tokens`    | `integer`       | 可空                                                                                                     | AI 调用的输入 token                     |
| `output_tokens`   | `integer`       | 可空                                                                                                     | AI 调用的输出 token                     |
| `audio_ms`        | `integer`       | 可空                                                                                                     | 合成出的音频时长                        |
| `cpu_ms`          | `integer`       | 可空                                                                                                     | 合成用的 CPU 时间                       |
| `byte_count`      | `bigint`        | 可空                                                                                                     | 合成出的 MP3 大小                       |
| `estimated_cost`  | `numeric(12,6)` | 可空                                                                                                     | 估算金额，美元                          |
| `price_version`   | `text`          | 可空                                                                                                     | 估算用的价格表版本                      |
| `owner_id`        | `uuid`          | 可空，外键 `members.id`                                                                                  | 收集任务的调用为空；取消资格时置空      |
| `resource_type`   | `text`          | 可空                                                                                                     | 调用涉及的资源种类，例如 `article`      |
| `resource_id`     | `uuid`          | 可空                                                                                                     | 调用涉及的资源                          |
| `started_at`      | `timestamptz`   |                                                                                                          | 按时间统计用                            |
| `finished_at`     | `timestamptz`   | 可空                                                                                                     | 和 `started_at` 一起得出调用耗时        |
| `error_code`      | `text`          | 可空                                                                                                     | 失败的原因                              |

未知的用量留空，不当作 0。用量记录一直保留。

## 什么删掉什么

| 事件                   | 同一个事务里删除或修改                                                                                                                                                                                        | 保留                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 淘汰一篇文章的音频     | 删除文章、它的句子和所有人对它的访问记录；音频行标成 `retiring`。事务提交后删除存储桶里的对象，成功后删除音频行，失败时 `retire_attempts` 加 1，下次再试                                                      | `seen_items` 的行、全部查词结果和词卡   |
| 淘汰单词或例句的音频   | 音频行标成 `retiring`，之后同上删除对象和行                                                                                                                                                                   | 下次有人点播放时按 `cache_key` 重新生成 |
| `pending` 的音频行过期 | 标成 `retiring`，之后同上删除对象（可能不存在）和行                                                                                                                                                           |                                         |
| `failed` 的文章到期    | 删除文章和它的句子                                                                                                                                                                                            | `seen_items` 的行                       |
| 删除一张词卡           | 删除它的例句、Translate 选项和三行复习进度                                                                                                                                                                    | 查词结果                                |
| 取消一个人的资格       | 删除他的词卡（连同例句、选项和复习进度）、查词结果（连同例句）、访问记录、去重回执；清空 `clerk_user_id`、`terms_version` 和 `terms_accepted_at`；`status` 设为 `revoked`；他的 `usage_records.owner_id` 置空 | `members` 的行和用量记录                |
| 回执超过 24 小时       | 删除这一行                                                                                                                                                                                                    |                                         |
| 条目超过 180 天        | 删除 `seen_items` 的这一行                                                                                                                                                                                    | 文章本身                                |

Last changed: #3 (2026-11-22)
