# P0 报告：verifier-mode 扩展点

日期：2026-10-08。范围只到设计 §13 的 P0，不是 MVP。

上游 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 当前 `origin/master` HEAD 是 `5badb15009ae1756c3afe0ae0cef1faafc290ccc`（2026-10-03 11:48 +0800，Merge PR #5648 release-dsh-0.2.1-alpha.1）。根 `package.json` 版本是 `0.2.1-alpha.1`。与设计核准时的 SHA 相同，**没有 drift**。本机 checkout 在 `/home/ubuntu/deepseek-harness`，没有改上游。

Spike 用 DSH 源码（`tsconfig.base.json` 的 path）加上本仓库的 `MockAdapter`，以及本机 HTTP mock。没有 DeepSeek、TypeSafe、Jev 或任何付费模型调用，也没有 API key。`npm test` 全绿：8 个文件、15 个用例。

插件包名 `dsh-verifier-mode`。peer 覆盖当前 DSH：`@deepseek-ai/dsh-*` 为 `>=0.2.1-alpha.1 <0.3.0`，`@deepseek-ai/cordis` 为 `>=4.0.5-alpha.1 <5`，`@deepseek-ai/schemastery` 为 `>=3.18.5-alpha.1 <4`。宿主 `inject` 用服务名（`commands`、`sessionProjections`）。`package.json` 的 `dsh.client.inject` 用包名；`src/client/index.ts` 的 `inject` 用服务名（`slots`、`locale`、`remote`、`remote.commands`）。这是当前 SHA 的真实分工，设计正文把两者写在了一起。

## 总判

| # | 题目 | 结论 |
| --- | --- | --- |
| 1 | `agent/pre-step` 追加 notice，reload 复原模型所见 | **works** |
| 2 | `ctx.llm.stream` 用量，以及当前 session 的主模型 | **works with caveat** |
| 3 | 从 `agent.session` 做 judge 摘要 | **works** |
| 4 | `exit_plan_mode` 拒绝后仍能挂 `additionalContexts` | **works with caveat** |
| 5 | 输入区 chip 走 `remote.commands.execute`，`/verifier` 可恢复 | **works with caveat** |
| 6 | `connection.fetch.register` + 本地 Jev mock | **works** |
| 7 | storage-domain sidecar | **works** |
| 8 | headless `--json` 是否带上暂停 notice | **works with caveat** |

**没有一项挡住 MVP，也没有一项要求为了 P1 去改 DSH core。** 设计 §11.2 里的 `ignorable` append、`SubagentStartRequest.cwd`、`GenerateOptions.purpose` 本来就不是 MVP 依赖，这次没有测。

下面每节写：试了什么、用到的 DSH 路径、结果、设计要不要改。

## 1. pre-step notice 与 reload

**试了什么。** `spikes/01-pre-step-notice.spec.ts` 挂上真实 `LlmRuntime`、`SessionStore`、`SessionProjectionRegistry`、`SystemPrompt`、`ToolRuntime`、`AgentRegistry`、`AgentLoop`，适配器只认 `mock`。`ctx.on('agent/pre-step')` 先 `next()`，再把一条 `verifier-mode` notice 接到 `decision.messages`。跑完一轮后，用 `agents.create({ seed: structuredClone(session.snapshotEvents()) })` 在**没有**这条 listener 的新 context 里续跑。

**API。**

- 事件：`packages/core/agent/src/runtime-types.ts` 的 `agent/pre-step`。返回值是 `PreStepDecision`，`kind: 'enter'` 时带 `messages`。
- 循环在组请求之前把这些 message 写入 log：`packages/core/agent-loop/src/agent.ts` 的 `session.append('user/message', message, { surfaceOp: 'append' })`。
- notice 形状：`packages/llm/llm/src/message.ts` 的 `createUserMessage`，`form: 'notice'`，`summary` 经 `boundContextSummary`（上限 `CONTEXT_SUMMARY_MAX_CHARS = 120`）。本插件在 `src/notices.ts` 合并 `MessageSourceMap['verifier-mode']`。
- 续跑：`packages/core/agent/src/index.ts` 的 `agents.create({ seed })`。请求是 log 的纯函数，同一结论已写在 `packages/core/agent-loop/tests/request-reconstruction.spec.ts`。

