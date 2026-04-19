# 剩余清理审计

本轮扫描日期：2026-04-19

本轮口径按最新产品边界重新调整：

- MCP 兼容层里的 `_meta['anthropic/*']`、SDK MCP transport、公开 MCP/插件生态兼容，不再作为残留问题。
- `@anthropic-ai/sdk`、Anthropic 公开协议 provider、Anthropic rate-limit header 解析，不再作为残留问题。
- Sandbox 对 `@anthropic-ai/sandbox-runtime` 的依赖，不再作为残留问题。
- WebSearchTool 和语音 STT 的独立 provider/config 是设计，不再作为残留问题。
- `DELETED_FEATURES.md` 里的历史记录是删除说明，不按运行时残留处理。

扫描范围：`agent/src`、`computer-use-mcp-axiomate/src`、根目录关键文档与构建配置。跳过 `node_modules`、`agent/dist`、`.git`。

## 当前结论

主模型 provider 路径已经比较干净：未发现 Bedrock / Vertex / Foundry / firstParty 旧 provider 重新进入运行时；也未发现旧 Artifactory 下载、`stub://disabled` WebFetch preflight、UDS socket 远控实现、Workflow/Monitor/ReviewArtifact 工具壳重新出现。

但仓库还没有“彻底干净”。剩余问题主要不是会偷偷向 Anthropic 发请求，而是：

1. Cowork / CCD / Nest/Desktop 这组内部宿主兼容层还存在，其中一部分是实运行时逻辑。
2. 配置迁移层仍保留旧私有账号/套餐/远控字段名。
3. analytics / telemetry 已改成用户显式配置的 OTEL 路径，但还有旧门禁、旧注释和半 stub 逻辑。
4. 一批 type-only shim、永远 false/null 的 UI flag、空 effect 还在。
5. 若干内部 Google Docs / go 链接、旧内部产品名只剩注释，但会继续误导维护者。

## 允许例外

以下项本轮确认保留，不再列入待清理：

- `agent/src/services/mcp/client.ts` 的 MCP `_meta['anthropic/searchHint']`、`_meta['anthropic/alwaysLoad']`。
- `agent/src/tools/ToolSearchTool/prompt.ts`、`agent/src/Tool.ts` 中对 MCP `_meta['anthropic/alwaysLoad']` 的兼容说明。
- `agent/src/services/api/providers/anthropicProvider.ts`、`agent/src/services/api/adapters/anthropic*`、`agent/src/services/api/providerRegistry.ts` 中的 Anthropic 公开协议实现。
- 多处 UI/message 类型从 `@anthropic-ai/sdk` 导入 `TextBlockParam`、`ToolUseBlockParam` 等类型。
- `agent/src/components/sandbox/SandboxDependenciesTab.tsx` 中安装 `@anthropic-ai/sandbox-runtime` 的提示。
- 公开插件约定 `.claude-plugin` 与官方 marketplace 名 `claude-plugins-official`。
- WebSearchTool、STT/voice provider 的独立配置与环境变量。

## 仍需处理

### 1. Cowork / CCD / Nest/Desktop 内部兼容层仍在运行时

严重度：High

这不是单纯注释。当前代码仍有隐藏 CLI flag、单独插件目录、单独 settings 文件、memory override、flush 策略、analytics 字段等。

关键位置：

- `agent/src/main.tsx:2207`：隐藏 `--cowork` option。
- `agent/src/cli/handlers/plugins.ts:100`、`:157`、`:445`、`:515`、`:583`、`:600`、`:644`、`:672`、`:700`、`:741`、`:787`：多处 `options.cowork` 写入 session state。
- `agent/src/bootstrap/state.ts:109`、`:297`、`:1084`、`:1089`：`useCoworkPlugins` 状态仍存在。
- `agent/src/utils/plugins/pluginDirectories.ts:1`、`:23`、`:31`、`:36`、`:40`：`cowork_plugins` 目录选择仍存在。
- `agent/src/utils/settings/settings.ts:255`、`:265`：`cowork_settings.json` 路径仍存在。
- `agent/src/QueryEngine.ts:297`：`AXIOMATE_COWORK_MEMORY_PATH_OVERRIDE` 触发 memory mechanics prompt 注入。
- `agent/src/QueryEngine.ts:444`、`:597`、`:825`、`:951`、`:990`、`:1043`：`AXIOMATE_CODE_IS_COWORK` 影响 transcript flush。
- `agent/src/memdir/paths.ts:145`、`:151`、`:177`、`:199`、`:252`：Cowork memory path override。
- `agent/src/memdir/memdir.ts:392`、`:394`：`AXIOMATE_COWORK_MEMORY_EXTRA_GUIDELINES` 注入 memory policy。
- `agent/src/tools/AgentTool/agentMemory.ts:142`：同样读取 `AXIOMATE_COWORK_MEMORY_EXTRA_GUIDELINES`。
- `agent/src/services/analytics/metadata.ts:580`：`AXIOMATE_CODE_COWORKER_TYPE` 的 false-gated analytics 字段。

