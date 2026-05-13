# axiomate-sdk basics

Reference examples and inline documentation for [`axiomate-sdk`](../../packages/sdk).

This file is two things at once:

1. **Quickstart** for the four scripts in `src/`.
2. **API reference** thorough enough that you can skim it and start writing your own SDK consumer without reading the SDK source.

---

## Table of contents

- [Architecture](#architecture)
- [Setup](#setup)
- [Running the examples](#running-the-examples)
- [API: `query()`](#api-query)
- [API: `tool()` + `createSdkMcpServer()`](#api-tool--createsdkmcpserver)
- [API: Sessions](#api-sessions)
- [API: Scheduler / cron](#api-scheduler--cron)
- [Options reference](#options-reference)
- [Query control methods](#query-control-methods)
- [SDKMessage variants](#sdkmessage-variants)
- [Environment variables](#environment-variables)
- [MCP server config types](#mcp-server-config-types)
- [Permission handling](#permission-handling)
- [Native capabilities (computer-use / audio / clipboard)](#native-capabilities)
- [Troubleshooting](#troubleshooting)

---

## Architecture

```
your code ──► axiomate-sdk (pure JS library)
                  │
                  │  spawn child_process
                  ▼
              axiomate CLI binary  ◄── owns all .node modules,
                  │                    computer-use, audio, MCP servers,
                  │                    the agent loop, the model client.
                  ▼
              NDJSON ──► stdin (user messages, control requests)
              NDJSON ◄── stdout (assistant/tool/result events,
                                  control requests *to* the SDK)
```

Key implications:

- The SDK has **zero native dependencies**. All `.node` modules stay inside the CLI binary.
- `query()` returns an `AsyncGenerator<SDKMessage>` — you drain events with `for await`.
- Control flows in **both** directions over the same stdio channel. When the CLI needs to ask permission or call your in-process tool, the SDK routes the request transparently.
- Sessions are JSONL files on disk under `~/.axiomate/projects/<sanitized-cwd>/<session-uuid>.jsonl`. Both the CLI and the SDK read/mutate them, so they interoperate cleanly.

---

## Setup

This sample is a pnpm workspace member. From the repo root:

```bash
pnpm install
pnpm --filter sdk-basics run build
```

You also need the `axiomate` CLI somewhere the SDK can find it. Build it first if you haven't:

```bash
pnpm run build:agent     # produces agent/dist/cli.js
# Then either symlink it onto PATH, or point AXIOMATE_BIN at it:
export AXIOMATE_BIN=/abs/path/to/axiomate/agent/dist/cli.js
```

The SDK looks for the binary in this order: `options.cliPath` → `AXIOMATE_BIN` → `axiomate` on `PATH` (with `.exe` on Windows).

---

## Running the examples

| Script | What it shows |
|--------|---------------|
| `pnpm run query [prompt]` | The minimal `query()` loop. |
| `pnpm run custom-tool` | `tool()` + `createSdkMcpServer()` for in-process tools. |
| `pnpm run sessions [--mutate]` | Session list / read / rename / tag / fork (no subprocess). |
| `pnpm run scheduler [--seed-recurring]` | Cron-driven `watchScheduledTasks()` with `getNextFireTime()`. |

Read the source under `src/` — each file is heavily commented.

---

## API: `query()`

The main entry point. Spawns the CLI, streams messages, exposes control methods.

```ts
import { query } from 'axiomate-sdk'

const q = query({
  prompt: 'Summarize package.json',
  options: {
    model: 'claude-sonnet-4-6',
    maxTurns: 5,
    allowedTools: ['Read', 'Glob'],
    permissionMode: 'bypassPermissions',
  },
})

for await (const msg of q) {
  if (msg.type === 'assistant') {
    for (const block of msg.message.content) {
      if (block.type === 'text') process.stdout.write(block.text)
    }
  } else if (msg.type === 'result') {
    console.log(`\ndone — $${msg.total_cost_usd.toFixed(4)}`)
  }
}
```

**Signature:**

```ts
function query(params: {
  prompt: string | AsyncIterable<SDKUserMessage>
  options?: Options
}): Query
```

- Pass a `string` for one-shot prompts.
- Pass an `AsyncIterable<SDKUserMessage>` for multi-turn streaming input (the agent keeps running until the iterable closes or you call `q.close()`).

`Query` extends `AsyncGenerator<SDKMessage>` and exposes control methods listed [below](#query-control-methods).

---

## API: `tool()` + `createSdkMcpServer()`

Define a tool with a Zod input schema and a handler. Bundle one or more tools into an in-process MCP server, then register it via `options.mcpServers`.

```ts
import { query, tool, createSdkMcpServer } from 'axiomate-sdk'
import { z } from 'zod'

const addTool = tool(
  'add',
  'Add two numbers',
  { a: z.number(), b: z.number() },        // Zod raw shape — NOT z.object(...)
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
  {
    alwaysLoad: true,                       // force-load into system prompt
  },
)

const calc = createSdkMcpServer({
  name: 'calc',
  version: '1.0.0',
  tools: [addTool],
})

const q = query({
  prompt: 'What is 17 + 25?',
  options: {
    mcpServers: { calc },                   // namespace = server name
    allowedTools: ['mcp__calc__add'],       // tool name format: mcp__<server>__<tool>
  },
})
```

**How it works under the hood:**

1. When `query()` starts, the SDK sends an `initialize` control request with the server names (`['calc']`).
2. The CLI registers placeholders so its agent loop knows the tools exist.
3. When the agent decides to call `mcp__calc__add`, the CLI sends an `mcp_message` control request back to the SDK.
4. The SDK routes it to your handler, runs Zod validation, and returns the `CallToolResult`.

You can register multiple SDK MCP servers in one `query()`. You can also mix SDK servers with external `stdio` / `sse` / `http` MCP servers — see [MCP server config types](#mcp-server-config-types).

---

## API: Sessions

These functions read and mutate JSONL session files **without spawning the CLI**. Fast — suitable for UIs, analysis scripts, and management tools.

```ts
import {
  listSessions,
  getSessionInfo,
  getSessionMessages,
  renameSession,
  tagSession,
  forkSession,
} from 'axiomate-sdk'

// All sessions across all projects, most recent first
const all = await listSessions({ limit: 20 })

// Scoped to a specific project's cwd (+ its git worktrees)
const here = await listSessions({ dir: process.cwd() })

// Single session — cheaper than listSessions
const info = await getSessionInfo(sessionId)

// Full transcript
const msgs = await getSessionMessages(sessionId, {
  limit: 50,
  includeSystemMessages: false,
})

// Mutations append JSONL entries to the file:
await renameSession(sessionId, 'My new title')
await tagSession(sessionId, 'wip')          // pass null to clear
await tagSession(sessionId, null)

// Fork — copy main conversation, remap UUIDs, set forkedFrom traceability
const { sessionId: forkId } = await forkSession(sessionId, {
  upToMessageId: messageUuid,               // optional truncation
  title: 'Experimental branch',
})
```

There is also a `unstable_v2_*` preview API for resumable multi-turn sessions on top of `query()`:

```ts
import { unstable_v2_createSession, unstable_v2_prompt } from 'axiomate-sdk'

// Convenience: one-shot prompt returning the final SDKResultMessage
const result = await unstable_v2_prompt('Summarize this codebase.', { model: 'claude-sonnet-4-6' })

// Stateful session — each .send() returns a fresh Query
const session = unstable_v2_createSession({ model: 'claude-sonnet-4-6' })
for await (const msg of session.send('First message')) { /* ... */ }
for await (const msg of session.send('Follow-up')) { /* ... */ }
await session.close()
```

The `unstable_v2_*` names will stabilize before 1.0.

---

## API: Scheduler / cron

Watch `<dir>/.axiomate/scheduled_tasks.json` and react to cron fires.

```ts
import { watchScheduledTasks, buildMissedTaskNotification } from 'axiomate-sdk'

const ac = new AbortController()
const handle = watchScheduledTasks({ dir: process.cwd(), signal: ac.signal })

for await (const event of handle.events()) {
  if (event.type === 'fire') {
    console.log(`fire: ${event.task.prompt}`)
    // Typical daemon: feed event.task.prompt into query() here.
  } else if (event.type === 'missed') {
    console.log(buildMissedTaskNotification(event.tasks))
  }
}

handle.getNextFireTime()  // number | null — epoch ms of soonest upcoming fire
```

The scheduler acquires a per-directory PID-based lock; multiple processes watching the same dir won't double-fire. Non-owning processes poll the lock every 5s and take over if the holder dies. Cancel by aborting the `AbortSignal`.

Lower-level cron primitives are also exported if you want to manage tasks yourself:

```ts
import {
  readCronTasks, writeCronTasks, removeCronTasks, markCronTasksFired,
  findMissedTasks, parseCronExpression, nextCronRunMs,
} from 'axiomate-sdk'

await writeCronTasks(
  [{ id: 'job1', cron: '0 9 * * 1-5', prompt: 'morning standup', createdAt: Date.now(), recurring: true }],
  process.cwd(),
)
```

---

## Options reference

Every field is optional. Fields not listed below are forwarded to the CLI as flags — see `axiomate --help` for the full list.

**Process / model**

| Field | Type | Notes |
|-------|------|-------|
| `cliPath` | `string` | Path to the axiomate binary. Overrides `AXIOMATE_BIN` and PATH lookup. |
| `cwd` | `string` | Working directory for the CLI subprocess. Default: `process.cwd()`. |
| `model` | `string` | Model key from `~/.axiomate.json` or a provider model id. |
| `fallbackModel` | `string` | Fallback when the primary model is overloaded. |
| `effort` | `'low' \| 'medium' \| 'high' \| 'max'` | Per-session effort level. |
| `agent` | `string` | Named agent definition to use. |
| `name` | `string` | Display name for the session (shown in `/resume`). |

**Prompt / instructions**

| Field | Type | Notes |
|-------|------|-------|
| `systemPrompt` | `string` | Replace the default system prompt. |
| `systemPromptFile` | `string` | Read system prompt from a file. |
| `appendSystemPrompt` | `string` | Append after the default system prompt. |
| `appendSystemPromptFile` | `string` | Append from a file. |

**Budgets / limits**

| Field | Type | Notes |
|-------|------|-------|
| `maxTurns` | `number` | Hard cap on agent turns before forced exit. |
| `maxBudgetUsd` | `number` | Hard cap in USD. |
| `taskBudget` | `number` | API-side task budget in tokens. |
| `thinkingConfig` | `{ type: 'enabled' \| 'adaptive' \| 'disabled'; budgetTokens?: number }` | Extended thinking config. |

**Tools / permissions**

| Field | Type | Notes |
|-------|------|-------|
| `allowedTools` | `string[]` | Allow-list (e.g. `['Read', 'Bash(git:*)']`). |
| `disallowedTools` | `string[]` | Deny-list, takes precedence. |
| `tools` | `string[] \| 'default' \| ''` | Reset the built-in tool set; `''` disables all. |
| `permissionMode` | `'default' \| 'acceptEdits' \| 'bypassPermissions' \| 'plan' \| 'dontAsk'` | |
| `dangerouslySkipPermissions` | `boolean` | Shortcut for bypass mode. |
| `permissionPromptTool` | `string` | Custom MCP tool to handle permission prompts. |
| `onPermissionRequest` | `(req) => Promise<PermissionResponse>` | In-process permission handler. See [Permission handling](#permission-handling). |

**MCP / agents / plugins**

| Field | Type | Notes |
|-------|------|-------|
| `mcpServers` | `Record<string, McpServerConfig>` | Mix of `stdio`, `sse`, `http`, `sdk` servers. |
| `mcpConfig` | `string[]` | Paths or JSON strings of additional MCP configs. |
| `strictMcpConfig` | `boolean` | Only use servers from `mcpConfig` / `mcpServers`. |
| `agents` | `Record<string, AgentDefinition>` | Inline custom agents. |
| `agentsJson` | `string` | Raw JSON form; overrides `agents`. |
| `pluginDirs` | `string[]` | Repeated `--plugin-dir`. |

**Sessions / output**

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | Use a specific UUID. |
| `resume` | `string \| boolean` | Resume by id, or `true` for interactive picker. |
| `continue` | `boolean` | Continue the most recent session in cwd. |
| `forkSession` | `boolean` | When resuming, create a new id (preserves history). |
| `persistSession` | `boolean` | Set `false` to disable on-disk persistence. |
| `resumeSessionAt` | `string` | Truncate at a specific message uuid when resuming. |
| `rewindFiles` | `string` | Restore files to state at a message uuid (with `--resume`). |
| `replayUserMessages` | `boolean` | Echo user messages back on stdout. |
| `includePartialMessages` | `boolean` | Emit `SDKPartialAssistantMessage` chunks. |
| `includeHookEvents` | `boolean` | Surface hook lifecycle events. |
| `jsonSchema` | `Record<string, unknown>` | Constrain final output to a JSON schema. |

**Misc**

| Field | Type | Notes |
|-------|------|-------|
| `settings` | `string` | Path to a settings JSON file or a JSON string. |
| `settingSources` | `string[]` | e.g. `['user', 'project', 'local']`. |
| `addDirs` | `string[]` | Extra directories tools may access. |
| `betas` | `string[]` | Beta header values. |
| `disableSlashCommands` | `boolean` | |
| `workload` | `string` | Billing-attribution tag (for daemon callers). |
| `ide` | `boolean` | Auto-connect to a single available IDE. |
| `bare` | `boolean` | Minimal mode (skip hooks, LSP, plugin sync, etc.). |
| `abortSignal` | `AbortSignal` | Killing the signal SIGTERMs the subprocess. |
| `onElicitation` | `(req) => Promise<ElicitationResponse>` | MCP elicitation handler. |

---

## Query control methods

`Query` extends `AsyncGenerator<SDKMessage, void>`. While you're iterating, you can call these methods on the same handle:

```ts
const q = query({ prompt, options })

// Fire-and-forget control (sends a request, doesn't wait for ack):
q.interrupt()                          // cancel the current turn
q.setPermissionMode('acceptEdits')
q.setModel('claude-haiku-4-5')
q.setMaxThinkingTokens(8000)
q.stopTask('task-uuid')
q.applyFlagSettings({ foo: 'bar' })
await q.close()                        // SIGTERM the CLI, drain pending events

// Round-trip control (returns a Promise):
const status = await q.mcpServerStatus()
const usage = await q.getContextUsage()      // tokens by category
const settings = await q.getSettings()       // effective merged settings
const ok = await q.cancelAsyncMessage(uuid)
const rewound = await q.rewindFiles(messageUuid, /* dryRun */ false)
const setResult = await q.setMcpServers({ /* new map */ })
const plugins = await q.reloadPlugins()
await q.reconnectMcpServer('my-server')
await q.toggleMcpServer('my-server', false)
await q.seedReadState('/path/to/file.txt', mtimeMs)
```

All of these are wrappers over the bidirectional control protocol. They share the same stdio channel as the message stream.

---

## SDKMessage variants

`SDKMessage` is a discriminated union on `.type`. Most apps only need the ones marked **common**:

| `type` | When | Common? |
|--------|------|---------|
| `system` (subtype `'init'`) | Session start. Carries model, tools list, MCP server status. | **yes** |
| `assistant` | The agent's turn — content blocks (text / tool_use / thinking). | **yes** |
| `user` | Echoed user messages and tool_result blocks coming back into the loop. | **yes** |
| `result` (subtype `'success'` or `'error_*'`) | Terminal event. Carries usage, cost, num_turns, structured output. | **yes** |
| `status` | Free-form status updates (e.g. "thinking…", "calling tool…"). | sometimes |
| `assistant` (subtype `'partial'`) | Streaming partials. Only when `includePartialMessages: true`. | rarely |
| `tool_progress` | Mid-execution progress from a tool. | rarely |
| `hook_started` / `hook_progress` / `hook_response` | Hook lifecycle. Only when `includeHookEvents: true`. | rarely |
| `task_started` / `task_progress` / `task_notification` | Async subagent tasks. | rarely |
| `session_state_changed` | Permission mode / model / etc. changed mid-session. | rarely |
| `compact_boundary` | Auto-compaction happened — context summarized. | rarely |
| `api_retry` | API call retried due to overload / rate limit. | rarely |
| `auth_status` | Auth state changed. | rarely |
| `rate_limit` | Rate limit hit; agent will wait. | rarely |
| `files_persisted` | Edits actually written to disk. | rarely |
| `local_command_output` | Output from a local shell command run by the CLI. | rarely |
| `tool_use_summary` | Compact summary of a tool call (used by `--include-partial-messages`). | rarely |
| `elicitation_complete` | MCP elicitation finished. | rarely |
| `prompt_suggestion` | Suggested next-prompt for the user. | rarely |

A minimal handler just switches on the four "common" types and ignores the rest:

```ts
for await (const msg of q) {
  if (msg.type === 'system')    { /* note model + tool list */ }
  if (msg.type === 'assistant') { /* render content blocks */ }
  if (msg.type === 'user')      { /* read tool_result content if Array.isArray(msg.content) */ }
  if (msg.type === 'result')    { /* check msg.subtype; record cost/turns */ }
}
```

---

## Environment variables

| Variable | Effect |
|----------|--------|
| `AXIOMATE_BIN` | Path to the CLI binary. Used by the SDK and by `package:*` scripts. |
| `AXIOMATE_CONFIG_DIR` | Override `~/.axiomate/`. Lets you isolate sessions/cron tasks per test or per environment. Read by both the SDK (for session lookups) and the CLI. |

The CLI itself respects many more env vars (`AXIOMATE_API_KEY`, provider-specific keys, etc.). Those are not the SDK's concern — set them in the CLI's environment via the parent process or `options.cwd`-aware shells.

---

## MCP server config types

`options.mcpServers` is a `Record<string, McpServerConfig>` where `McpServerConfig` is one of:

```ts
// In-process, defined via createSdkMcpServer()
{ type: 'sdk', serverInstance: McpSdkServerInstance }

// Subprocess (stdio JSON-RPC)
{ type: 'stdio', command: string, args?: string[], env?: Record<string, string>, cwd?: string }

// Server-Sent Events
{ type: 'sse', url: string, headers?: Record<string, string> }

// Streamable HTTP
{ type: 'http', url: string, headers?: Record<string, string> }
```

Only the `sdk` variant runs in your process. The other three are spawned/connected by the CLI; the SDK just forwards their configs through the `initialize` control request.

---

## Permission handling

The CLI asks the SDK for permission before running a tool whenever the permission rules don't already decide it. Three options, in order of preference:

**1. Pre-approve via `allowedTools` / `disallowedTools`** — simplest, no callback needed:

```ts
options: { allowedTools: ['Read', 'Glob', 'Bash(git status:*)'] }
```

**2. Bypass entirely** — for trusted demos / read-only contexts:

```ts
options: { permissionMode: 'bypassPermissions' }
// or equivalently:
options: { dangerouslySkipPermissions: true }
```

**3. Custom handler** — for UIs that want to surface a dialog:

```ts
options: {
  onPermissionRequest: async (req) => {
    console.log(`Allow ${req.toolName}?`, req.input)
    const allow = await askUser()
    return { decision: allow ? 'allow' : 'deny' }
  },
}
```

If `onPermissionRequest` is omitted and the CLI sends a `can_use_tool` request, the SDK denies (with an error response) unless `permissionMode === 'bypassPermissions'`.

---

## Native capabilities

Computer-use, audio capture, and clipboard access are platform-auto-enabled MCP servers inside the CLI. **The SDK does not expose dedicated configuration for them** — it can't, since they live in the subprocess.

Enable them by allow-listing the tool names:

```ts
options: {
  allowedTools: [
    'mcp__computer-use__screenshot',
    'mcp__computer-use__click',
    'mcp__computer-use__type',
    'mcp__audio-capture__record',
    'mcp__clipboard__read',
    'mcp__clipboard__write',
  ],
}
```

Tool calls and results flow through the standard `SDKMessage` stream — you'll see screenshots come back as image content blocks inside `tool_result`.

---

## Troubleshooting

**"axiomate: command not found"** — the SDK can't find the CLI. Set `AXIOMATE_BIN` to an absolute path or pass `options.cliPath`. On Windows the binary name is `axiomate.exe`.

**Subprocess exits immediately with no output** — the CLI requires `--print --output-format stream-json --input-format stream-json --verbose` to operate in SDK mode. The SDK passes these automatically; if you've added a custom flag that conflicts, the CLI logs to stderr. Check `child.stderr` (`SubprocessHandle.stderr`).

**Hangs forever after the prompt** — the CLI keeps stdin open under stream-json mode and waits for more user messages. Either close the iterable (when using `AsyncIterable<SDKUserMessage>` input) or call `q.close()` after the `result` event.

**`mcp_message` errors with "No SDK MCP server registered"** — your `options.mcpServers` doesn't include an entry with that name as the key, OR the initialize handshake hasn't completed yet. Make sure you pass the SDK server under the same key the agent calls (`mcp__<key>__<tool>` → key `<key>`).

**Permission denied during tool execution** — the CLI sent `can_use_tool` and the SDK returned an error response because no `onPermissionRequest` was set and `permissionMode` wasn't `'bypassPermissions'`. Pick one of the three options under [Permission handling](#permission-handling).

**Session files appear under the wrong directory** — `~/.axiomate/projects/` paths are derived from a NFC-normalized + sanitized `realpath()` of the cwd. Symlinked or path-different invocations land in distinct dirs by design. Set `cwd` in `options` if you want determinism, or set `AXIOMATE_CONFIG_DIR` to fully relocate.

**Cron tasks never fire** — `watchScheduledTasks` needs the per-directory scheduler lock. If another process already holds it, you'll see no fires here. The handle polls every 5s and takes over if the holder dies; `handle.getNextFireTime()` returns `null` while you're a non-owner.