**结果。** 当轮 `GenerateOptions.messages` 含 marker；log 含同一条 `user/message`；新 session 不再挂 listener，下一轮请求仍含 marker 和上一轮 assistant 文本。

**设计。** §4.3 的 pre-step notice 可以按 plan-mode 的写法做（`packages/plan/plan-mode/src/index.ts` 先 `next()` 再拼接）。空闲时要立刻落一条 notice，直接 `session.append('user/message', …, { surfaceOp: 'append' })` 即可，不必等下一轮。`agent.inject` 只进 inbox，不会马上变成模型可见文本。

## 2. 用量与当前模型

**试了什么。** `spikes/02-usage-and-model.spec.ts` 四件事。宿主加载本插件，投影键是 `verifierRoute` 和 `verifierLedger`，读口是 `stateOf`。

1. `ctx.llm.stream` 消费一条带 `cacheReadTokens: 11`、`cacheWriteTokens: 2`、`totalTokens: 17` 的 `usage` chunk。主循环一轮的 `assistant/message.usage` 带上 `inputTokens: 10`、`outputTokens: 8`、`cacheReadTokens: 4`、`cacheWriteTokens: 5`、`reasoningTokens: 7`。
2. 装上 `installModelSelection`。第一轮用 `mock/flash`。第二轮之前追加 `model/selection`（`mock/pro`），并同时把私有 `selection.current` 设成 `pro`。在 turn 2 的 pre-step 读 `readCurrentRoute()`。
3. 第一轮 `mock/flash` 落成 `request/header` 之后，再追加 `model/selection`，provider 和 model 仍是 `mock/flash`，只多 `reasoningEffort: 'high'`。
4. 只改 `selection.current`，不写 `model/selection`。这是 ACP 的形状。同一轮切换不在 MVP 里，这里只把滞后记下来，没有补公开 live ref。

**API。**

- `TokenUsage`：`packages/llm/llm/src/types.ts`。`inputTokens` 不含 cache；`cacheReadTokens` 与 `cacheWriteTokens` 分开。chunk 类型是 `{ type: 'usage', usage }`。
- `ctx.llm.stream`：`packages/llm/llm/src/index.ts` 的 `LlmRuntime.stream`，瀑布 `llm/stream`。这次调用**不会**进 session log（auto-review 在 `packages/experimental/auto-review/src/index.ts` 也是这么用的）。
- 主循环用量在 `assistant/message.usage`：`packages/core/session/src/types.ts`。
- 公开路由没有 live ref。`AgentOptions`（`runtime-types.ts`）是创建时的 `provider` / `model`，之后不改。`session.requestHeader()?.config` 是上一次 `request/header`。
- Web 的 live 选择在 `packages/core/agent/src/model-selection.ts` 的 `installModelSelection`。`current` 给下一次 assembly，`assembled` 在 `system-prompt/assemble` 时拍下来，`agent/request` 再用它。pre-step 发生在 assemble **之后**（`packages/core/agent-loop/src/agent.ts` 的 `preStep`）。
- Web 还会写已知事件 `model/selection`：`packages/api/session-controller/src/types.ts`，折叠在 `packages/api/session-controller/src/model-selection-projection.ts`（`next = pending ?? lastUsed`，并且 `sameSelection` 比较 `reasoningEffort`）。`packages/core/session/src/known-event-types.ts` 已收录该事件，插件不依赖 session-controller 服务也能自己折。本仓库的折法在 `src/route.ts` 的 `verifierRoute`，读口是 `readCurrentRoute` → `stateOf`。生产代码不调用 `snapshotEvents`。`currentRouteFromEvents` 只留给测试。
- Headless 只在启动时取一次 selection：`packages/bundle/headless/src/index.ts`，不写 `model/selection`，运行中不换模型。
- ACP 改的是私有 `AcpModelControl.selection`：`packages/acp/acp/src/model-control.ts`，不写 `model/selection`。

**结果。**