建议：

- 如果 Axiomate 不提供 Cowork/CCD/Nest/Desktop 宿主模式：删除 `--cowork`、`cowork_plugins`、`cowork_settings.json`、`AXIOMATE_CODE_USE_COWORK_PLUGINS`、`AXIOMATE_CODE_IS_COWORK`、`AXIOMATE_COWORK_*`。
- 如果这些是 SDK/嵌入式宿主的通用能力：统一改名为 Axiomate 自己的概念，例如 `AXIOMATE_SDK_*`、`AXIOMATE_HOSTED_*`、`host_plugins`，同时删除 Cowork/CCD/Nest/Desktop 注释。
- transcript eager flush 已有 `AXIOMATE_CODE_EAGER_FLUSH`，可以替代 `AXIOMATE_CODE_IS_COWORK`。

### 2. 配置迁移层仍保留旧私有账号/套餐/远控字段名

严重度：Medium

这些字段位于 legacy cleanup 中，通常只会在读取旧配置时被删除，不会主导运行时。但它们继续把旧私有账号体系写进代码语义，也会让后续维护者误以为还支持这些业务。

关键位置：

- `agent/src/utils/config.ts:828`：`passesEligibilityCache`
- `agent/src/utils/config.ts:829`：`groveConfigCache`
- `agent/src/utils/config.ts:833`：`overageCreditGrantCache`
- `agent/src/utils/config.ts:834`：`overageCreditUpsellSeenCount`
- `agent/src/utils/config.ts:837`：`bridgeOauthDeadExpiresAt`
- `agent/src/utils/config.ts:838`：`bridgeOauthDeadFailCount`
- `agent/src/utils/config.ts:843`：`remoteControlAtStartup`
- `agent/src/utils/config.ts:983`：`remoteControlSpawnMode`

建议：

- 若不需要从旧配置自动迁移，直接删除这些 legacy key 清理逻辑。
- 若还需要兼容老用户配置，集中到一个 `legacyPrivateConfigKeys` allowlist，注释只写“迁移旧版配置”，不要保留旧业务解释。
- 保留 `feedbackSurveyState`，这是用户明确要求保留的配置状态。

### 3. Analytics / telemetry 仍有半 stub 和旧内部门禁语义

严重度：Medium

当前 analytics 不会默认发送到 Anthropic；它只会在用户显式设置 OTEL / beta tracing env 时走用户配置的 telemetry pipeline。但内部仍有几个“清了一半”的点。

关键位置：

- `agent/src/services/analytics/index.ts:50`：`AXIOMATE_CODE_ENABLE_TELEMETRY` 或 beta tracing env 才启用 OTEL 事件，整体方向是对的。
- `agent/src/utils/telemetry/sessionTracing.ts:113`：`isEnhancedTelemetryEnabled()` 永远 `return false`，但模块仍保留完整 tracing API。
- `agent/src/utils/telemetry/betaSessionTracing.ts:62`：注释仍写 “org allowlisted / ax_trace_lantern config gate”，实际实现只检查 env 与非交互模式。
- `agent/src/services/analytics/metadata.ts:87`：注释仍提 `go/taxonomy`、Cowork、ZDR。
- `agent/src/services/analytics/metadata.ts:101`：`BUILTIN_MCP_SERVER_NAMES` 通过 `false ? [...] : []` 变成永远空集合。
- `agent/src/services/analytics/metadata.ts:580`：`coworkerType` false-gated 字段。
- `agent/src/components/FeedbackSurvey/usePostCompactSurvey.tsx:83`：`setGateEnabled(false)` 导致 post-compact survey 永远不开。
- `agent/src/components/FeedbackSurvey/useMemorySurvey.tsx:87`：effect 中间有无条件 `return;`，后面的 memory survey 判断永远不可达。

