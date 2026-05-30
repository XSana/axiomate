# Context & Memory Upgrade Plan: Claude Code 2.1.88 -> 2026-06

## 目标

Axiomate 的下一阶段优先补齐 context & memory 系统，而不是继续把 API harness 当作主短板处理。

本计划的边界是：Axiomate fork 自 Claude Code CLI 2.1.88，现有 memory/context 核心基本继承自该版本。2.1.88 之后 Claude Code 不再提供可直接对照的开源源码，因此后续补齐只能依赖官方 Claude Code 文档、Managed Agents memory/dreams 资料、公开工程文章，以及本地行为验证。

## Baseline

本地基线：

- `C:\public\workspace\claude-code-sourcemap`
- `README.md` 说明该仓库是从公开 npm package `@anthropic-ai/claude-code` 的 `cli.js.map` / `sourcesContent` 还原，版本为 `2.1.88`。
- 该仓库是非官方研究 source map，不代表 Anthropic 内部原始 repo 结构；只能作为 2.1.88 发布包源码语义参考。

Axiomate 当前判断：

- `agent/src/memdir/*` 大体继承 Claude Code 2.1.88 的 filesystem memory 机制，主要差异是品牌、路径和 Anthropic 私有 gate / team memory 逻辑删减。
- `agent/src/services/extractMemories/*`、`SessionMemory/*`、`autoDream/*`、`compact/*` 仍属于 2.1.88 继承线，Axiomate 后续主要做启用开关、品牌替换、compact/API 侧扩展。
- 因此“已有 context/memory 能力”应写成“继承了 Claude Code 2.1.88 之前的能力”，不能写成 Axiomate 独立完成了新一代 memory 架构。

## Sources

本地 2.1.88 source map：

- `C:\public\workspace\claude-code-sourcemap\README.md`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\memdir\{memdir,paths,memoryTypes,memoryScan,memoryAge,findRelevantMemories}.ts`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\services\extractMemories\*`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\services\SessionMemory\*`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\services\autoDream\*`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\services\compact\*`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\utils\{claudemd,analyzeContext,transcriptSearch}.ts`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\components\ContextVisualization.tsx`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\tools\AgentTool\{agentMemory,agentMemorySnapshot}.ts`
- `C:\public\workspace\claude-code-sourcemap\restored-src\src\tasks\DreamTask\DreamTask.ts`

Axiomate 对照路径：

- `agent/src/memdir/*`
- `agent/src/services/{extractMemories,SessionMemory,autoDream,compact}/*`
- `agent/src/utils/{axiomatemd,analyzeContext,transcriptSearch}.ts`
- `agent/src/components/ContextVisualization.tsx`
- `agent/src/tools/AgentTool/{agentMemory,agentMemorySnapshot}.ts`
- `agent/src/tasks/DreamTask/DreamTask.ts`

官方 / 公开资料：

- Claude Code memory canonical docs: `https://docs.claude.com/en/docs/claude-code/memory`
- Claude Code memory: `https://code.claude.com/docs/en/memory`
- Claude Code context window: `https://code.claude.com/docs/en/context-window`
- Claude Code how it works: `https://code.claude.com/docs/en/how-claude-code-works`
- Claude Code best practices: `https://code.claude.com/docs/en/best-practices`
- Managed Agents memory stores: `https://platform.claude.com/docs/en/managed-agents/memory`
- Managed Agents dreams: `https://platform.claude.com/docs/en/managed-agents/dreams`
- Built-in memory for Claude Managed Agents: `https://claude.com/blog/claude-managed-agents-memory`
- New in Claude Managed Agents: dreaming, outcomes, multiagent orchestration: `https://claude.com/blog/new-in-claude-managed-agents`
- Context management: `https://claude.com/blog/context-management?cam=claude`
- Effective harnesses for long-running agents: `https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents`
- Long-running Claude: `https://www.anthropic.com/research/long-running-Claude?vno=z7`
- Managed agents engineering article: `https://www.anthropic.com/engineering/managed-agents`