- 旁路 `stream` 读到 `cacheReadTokens: 11`。文本 `SIDE-ONLY` 不在 session log，也不在 `verifierLedger`。主轮账是 `mock/flash` 一条：`inputTokens 10`、`outputTokens 8`、`cacheReadTokens 4`、`cacheWriteTokens 5`、`reasoningTokens 7`。只抄 `inputTokens` 的账过不了这个断言。
- 写了 `model/selection` 时，turn 2 的 pre-step 上 `readCurrentRoute` 已是 `pro`（source `model/selection`），`requestHeader().config.model` 仍是 `flash`。随后发出的 `GenerateOptions.model` 是 `pro`，因为测试同时改了私有 `selection.current`。折法读的是 log，请求读的是这个 ref。`agent.options.model` 仍是创建时的 `flash`。
- 只改 `reasoningEffort` 时，`verifierRoute` 状态引用不变，`readCurrentRoute` 仍是 `flash` / `request/header`。effort 不进封顶键。
- 只改私有 ref 时，fold 和 header 都还是 `flash`，请求已经是 `pro`。差一轮。

**设计。** §8.1 的 session 费用封顶键是 provider + model。`reasoningEffort` 不改变日元上限，只改 effort 的 `model/selection` 也不进入 `currentRoute`。上一版报告写「这和 Web 投影一致」说过了：Web 的 `modelSelection` 把 effort 算进选择身份，这条折法故意不算。Headless 模型固定，用 `agent.options` 即可。ACP 同一轮换模型不在 MVP 范围内，这次没有实现，也不把它列成 P1 要补的 core 接口。

记账以主循环 `assistant/message.usage` 为准，经 `verifierLedger` 累加。有 `cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens` 就入账；字段缺席记 0。旁路 `ctx.llm.stream`（judge）的用量只在这次 stream 上，调用方要自己累加，它不会出现在 session log 或这条账里。

## 3. session 摘要

**试了什么。** `spikes/03-session-summary.spec.ts` 注册真实 `echo` 工具，脚本先 tool call 再文本。生产读口是 `readJudgeDigest` → `stateOf(..., 'verifierJudge')`。测试里另把 `summarizeSession(snapshotEvents())` 和这个读口对成同一段字符串。再用 seed 重建 session，两边仍然全等。

**API。** 投影在 `src/summary.ts`，键 `verifierJudge`。user 文本在 `user/message` 的 `data.content`；assistant 在 `assistant/message` 的 `data.message.content`；工具名在 `tool/call` 的 `data.name`，按 `callId` 配到 `tool/result`。`isError` 写成 `ok` 或 `error`。空 assistant 文本（工具调用那条 message）不进摘要。`snapshotEvents` 只出现在测试里，用来交 seed 和对照纯函数。生产代码不调用它。2026-09-09 的废弃说明禁止新的生产扫描；投影注册表自己在 `buildCell` 里的调用是 core 自己的迁移，不授权插件再包一层。

**结果。** 活 session 和 seed 重建后的摘要都是这三行，逐字相等：

```
user: use the echo tool
tool echo ok: from-tool
assistant: final answer
```

空的 `assistant:` 或丢掉工具名的 `tool ok:` 过不了这个相等断言。工具结果正文空了（`tool echo ok:`）也过不了。

**设计。** judge 的状态从 log 折进 `verifierJudge`，不需要额外 session 事件。P1 读 `stateOf`，不要在生产路径调用 `snapshotEvents`。

## 4. `exit_plan_mode` 与 `additionalContexts`

**试了什么。** `spikes/04-exit-plan-mode.spec.ts` 挂真实 `CommandRuntime`、`UserQuestionService`、`PlanModeController`（`section` 非空）。

1. `/plan` 打开 plan mode。模型调用 `exit_plan_mode`，`user-questions/request` 回答 `Keep planning`。`tools/post-execute` 在 `result.isError` 时返回 `accept` 并带一条 notice，不改 `value`。
2. `tools/pre-execute` 对 `echo` 先 `next()` 再 `deny`。post-execute 同样挂 notice。
3. pre-execute listener 直接抛错。数 post-execute 是否还跑。