建议：

- 保留 telemetry 系统可以，但需要把门禁语义改成 Axiomate 自己的：只保留 `AXIOMATE_CODE_ENABLE_TELEMETRY`、OTEL 标准 env、用户配置 endpoint。
- 删除 `false ?` feature-gate 分支，或改成明确的 Axiomate feature flag。
- survey 如果暂不提供，就删除 hooks 的不可达分支；如果要提供，就接入 Axiomate 自己的 gate/config。`feedbackSurveyState` 可继续保留。

### 4. MCP reserved-name 校验是死分支

严重度：Medium

用户已确认 MCP 兼容需要保留，但这里不是 MCP 兼容本身，而是校验逻辑被硬置空。

关键位置：

- `agent/src/main.tsx:919`：注释提 “SDK hosts (Nest/Desktop)”。
- `agent/src/main.tsx:921`：`const reservedNameError: string | null = null;`
- `agent/src/main.tsx:922`：`if (reservedNameError)` 永远不执行。
- `agent/src/main.tsx:933`：注释提 “Coworker”。

建议：

- 如果 reserved-name 校验不再需要，删除整个 dead branch。
- 如果还需要，恢复实际校验，但保留对 `type: 'sdk'` MCP config 的例外。
- 注释改成 Axiomate SDK / embedded host，不再写 Nest/Desktop/Coworker。

### 5. Native installer 仍有死的 npm package 安装分支和旧 scope

严重度：Medium

当前 `downloadVersion()` 永远返回 `binary`，所以 npm package 安装分支不可达；但分支里还硬编码了旧 package scope。

关键位置：

- `agent/src/utils/nativeInstaller/download.ts:281`：`downloadVersion()` 永远走 GCS binary 并返回 `'binary'`。
- `agent/src/utils/nativeInstaller/installer.ts:309`：`installVersionFromPackage()` 仍存在。
- `agent/src/utils/nativeInstaller/installer.ts:315`：`nodeModulesDir = join(stagingPath, 'node_modules', '@anthropic-ai')`。
- `agent/src/utils/nativeInstaller/packageManagers.ts:101`：注释仍举例 `/node_modules/@anthropic-ai/...`。

建议：

- 如果不再支持 npm-staged native package，删除 `installVersionFromPackage()` 与 `downloadType === 'npm'` 分支。
- 如果还要支持 npm-staged native package，把 scope/package layout 改成 Axiomate 自己的包名或从 manifest/macro 推导。

### 6. Prompt footer / REPL 里仍有永远 false/null 的 UI stub

严重度：Medium

这些不会发请求，但属于“删功能时留下 UI 管线”的典型残留。

关键位置：

- `agent/src/components/PromptInput/PromptInput.tsx:274`：`bridgeFooterVisible = false`
- `agent/src/components/PromptInput/PromptInput.tsx:275`：`hasTungstenSession = false`
- `agent/src/components/PromptInput/PromptInput.tsx:276`：`tmuxFooterVisible = false`
- `agent/src/components/PromptInput/PromptInput.tsx:278`：`bagelFooterVisible = useAppState(s => false)`
- `agent/src/components/PromptInput/PromptInput.tsx:287`：`companionFooterVisible = false`
- `agent/src/components/PromptInput/PromptInput.tsx:417`：footer items 仍包含 `tmux`、`bagel`、`bridge`、`companion`。
- `agent/src/components/PromptInput/PromptInput.tsx:1530`：`case 'bridge'` 仍存在。
- `agent/src/components/PromptInput/PromptInputFooterLeftSide.tsx:404`：`hasCoordinatorTasks = false`
- `agent/src/components/PromptInput/PromptInputHelpMenu.tsx:49`：`terminalShortcutElement = null`
- `agent/src/screens/REPL.tsx:1016`：`tabStatusGateEnabled = false`
- `agent/src/screens/REPL.tsx:1010` 附近：推送 tab status 的 `useEffect` 是空 effect。
- `agent/src/screens/REPL.tsx:2537`：`shouldStorePlanForVerification = false`
- `agent/src/screens/REPL.tsx:3321`：DEV-only scheduled tasks 里的 `assistantMode = false`