Hermes 只作为 secondary hygiene source：

- prompt-size diagnostics
- `/compress here [N]`
- session search index degradation
- Curator/background review report shape
- atomic file ops, MCP/process cleanup, guardrails

这些可以借鉴产品形态和稳定性做法，但不改变 Axiomate 默认 memory 架构：默认仍是 markdown/filesystem + model-managed read/write/search/summary。

## Current Inherited Capabilities

Axiomate 已有的 2.1.88 基线能力：

- `MEMORY.md` index + topic markdown files。
- typed memory taxonomy、frontmatter scan、memory age / freshness。
- auto-memory extraction：forked agent 归档未来可复用的项目经验。
- session memory：把 session 级摘要和后续可用信息整理出来。
- relevant memory scan：从 memory directory 中找相关 topic，而不是默认全量注入。
- autoDream / DreamTask：后台整理 memory，方向接近 Managed Agents dreams。
- compact / autoCompact / microCompact：在上下文压力下压缩历史。
- `analyzeContext` / `ContextVisualization`：已有部分 context 观测基础。
- `transcriptSearch`：已有 session/history 检索基础。

## Gap Hypothesis

2.1.88 之后需要补的不是“有没有 memory 文件”，而是生命周期闭环：

- 用户需要看到哪些 memory / rule / file / history / skill / tool schema 占用了 context。
- 模型需要知道为什么召回某条 memory，为什么没有召回，何时应该读 topic file。
- compact 需要 boundary-aware control，不能只依赖全局 auto summary。
- dreams 需要可审计输入、输出、diff、原因和人工确认路径。
- memory 写入需要版本、来源、session 归因和 prompt-injection 风险提示。
- stale / duplicate / contradicted memories 需要定期清理，而不是无限增长。
- session search 需要 FTS/trigram/CJK 不可用时降级，不应影响启动或 resume。
- Claude Code 官方文档里 `/context`、`/memory`、auto memory limits、rules、path-scoped loading、subagent context isolation 等体验，需要逐项对照 Axiomate。

## Workstreams

### P0. Baseline Audit

- 建立 `claude-code-sourcemap` 到 Axiomate 的 context/memory 文件级对照表。
- 对 `memdir`、extractMemories、SessionMemory、autoDream、compact 做 semantic diff，不追求逐行一致，只标记语义差异。
- 明确哪些差异是必要的 Axiomate 改名 / provider 泛化，哪些是误删或过时。
- 输出 `docs/context/context-memory-baseline-audit.md`。

Acceptance:

- 每个 context/memory 关键文件都有“继承 / 删除 / 改写 / 新增”的分类。
- 不再用含混说法描述 Axiomate 的 memory 来源。

### P0. Context Doctor

- 增加 Axiomate 版 `/context` 或 `/doctor context`。
- 分桶展示 system prompt、tools、MCP schemas、AXIOMATE.md / rules、auto memory、loaded memory topic files、skills、conversation history、file reads、tool results、compact buffer。
- 每个 bucket 给 token estimate、加载时机、是否会在 compact 后重注入、优化建议。
- 与 route 主模型的 `contextWindow`、`maxOutputTokens`、compact threshold 绑定。

Acceptance:

- 用户能解释“本轮 context 为什么满了”。
- compact 前后能看到哪些内容保留、丢失、重注入。

### P0. Memory Explainability & Audit

- 在 memory recall / write 时记录 session id、source prompt、写入 agent、文件路径、摘要、风险标记。
- `/memory` 中显示已加载的 AXIOMATE.md、rules、auto memory index、相关 topic files 和加载原因。
- memory 写入支持 dry-run / confirm 模式，尤其是自动抽取和 dream 输出。
- 对 memory 文件做 prompt-injection / stale marker / contradiction marker 的轻量扫描。

Acceptance:

- 用户能看到“为什么召回这条 memory”和“是谁什么时候写了它”。
- dream 或 auto-memory 误写时可以快速定位并撤回。