**API。**

- 工具瀑布：`packages/core/tools/src/index.ts`。`PreToolDecision` 的 `deny` 走 `post-result`，因此 post-execute 会跑（约 1521 行）。listener 抛错被收成 `final-result`（约 1536 行），**跳过** post-execute。
- `PostToolDecision` 的 `accept` / `block` 都可以带 `additionalContexts`。失败结果上不能替换 `value`（约 1804 行）。`accept` 会把 decision 的 contexts 和 result 上已有的接在一起。
- 循环在 tool result 之后 `acceptContext`：`packages/core/agent-loop/src/tool-calls.ts`。
- plan 工具在用户选 Keep planning 时抛错：`packages/plan/plan-mode/src/index.ts`，文案含 `The user chose to keep planning`。提问走 `ctx.userQuestions.ask`，瀑布名 `user-questions/request`（`packages/interaction/user-questions/src/index.ts`）。根 context 上的 listener 收得到。

**结果。**

- Keep planning 的下一轮请求和 log 都有 notice，log 里有 `keep planning`。
- deny 的下一轮请求有 notice，log 里有 `spike deny`。
- 抛错的 pre-execute：post-execute 次数是 0，错误文本仍进了 tool result。

**设计。** 「拒绝计划之后还能挂 `additionalContexts`」成立，包括 pre-execute deny。listener 必须 `next()` 之后返回 `accept`（失败结果不要设 `value`）。抛错会跳过 post-execute，这是调用约定，不是缺 API。**不需要 core 改动。**

## 5. chip 与 `/verifier`

**试了什么。** `spikes/05-verifier-chip.spec.ts`。宿主侧加载真实 `CommandRuntime` 和本插件 `apply`。客户端侧 `new SlotRegistry`、`new LocaleRuntime`，先由 root 声明 `conversation.input.left`（`kind: 'list'`，`scope: 'session'`），再跑 `src/client` 的 `apply`。`remote.commands.execute` 按 plan chip 的签名实现：`(sessionId, line, [])`，内部转到宿主 `commands.execute(agent, line, [], signal)`。

chip 的 `inject` 调 `/verifier on` 和 `/verifier off`。组件 `onClick` 在 `active === false` 时再调一次 on。然后 seed 到新 session，读投影，再发一轮用户消息。

**API。**

- 槽：`packages/client/ui-conversation/src/client/contract/slots.ts` 的 `conversation.input.left`。list 必须有 `id`：`packages/client/ui-slots/src/index.ts`。服务层是 `packages/client/ui-renderer/src/client/registry.ts` 的 `SlotRegistry.inject` / `entries`。
- plan 的对照：`packages/client/ui-plan/src/client/index.ts` 的 `ctx.remote.commands.execute(sessionId, '/plan off', [])`。
- 命令：`packages/interaction/commands/src/index.ts` 的 `CommandRuntime.execute`。成功路径写 `command/run` 再写 `command/done`（`packages/interaction/commands/src/types.ts`）。`args` 是 `rawInput`，含分隔空白，投影里要 `trim()`。
- 词典：`packages/client/locale/src/client/index.ts` 的 `LocaleRuntime.register` / `bind`。Node 里没有 `window`，回落到 `en`。
- 投影：`packages/session/session-projection/src/index.ts` 的 `register` / `stateOf`。seed 不会重放 `session/event`，但 `stateOf` 会折整段内存 log。定义在 `src/projection.ts`，键 `verifier`。

**结果。** 调用序列是 `/verifier on`、`/verifier off`、再 `/verifier on`。log 有 `command/run` 和 `[verifier mode on]`。重载后 `stateOf(..., 'verifier').active` 为 true，下一轮模型请求含这条 notice。按钮文案来自 `t('chip.label')`，英文是 `Verifier`。

另有一条用例：`ctx.plugin(plugin, { enabledByDefault: true })` 之后，不发 `/verifier`，`stateOf(..., 'verifier').active` 已是 true，log 里没有 `command/run`。`enabledByDefault: false` 和 `ctx.plugin(plugin, {})` 都是 false。`init` 里读 schemastery 的 volatile `.get()`，忽略这个旗标时这条用例失败。同一轮还确认 `verifierRoute`、`verifierLedger`、`verifierJudge` 已注册。投影 `stateVersion` 是 2，因为种子语义变了。