建议：

- 对已经不提供的 footer pill，删除对应 footer item、selection、case 分支和 props。
- Terminal panel 已恢复时，Help menu 应显示真实快捷键；否则删除 placeholder。
- Tab status 如果不做，删除空 effect 与 gate；如果要做，接入实际 PID/status writer。
- Plan verification 如果不做，删除 pending state 写入路径；如果要做，接入真实 gate。

### 7. Type-only shim / stub 模块仍然偏多

严重度：Low 到 Medium

有些 shim 是为了迁移期间保 typecheck，有些已经完全未使用。它们不一定坏，但会让代码库看起来像功能半删。

关键位置：

- `agent/src/assistant/sessionDiscovery.ts:1`：标注 Stub，`discoverAssistantSessions()` 永远返回 `[]`；当前扫描只发现定义，未发现调用。
- `agent/src/query/transitions.ts:1`：标注 Stub；`feature(_name)` 永远返回 `false`；`query.ts` 只 type-import `Terminal`、`Continue`。
- `agent/src/keybindings/types.ts:1`：标注 Stub；`useDoublePress()` no-op，`checkDuplicateKeysInJson()` / `validateBindings()` 永远返回 `[]`。同时真实 keybinding 逻辑在 `keybindings/validate.ts`、`resolver.ts`、`match.ts`。
- `agent/src/components/mcp/types.ts:1`：标注 Stub；主要是类型转发，`getCwd()` 返回 `process.cwd()` 且看起来未被正常运行时使用。
- `agent/src/services/lsp/types.ts:1`：标注 Stub；`expandEnvVarsInString()` 返回原值和空 missing list；实际 LSP plugin integration 使用的是 `services/mcp/envExpansion.ts`。
- `agent/src/utils/secureStorage/types.ts:1`：标注 Stub；目前像是 interface-only 模块，但命名仍是 stub。
- `agent/src/utils/systemThemeWatcher.ts:11`：`watchSystemTheme()` no-op watcher。

建议：

- 未使用的直接删除。
- 仅为了类型边界存在的，改名/改注释为 “types” 或 “compat types”，不要写 Stub。
- 有行为导出的 stub 函数要么删除，要么接到真实实现。

### 8. post-compaction 状态 flag 已明确无人消费

严重度：Low

代码注释已经说明这是 logging cleanup 后剩下的死状态。

关键位置：

- `agent/src/bootstrap/state.ts:205`：注释写明 `pendingPostCompaction` 没有 consumer。
- `agent/src/bootstrap/state.ts:670`：`markPostCompaction()` 仍写入。
- `agent/src/services/compact/compact.ts:597`、`:897`、`agent/src/services/compact/autoCompact.ts:277`、`agent/src/commands/compact/compact.ts:53`：仍调用 `markPostCompaction()`。

建议：

- 删除 `pendingPostCompaction`、`markPostCompaction()`、对应读取/清理函数和 4 个调用点。

### 9. Status / diagnostics 有空实现

严重度：Low

Sandbox 本身需要保留，但 Status 页里的 sandbox properties 是空实现。

关键位置：

- `agent/src/utils/status.tsx:26`：`buildSandboxProperties()` 永远 `return []`，但同文件还导入了 `SandboxManager`、settings、doctor/native installer 等大量依赖。
- `agent/src/components/Settings/Status.tsx:67`：仍调用 `buildSandboxProperties()`。

建议：

- 如果不展示 sandbox status，删除空 builder 和调用。
- 如果要展示，接入真实 sandbox runtime/dependency/status 信息。

### 10. 内部文档链接与旧内部产品名仍散落在注释中

严重度：Low

这些不会改变行为，但会继续污染维护语境。

关键位置：

