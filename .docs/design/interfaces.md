# 接口

这份文件写系统提供和调用的接口：Web 应用的 HTTP 接口、朗读服务 `vexto-tts`，以及收集任务怎样启动。规则的来龙去脉见 `rules.md`，表结构见 `data.md`，错误在界面上的显示见 `screens.md`。

## 健康检查

说明应用正在运行，供冒烟测试和人工检查使用。它不检查数据库等依赖。

| 项         | 内容                                               |
| ---------- | -------------------------------------------------- |
| 方法和路径 | `GET /api/health`                                  |
| 权限       | 公开，不需要登录，不检查成员和条款                 |
| 缓存       | 响应头 `Cache-Control: no-store`                   |
| 其他方法   | `HEAD` 和 `GET` 相同，但没有正文；其他方法返回 405 |

成功时的响应：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{"status":"ok","service":"vexto"}
```

## Web 应用接口的共同约定

### 请求和响应

- 路径都在 `/api/` 下；请求和响应都是 JSON，输入用 Zod 校验，多余的字段算无效输入。响应都带 `Cache-Control: no-store`。
- 时间是 ISO 8601 的 UTC 时间。文字位置是 UTF-16 的左闭右开区间 `[start, end)`。
- 资源 ID 都是 UUID。路径里的 ID 不是 UUID 时返回 404 `NOT_FOUND`，和资源不存在一样；请求正文里的 ID 不是 UUID 时返回 422。
- 成功的状态：读取和更新 200，新建 201，删除 204（没有正文）。成功的正文是 `{ "data": ..., "meta": ... }`，`meta` 只在列表里出现：`{ "nextCursor": "...", "totalCount": 23 }`，`nextCursor` 为空表示已经到底。
- 列表用不透明的游标分批，每批固定 20 条，不能改。

### 身份和条款

除了健康检查，每个请求按顺序检查：Clerk 会话（没有时 401 `UNAUTHENTICATED`）、`members` 里是 `active` 成员（不是时 403 `NOT_A_MEMBER`）、确认过当前版本的条款（没有时 403 `TERMS_REQUIRED`；`GET /api/me` 和 `POST /api/terms/acceptance` 不检查这一项）。页面里登录页和 `/license` 同样公开。绑定 Clerk 用户的规则见 `rules.md`。

### 写操作的 operationId

这些写操作在请求正文里带客户端生成的 `operationId`（UUID），`DELETE` 也放在正文里：发起查词、两种刷新例句、保存、替换、删除、批量删除、提交答案。同一个 `operationId` 和同样的请求再来一次，返回第一次的状态和正文；请求不同返回 409 `OPERATION_MISMATCH`。回执保留 24 小时，规则见 `rules.md`。没有查询操作状态的接口。

记录访问和确认条款本身可以重复，不带 `operationId`。

### 错误

失败时的正文只有一种形式：

```json
{
  "error": {
    "code": "DUPLICATE_WORD",
    "message": "This word is already saved.",
    "retryable": false,
    "requestId": "req_01J…",
    "details": {}
  }
}
```

- `code` 是下表的英文代码，客户端只按它区分；`message` 是给开发者看的英文，不含调用栈、密钥和模型的原始输出，界面不显示它。
- `retryable` 说明原样重发（同一个 `operationId`）有没有可能成功。
- `requestId` 和日志里的请求对应。
- `details` 只在下表写了的代码里出现。

| 状态 | 代码                 | 什么时候                                                                                                | `retryable` |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------------- | ----------- |
| 401  | `UNAUTHENTICATED`    | 没登录或会话过期                                                                                        | 否          |
| 403  | `NOT_A_MEMBER`       | 不在名单里或已被取消                                                                                    | 否          |
| 403  | `TERMS_REQUIRED`     | 没确认当前版本的条款                                                                                    | 否          |
| 404  | `NOT_FOUND`          | 资源不存在、不属于当前用户，或文章还没准备好、已被淘汰                                                  | 否          |
| 409  | `CONFLICT`           | 资源在别处被改动或删除、复习题还没到期或已完成、确认的条款版本不是当前版本                              | 否          |
| 409  | `OPERATION_MISMATCH` | 同一个 `operationId` 对应了不同的请求                                                                   | 否          |
| 409  | `DUPLICATE_WORD`     | 保存时已有同一个意思的词卡；`details.savedCard` 是 `{ id, lemma, pos, meaningZh, examples, updatedAt }` | 否          |
| 409  | `SELECTION_CHANGED`  | 批量删除时所选的词有的已经不存在；`details.missingIds` 列出它们                                         | 否          |
| 422  | `INVALID_INPUT`      | 输入格式或含义无效，例如参数不在取值范围、选区为空或超过 8 个词或 80 个字符                             | 否          |
| 422  | `HIDDEN_RANGE`       | 查词的选区和 Spell 题挖空的目标词重叠                                                                   | 否          |
| 500  | `INTERNAL`           | 没有预料到的错误                                                                                        | 是          |
| 503  | `UNAVAILABLE`        | AI、朗读服务或对象存储不可用、超时，或 AI 的输出重做后仍不合格                                          | 是          |

下面每个接口的“错误”一栏只列 401、403 以外的代码；500 每个接口都可能有。

## 账号和条款

### 读取自己的资料

| 项   | 内容                                                                                          |
| ---- | --------------------------------------------------------------------------------------------- |
| 路径 | `GET /api/me`                                                                                 |
| 权限 | 有效成员；不要求确认过条款                                                                    |
| 响应 | 200 `{ email, terms: { currentVersion, acceptedVersion, acceptedAt } }`；没确认过时后两项为空 |

客户端用它决定显示条款页还是应用；姓名首字母由客户端从 Clerk 的用户资料算出。

### 确认条款

| 项   | 内容                                                                          |
| ---- | ----------------------------------------------------------------------------- |
| 路径 | `POST /api/terms/acceptance`                                                  |
| 权限 | 有效成员；不要求确认过条款                                                    |
| 请求 | `{ version }`，用户看到的条款版本                                             |
| 响应 | 200 `{ acceptedVersion, acceptedAt }`；已经确认过这个版本时返回原来的确认时间 |
| 错误 | 409 `CONFLICT`（不是当前版本）、422                                           |

## 文章

订阅源和分类的名称、标记、颜色、署名文字和许可证都在客户端打包的同一份配置里，接口只返回它们的键。

### 文章列表

| 项   | 内容                                                                                                                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径 | `GET /api/articles`                                                                                                                                                                                         |
| 参数 | `q`（不超过 200 字符）；`feed`（可重复，订阅源的键）；`category`（可重复，分类的键）；`sort`：`collected`（默认）、`visited`、`article`、`source`、`category`；`direction`：`asc`、`desc`（默认）；`cursor` |
| 响应 | 200，`data` 每篇 `{ id, title, excerpt, feedKey, categoryKey, collectedAt, lastVisitedAt }`，`excerpt` 是正文第一句，没访问过时 `lastVisitedAt` 为空；`meta` 有 `nextCursor`、`totalCount`                  |
| 错误 | 422（参数无效：不认识的参数名；`q`、`sort`、`direction`、`cursor` 给了不止一次；不认识的订阅源或分类的键；`q` 超过 200 字符或含 NUL 字符；游标不是这个查询发出的）                                          |

只返回 `ready` 的文章。排序、搜索和筛选的规则见 `rules.md`。

### 当前查询的全部文章 ID

连续播放用。客户端点 Play all 或某篇的播放键时请求一次，把有序的 ID 列表当作播放队列。

| 项   | 内容                                                                    |
| ---- | ----------------------------------------------------------------------- |
| 路径 | `GET /api/articles/ids`                                                 |
| 参数 | 和文章列表相同的 `q`、`feed`、`category`、`sort`、`direction`，没有游标 |
| 响应 | 200 `{ ids }`，按当前排序的全部符合条件的文章 ID                        |
| 错误 | 422                                                                     |

### 一篇文章

| 项   | 内容                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径 | `GET /api/articles/:id`                                                                                                                                              |
| 响应 | 200 `{ id, title, feedKey, categoryKey, author, sourceUrl, collectedAt, durationMs, sentences }`；`sentences` 每项 `{ index, paragraphIndex, text, startMs, endMs }` |
| 错误 | 404                                                                                                                                                                  |

字数由客户端按句子计算，时长用 `durationMs`。

### 记录访问

| 项   | 内容                            |
| ---- | ------------------------------- |
| 路径 | `PUT /api/articles/:id/visit`   |
| 请求 | 没有正文                        |
| 响应 | 200 `{ lastVisitedAt }`         |
| 错误 | 404（文章不存在时不建访问记录） |

进入阅读页时调用；失败时界面不提示。

## 音频

### 取得播放地址

| 项   | 内容                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 路径 | `POST /api/media/playback`                                                              |
| 请求 | 一个定位，只用 ID，不接受任意文字；种类和字段见下表                                     |
| 响应 | 200 `{ url, expiresAt, durationMs }`；`url` 是 10 分钟有效的预签名地址，支持 Range 请求 |
| 错误 | 404、422、503 `UNAVAILABLE`（朗读服务或存储不可用、超时，或者音频在合成期间被淘汰）     |

| `kind`           | 其他字段                | 播放什么                     |
| ---------------- | ----------------------- | ---------------------------- |
| `article`        | `articleId`             | 整篇文章                     |
| `lookup-word`    | `lookupId`              | 查词结果的词条               |
| `lookup-example` | `lookupId`、`exampleId` | 查词结果的一条例句           |
| `card-word`      | `cardId`                | 词卡的词条                   |
| `card-example`   | `cardId`、`exampleId`   | 词卡的一条例句，Spell 题也用 |

- 文章音频总是已经存在。
- 单词和例句的音频没有 `ready` 的行时，服务端按 `rules.md` 的步骤建 `pending` 的行、同步调用 `vexto-tts`，记录音频和用量后再返回；客户端在读音按钮上显示转圈。
- 读音的文字是词条或例句的规范文字（规则见 `rules.md`）。规范文字为空或超过 300 字符时不调用朗读服务，按没有预料到的错误返回 500；保存下来的词条和例句不会这么长。
- 返回的地址只含由音频 ID 组成的对象键，不透露文字。
- 地址过期时客户端重新请求。

## 查词

### 发起查词

| 项   | 内容                                                                                                                                                                                                                               |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径 | `POST /api/lookups`                                                                                                                                                                                                                |
| 请求 | `{ operationId, context, selection: { start, end } }`；`context` 是上下文的定位，见下表；`selection` 是在上下文文字里的位置                                                                                                        |
| 响应 | 新查的 201，命中缓存的 200；正文 `{ id, selectedText, lemma, pos, meaningZh, examples, savedCardId }`，`examples` 按位置排，每项 `{ id, position, text, targetRanges }`；`savedCardId` 是从这个查词结果存下的词卡的 ID，没有时为空 |
| 错误 | 404（上下文不存在）、422 `INVALID_INPUT`、422 `HIDDEN_RANGE`、503 `UNAVAILABLE`                                                                                                                                                    |

| `context.kind`       | 其他字段                                     | 上下文文字                                                                                  |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `article`            | `articleId`、`firstSentence`、`lastSentence` | 选区碰到的相邻几句（最多 8 句），在 `body_text` 里从第一句起点到最后一句终点的那一段        |
| `lookup-example`     | `lookupId`、`exampleId`                      | 查词结果的这条例句                                                                          |
| `vocabulary-example` | `cardId`、`exampleId`                        | 词卡的这条例句（词卡详情、Translate 题）                                                    |
| `spell-example`      | `cardId`、`exampleId`                        | 同上，但选区和目标词重叠时返回 `HIDDEN_RANGE`；位置相对于完整例句，由题面的 `segments` 得出 |

查词规则见 `rules.md`。

### 刷新查词结果的一条例句

| 项   | 内容                                                                                            |
| ---- | ----------------------------------------------------------------------------------------------- |
| 路径 | `POST /api/lookups/:id/examples/:exampleId/refresh`                                             |
| 请求 | `{ operationId }`                                                                               |
| 响应 | 200，新的例句 `{ id, position, text, targetRanges }`，位置和原来的相同                          |
| 错误 | 404（查词结果不存在）、409 `CONFLICT`（这条例句已被换掉）、503（包括重试 2 次仍和已有例句相同） |

## 生词本

### 词卡列表

| 项   | 内容                                                                                                                                                                                                                                                                                                                                |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径 | `GET /api/vocabulary`                                                                                                                                                                                                                                                                                                               |
| 参数 | `state`：`all`（默认）、`new`、`ongoing`、`archived`；`q`（不超过 100 字符）；`rounds.speak`、`rounds.spell`、`rounds.translate`（可重复，取值 `1`–`7`、`complete`）；`sort`：`word`（默认）、`speakRound`、`speakNext`、`spellRound`、`spellNext`、`translateRound`、`translateNext`；`direction`：`asc`（默认）、`desc`；`cursor` |
| 响应 | 200，`data` 每张 `{ id, lemma, pos, meaningZh, progress }`，`progress` 是 `{ speak, spell, translate }`，每项 `{ round, dueAt }`；`meta` 有 `nextCursor`、`totalCount`                                                                                                                                                              |
| 错误 | 422                                                                                                                                                                                                                                                                                                                                 |

界面上的 `Round <n>` 是 `round + 1`，`round` 为 7 时显示 `Complete`。

### 一张词卡

| 项   | 内容                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| 路径 | `GET /api/vocabulary/:id`                                                                                  |
| 响应 | 200，列表里的字段，加上 `updatedAt` 和 `examples`（按位置排，每项 `{ id, position, text, targetRanges }`） |
| 错误 | 404                                                                                                        |

### 保存

| 项   | 内容                                                             |
| ---- | ---------------------------------------------------------------- |
| 路径 | `POST /api/vocabulary`                                           |
| 请求 | `{ operationId, lookupId }`                                      |
| 响应 | 201，新词卡，字段和“一张词卡”相同                                |
| 错误 | 404（查词结果不存在）、409 `DUPLICATE_WORD`、409 `CONFLICT`、503 |

### 替换已存的词卡

| 项   | 内容                                                                                     |
| ---- | ---------------------------------------------------------------------------------------- |
| 路径 | `POST /api/vocabulary/:id/replace`                                                       |
| 请求 | `{ operationId, lookupId, updatedAt }`；`updatedAt` 取自 `DUPLICATE_WORD` 的 `savedCard` |
| 响应 | 200，替换后的词卡                                                                        |
| 错误 | 404、409 `CONFLICT`（`updatedAt` 不一致）、422（词条或词性和词卡不同）、503              |

### 刷新词卡的一条例句

| 项   | 内容                                                   |
| ---- | ------------------------------------------------------ |
| 路径 | `POST /api/vocabulary/:id/examples/:exampleId/refresh` |
| 请求 | `{ operationId }`                                      |
| 响应 | 200，新的例句 `{ id, position, text, targetRanges }`   |
| 错误 | 404、409 `CONFLICT`、503                               |

### 删除一张词卡

| 项   | 内容                         |
| ---- | ---------------------------- |
| 路径 | `DELETE /api/vocabulary/:id` |
| 请求 | `{ operationId }`            |
| 响应 | 204                          |
| 错误 | 404                          |

### 批量删除

| 项   | 内容                                             |
| ---- | ------------------------------------------------ |
| 路径 | `POST /api/vocabulary/bulk-delete`               |
| 请求 | `{ operationId, ids }`，1–100 个不同的词卡 ID    |
| 响应 | 204                                              |
| 错误 | 409 `SELECTION_CHANGED`、422（数目不对或有重复） |

## 复习

### 计数

| 项   | 内容                                                                  |
| ---- | --------------------------------------------------------------------- |
| 路径 | `GET /api/review/counts`                                              |
| 响应 | 200 `{ spell: { due, new }, translate: { due, new } }`；#3 不含 Speak |

### 下一题

| 项   | 内容                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 路径 | `GET /api/review/next?mode=spell` 或 `mode=translate`                                                                                                                                                                                            |
| 响应 | 200 `{ question, nextDueAt }`；有题时 `question` 是题面，`nextDueAt` 为空；没有题时 `question` 为空，`nextDueAt` 是这种模式下一次到期的时间，没有以后到期的题时也为空                                                                            |
| 题面 | Spell：`{ cardId, mode, nextRound, pos, meaningZh, examples }`，`examples` 每项 `{ id, segments }`，`segments` 是文字段 `{ start, text }`（`start` 是在完整例句里的位置）和挖空 `{ gap: true }` 的序列；不含词条、可接受词形、完整例句和音频地址 |
|      | Translate：`{ cardId, mode, nextRound, lemma, pos, examples, options }`，`examples` 每项 `{ id, text }`，`options` 每项 `{ id, pos, meaningZh }`；不含正确选项                                                                                   |
| 错误 | 422（`mode` 不是 `spell` 或 `translate`，或者带了别的参数）                                                                                                                                                                                      |

只读，不改任何数据。

### 提交答案

| 项   | 内容                                                                                                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径 | `POST /api/review/submit`                                                                                                                                                                                              |
| 请求 | `{ operationId, cardId, mode, answer }`；Spell 的 `answer` 是 `{ text }`（1–80 字符，不能全是空白），Translate 的是 `{ optionId }`（UUID）                                                                             |
| 响应 | 200 `{ result, answer, round, dueAt }`；`result` 是 `correct` 或 `incorrect`；`answer` 是可以公开的正确答案（Spell 是词条，Translate 是正确选项的中文）                                                                |
| 错误 | 404（词卡不存在或不属于当前用户）、409 `CONFLICT`（还没到期、已完成、被另一台设备先答了，或者选项不在这张卡现有的选项里：出题后词卡被替换过）、422（正文无效：答案为空、太长，`optionId` 不是 UUID，模式和答案对不上） |

## 朗读服务 vexto-tts

Cloud Run 服务，按需合成单词和例句的读音。只有 Web 应用和部署后的冒烟测试调用。

| 项       | 内容                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 路径     | `POST /synthesize`                                                                                                                                                                                                                                                                                                                                                                                         |
| 认证     | Cloud Run 的 IAM 认证，只有 Run Invoker 能调用。Web 应用用 Vercel 的 OIDC 令牌经 Google 身份联合换取身份令牌，放在 `Authorization` 头里                                                                                                                                                                                                                                                                    |
| 请求     | `{ key, text, voice, modelRevision, encodingVersion }`；`key` 是要写的对象键，只接受 `speech/<UUID>.mp3` 和冒烟测试的 `smoke/check.mp3`；`text` 是规范文字（再做一次规范化也不变），1–300 字符                                                                                                                                                                                                             |
| 处理     | 用 F1 合成（模型的字符表里没有的字符去掉），lame 编码成单声道 MP3 32 kbps，ID3 注释写 `AI-generated voice (Supertonic 3)`，写到 Neon 存储桶的 `key`，已有对象时覆盖                                                                                                                                                                                                                                        |
| 响应     | 200 `{ key, byteSize, durationMs, usage: { cpuMs } }`                                                                                                                                                                                                                                                                                                                                                      |
| 错误     | 正文和 Web 应用的相同：`{ error: { code, message, retryable } }`。400 `INVALID_INPUT`：请求目标读不成路径（`The request target is not a valid path.`，不可重试）；422 `INVALID_INPUT`：对象键不合格、文字不是规范文字或长度不对，或声音、模型版本、编码版本不是服务加载的那一套；500 `INTERNAL`：没有预料到的错误（可以重试）；503 `UNAVAILABLE`：合成或写桶失败。认证失败由 Cloud Run 直接返回 401 或 403 |
| 超时     | Web 应用等 30 秒，足够冷启动（读约 400 MB 的模型，大约十几秒）；超时或返回的内容读不懂时把这次用量记成 `unknown`，对客户端返回 503                                                                                                                                                                                                                                                                         |
| 不做的事 | 不判断要不要合成，不写数据库；对象键、音频行和用量由 Web 应用负责                                                                                                                                                                                                                                                                                                                                          |
| 限量     | 最多 1 个实例，没人用时缩到 0                                                                                                                                                                                                                                                                                                                                                                              |

## 收集任务 vexto-collect

Cloud Run 任务（Job），一次只运行 1 个任务实例，并行度为 1。

| 项     | 内容                                                                                                                                                                                            |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动   | Cloud Scheduler 任务 `vexto-collect`，表达式 `*/15 * * * *`，时区 UTC，用自己的服务账号启动，不需要共享密钥；开发机上需要时手动运行                                                             |
| 资源   | 2 vCPU、2 GiB 内存；任务超时 60 分钟；失败后 Cloud Run 不自动重跑（最大重试次数 0），由下一次定时执行接着做                                                                                     |
| 参数   | 没有；订阅源配置随镜像发布，朗读模型从 Cloud Storage 挂载，数据库和存储桶的位置和凭据来自环境变量和 Secret Manager                                                                              |
| 处理   | 顺序和规则见 `rules.md` 的“收集流水线”                                                                                                                                                          |
| 输出   | `articles`、`article_sentences`、`seen_items`、`feed_cursors`、`job_leases`、`synthesis_cpu_months`、`audio_assets`、`usage_records` 的行；存储桶里的 MP3；Cloud Logging 的日志（不含文章正文） |
| 退出码 | 0：正常结束，包括没拿到租约、合成预算用完、单篇文章或单个订阅源失败；非 0：这次执行本身失败，例如配置校验不通过、连不上数据库或存储桶、没有预料到的异常                                         |

Last changed: #3 (2026-11-23)