### P0. Boundary-Aware Compression

- 实现 Axiomate 等价的 `/compress here [N]` 或 `/compact here [N]`。
- 支持从当前回合、最近 N 回合、某个 checkpoint/branch 边界之后开始压缩。
- 压缩结果标记输入范围、保留约束、丢弃内容、引用文件和 memory touch list。
- 自动 compact 在反复 thrashing 时停止并给出可操作建议。

Acceptance:

- 长 session 不需要全局总结才能降 context。
- 用户能选择压缩边界，并能看到压缩摘要替换了哪段历史。

### P1. Dream / Background Review Productization

- 将 autoDream 变成可审计后台任务：输入 memory store、session transcripts、输出 store/diff、改写原因。
- 借鉴 Hermes Curator 的 per-run report，但目标限定为 markdown memory、AXIOMATE.md、skills，不默认引入 RAG provider。
- 先做 manual review / promote / archive，再考虑自动应用。
- 支持 stale、duplicate、contradiction、too-large、too-specific 分类。

Acceptance:

- dream 输出不会静默覆盖原 memory。
- 用户能 review diff 并选择 accept / reject / archive。

### P1. Session Search Degradation

- 对 resume/session search 增加索引健康诊断。
- FTS5、trigram、CJK tokenizer、SQLite extension 不可用时降级到 rg/linear scan。
- search result 附带匹配来源、分数、fallback mode 和耗时。
- 与 memory relevance scan 共享 token budget 和解释字段。

Acceptance:

- 搜索能力退化时应用仍能启动、resume 和浏览历史。
- CJK 项目不会因为 tokenizer 缺失而表现为“搜不到”或卡住。

### P1. Memory Growth Control

- 对 `MEMORY.md` index 做大小阈值和 topic file split 建议。
- 检查 topic files 是否过大、重复、过期、互相矛盾。
- 提供 `memory doctor`：列出最需要整理的 memory 文件和推荐动作。
- 支持 archive 而不是直接 delete。

Acceptance:

- memory 长期使用后不会退化成不可读垃圾堆。
- 用户能在不理解内部实现的情况下清理 memory。

### P2. Optional Provider Boundary

- 可以设计轻量 `MemoryProvider` / `ContextEngine` interface，但内置 reference provider 必须是 filesystem markdown。
- 第三方 RAG / vector / cloud memory 只能作为 adapter，不作为默认路径。
- provider hook 应覆盖 prefetch、attach、on_write、pre_compact、post_compact、dream_review。

Acceptance:

- Axiomate 可以扩展 provider，但默认体验不依赖向量库、不切碎 codebase。

## Test Plan

- unit tests：memory path derivation、index parsing、topic file scan、age/freshness、prompt-injection marker、compact boundary selection。
- integration tests：new session load memory、recall topic file、write memory、dream dry-run、compact here、resume search fallback。
- fixture tests：CJK transcript search、large `MEMORY.md`、contradictory memories、stale memory、nested rules/path-scoped rules。
- UI/TUI tests：`/memory` loaded-source list、`/context` bucket display、dream review diff。
- regression tests：existing auto compact、SessionMemory、extractMemories、Goal resume 不被破坏。

## Non-Goals

- 不把 codebase 默认切成向量 chunks。
- 不把 Hermes 的 MemoryProvider 插件广度当作 Axiomate 默认架构。
- 不在没有 audit / review 的情况下静默删除 memory。
- 不把 Claude Managed Agents 的云端 memory store API 原样搬到本地 CLI；只吸收 filesystem mount、audit、dream、scope 和 lifecycle 思路。

## Deliverables

- `docs/context/context-memory-baseline-audit.md`
- `/context` 或 `/doctor context`
- `/memory` loaded-source / recall-explain / write-audit UI
- `/compact here [N]` 或 `/compress here [N]`
- dream review report + manual promote/archive flow
- session search degradation diagnostics
- memory growth doctor