**设计。** 命令 + 投影这条链可用，和 `/plan` 同一类。生成出来的 `@deepseek-ai/dsh-commands/remote` 指向未构建的 `lib/`，这次**没有跑 RPC 编解码**。客户端和宿主用的是 plan chip 已经在用的那条签名，中间用同进程适配器接上。P1 在完整 Web 装配里会走到生成客户端；不需要为了这条签名去改 core。

空闲时 `/verifier` 立刻 `append` notice。投影只认 `on` / `off` 的 `command/run` + 成功的 `command/done`。`status` 不改状态。`enabledByDefault` 只给新 session 的 `active` 做种子；之后成功的 on/off 以 log 为准。

## 6. `connection.fetch.register` 与 Jev mock

**试了什么。** `spikes/06-fetch-jev-mock.spec.ts`。`127.0.0.1` 上起一个只认 `POST /v1/systemone` 的 HTTP server。按 `packages/client/connection/tests/fetch-routes.host.spec.ts` 构造 `HostConnectionService`，`connection.fetch.register` 登记 `POST /api/verifier-mode/score`。handler 读请求体，再 `fetch` 到本地 mock，把 mock JSON 原样返回。`dispose()` 之后同一 URL 为 404。

**API。** `packages/client/connection/src/rpc.ts` 的 `register`；`packages/client/connection/src/index.ts` 导出 `HostConnectionService`。路径必须在 `/api` 下。`createSharedFetchHandler('/api')` 做分发。

**结果。** 200，body `{ score: 0.42, note: 'local-mock' }`。mock 收到 `{ state, model, questions }`。撤回注册后 404。

**设计。** `fetch.register` 是**入站**路由（设计里的状态轮询）。出站 Jev 就是普通 HTTP，不是这条注册 API。两边都能在无 SDK、无密钥的情况下接上。mock 的 JSON **不是** `@typesafe-ai/sdk` 的正式 schema，P1 对接真 SDK 时再对齐字段。不需要 core 改动。

## 7. storage-domain sidecar

**试了什么。** `spikes/07-storage-sidecar.spec.ts`。临时目录上挂 `Storage`、`dsh-storage-json` 的 `apply`（backend 名 `json`）、`dsh-storage-domain` 的 `apply`（`backend: 'json'`）。`defineDomain` 名 `verifier_trace`，表 `traces`。`put` 后 `close`，再 `open`；另起一个 context 对同一目录再 `open`。同时跑一轮 agent，确认 note 不在 session log。

**API。**

- `packages/storage/storage/src/index.ts` 的 `Storage`。
- `packages/storage/storage-json/src/index.ts` 的 `apply(ctx, { root })`，`ctx.provide(storageBackendServiceKey('json'))`。
- `packages/storage/storage-domain/src/spec.ts` 的 `defineDomain` / `domainTable`。名字须匹配 `UNIT_NAME_RE`（`packages/storage/storage/src/backend.ts`，`/^[a-z][a-z0-9_]*$/`）。
- `packages/storage/storage-domain/src/index.ts` 的 `ctx.storageDomain.open`；`packages/storage/storage-domain/src/domain.ts` 的 `table().put/get`。

**结果。** 同一 context 重开、以及新 context 重开，都读到 `{ sessionId, note: 'SIDECAR-NOTE', score: 0.5 }`。session log 不含 `SIDECAR-NOTE`。

**设计。** trace 放 sidecar，不进 session log，这条成立。用 JSON backend 的临时目录即可，不必用测试里那个未导出的 memory backend。不需要 core 改动。

## 8. headless `--json` 与暂停 notice