- `agent/src/services/compact/apiMicrocompact.ts:12`：Google Docs 链接。
- `agent/src/services/api/llm.ts:271`：Google Docs 链接。
- `agent/src/components/shell/ShellProgressMessage.tsx:37`：`go/ccshare/...`
- `agent/src/utils/secureStorage/macOsKeychainHelpers.ts:59`：`go/ccshare/...`
- `agent/src/services/analytics/metadata.ts:87`：`go/taxonomy`。
- `agent/src/utils/privacyLevel.ts:11`：注释仍写 `grove`。
- `agent/src/utils/computerUse/setup.ts:19`：注释写 “anthropic repo” 与 Cowork desktop path。
- `agent/src/utils/computerUse/executor.ts`、`escHotkey.ts`、`drainRunLoop.ts`、`hostAdapter.ts`、`mcpServer.ts`：多处 Cowork / desktop reference 注释。
- `computer-use-mcp-axiomate/src/mcpServer.ts`、`types.ts`、`toolCalls.ts`、`deniedApps.ts`：多处 Cowork / CCD / apps/desktop 注释。
- `agent/src/utils/nativeInstaller/packageManagers.ts:101`：旧 scoped npm path 示例。

建议：

- 内部链接替换成仓库内文档或删除。
- Computer-use 相关注释如果只是来源说明，改成 “upstream reference implementation” 或迁移到 `DELETED_FEATURES.md` / `FEATURE_AUDIT.md`。
- `grove`、Cowork、CCD、Nest/Desktop 这类旧内部名不应留在普通维护注释里。

## 已确认干净或按例外保留

- 未发现 `stub://disabled`。
- 未发现 `ARTIFACTORY_REGISTRY_URL`、`infra.ant.dev`。
- 未发现 Bedrock / Vertex / Foundry / AWS_BEDROCK / VERTEX_AI / FOUNDRY runtime provider 路径。
- 未发现 `sendToUdsSocket`、`WorkflowDetailDialog`、`ReviewArtifactTool`。
- 未发现 `isSkillSearchEnabled`、`useDynamicConfig`、`multi_clauding`、`CLAUBBIT`、`after_grove_check`、`Grove colors`。
- Anthropic SDK/API protocol、MCP `anthropic/*` metadata、Sandbox runtime、WebSearch/STT 独立 provider、`.claude-plugin` 公开约定、本轮按产品边界保留。

## 建议清理顺序

1. 先处理 Cowork / CCD / Nest/Desktop：决定删除还是改名为 Axiomate SDK/host 兼容层。这是当前最像“内部宿主业务残留”的部分。
2. 清掉 `config.ts` legacy private fields，或集中成一个明确的 legacy migration allowlist。
3. 整理 analytics/telemetry：保留用户显式 OTEL，删除旧 gate、false-gated 分支和不可达 survey path。
4. 删除或实现 Prompt footer / REPL 的永远 false/null UI stub。
5. 删除未使用 shim；保留的 type-only 模块去掉 Stub 命名。
6. 清理内部 Google Docs / go 链接和 Cowork/CCD/Nest/Desktop 注释。
7. 最后加 CI guardrail，防止旧词重新进入普通 runtime 代码。

## 建议 CI guardrail

建议新增一个 residue test，但要有白名单，避免误报本轮明确允许的兼容项。

建议禁止：

- `AXIOMATE_COWORK_*`
- `AXIOMATE_CODE_IS_COWORK`
- `AXIOMATE_CODE_USE_COWORK_PLUGINS`
- `cowork_plugins`
- `cowork_settings.json`
- `bridgeOauthDead*`
- `remoteControlAtStartup`
- `remoteControlSpawnMode`
- `passesEligibilityCache`
- `overageCredit*`
- `groveConfigCache`
- `docs.google.com/document`
- `go/ccshare`
- `stub://disabled`
- 新增的 `const <name> = false` / `const <name> = null`，除非在 allowlist 中说明原因。

建议允许：

- `@anthropic-ai/sdk`
- `@anthropic-ai/sandbox-runtime`
- MCP `_meta['anthropic/*']`
- `anthropic` public protocol/provider 名称
- `claude-plugins-official`
- `.claude-plugin`
- WebSearch/STT provider 配置
- `DELETED_FEATURES.md` 中的历史引用