**试了什么。** `spikes/08-headless-json.spec.ts`。pre-step 塞入带 marker 的 pause notice，在 `send` 之前调用 `projectJsonRun`。跑完后只 `dispose()`，不调用 `finish()`。断言 stdout 行里有 assistant `text`，没有 `final`，也没有 marker。再 spy `process.stderr.write`：默认 `ctx.logger.warn` 不出现；按 app-boot 的 level 装一个内存 exporter 能收到 warn；显式 `process.stderr.write('dsh: …')` 出现。这次没有启动 `dsh` CLI，也没有执行 headless `index.ts` 里未导出的 `summarize()`。`finish(text)` 写的 `final` 来自调用方传入的字符串，不能当作 `summarize()` 跑过的证据，所以这条用例不再调用它。

**API。**

- `packages/bundle/headless/src/json-stream.ts` 的 `projectJsonRun`。`switch` 覆盖 turn/step、assistant、tool。`default` 直接 `return`，**丢掉 `user/message`**。`assistant/message` 的 text block 写成 `{ type: 'text', text }`。`finish(text)` 另写 `{ type: 'final', text }`，文本就是参数本身。
- `summarize()` 在 `packages/bundle/headless/src/index.ts` 约 72 行，是私有函数，保留最后一条非空 assistant 文本。本 spike 没有执行它。
- 订阅是 `ctx.on('session/event')`。headless 在 `--json` 时走这个投影（`packages/bundle/headless/src/index.ts`）。这次没有跑那个进程。
- 默认 logger：`vendor/cordis/src/logger.ts`。级别 `ERROR=0, INFO=1, WARN=2, DEBUG=3`，阈值默认 `INFO`。`targetLevel < level` 则丢弃，所以 **默认 buffer 不收 warn**。默认 exporter 只 `buffer.push`，不写 stderr。
- app-boot 另装 exporter，`levels.default: 2`，把 warn/error 推进内存数组 `startupLogs`：`packages/boot/app-boot/src/index.ts` 约 985 行。仍然不是 stderr。headless JSON 模式把 stderr 留给 `dsh:` 诊断（`packages/bundle/headless/src/startup.ts`）。

**结果。** `projectJsonRun` 的行里有 `visible answer` 的 `text`，没有 `final`，没有 pause marker；marker 在 session log 里。`logger.warn` 不进 stderr，也不进默认 buffer；level 2 的内存 exporter 能看到它。显式 stderr 写能看到 `dsh: verifier paused …`。

**设计。** §9 第 4 条要改：暂停 notice **不会**出现在 `--json` stdout，因为 `projectJsonRun` 丢掉 `user/message`。`ctx.logger.warn` 也**不会**出现在 headless stderr。MVP 应自己 `process.stderr.write`，前缀用 `dsh:`。这是插件侧一行输出，不是 core 扩展。这条结论来自投影和 logger 的行为，不来自一次真实的 `dsh --json` 进程，也不来自 `summarize()`。若还希望 JSON 消费者看到暂停，要在 core 的 `projectJsonRun` 增加事件类型；P1 不依赖这一点，stderr 已经能让人看见。

## MVP / core

P1 可以按现有扩展点开工：

- notice：`agent/pre-step` 拼接，或空闲时 `session.append('user/message')`。
- 费用：主循环的 `assistant/message.usage` 折进 `verifierLedger`（`stateOf`）。键是 provider + model，不含 `reasoningEffort`。入账含未缓存 input、output、cache-read、cache-write、reasoning。judge 旁路自己累加 `usage` chunk。当前模型用 `readCurrentRoute`。
- judge 状态：`readJudgeDigest` → `stateOf(..., 'verifierJudge')`。空 assistant 行丢掉，工具行带工具名。
- 计划被拒：`tools/post-execute` 返回 `additionalContexts`，listener 不要抛。
- `/verifier`：命令 + `verifier` 投影；chip 调 `remote.commands.execute(sessionId, '/verifier on|off', [])`。
- Jev：出站 HTTP；入站状态用 `connection.fetch.register`。
- trace：`storageDomain.open` 的 JSON sidecar。
- headless 暂停：stderr 手写一行 `dsh:`，不要依赖 `--json` 或 `logger.warn`。

ACP 同一轮换模型不在 MVP 范围内。这次没有实现它，spike 2 只保留了「只改私有 ref 会晚一轮」的记录。
