# CLI Non-Interactive Testing

本文记录 Axiomate CLI 的常用非交互测试命令，适合验证模型配置、provider 请求形状、工具调用回合、debug 日志和错误恢复。

## 基本入口

从仓库根目录运行源码构建后的 CLI:

```powershell
pnpm --filter ./agent run build
pnpm --filter ./agent run start -- -p "Say OK only."
```

等价的根脚本入口:

```powershell
pnpm run start -- -p "Say OK only."
```

如果 `agent/dist/cli.js` 不存在，先运行:

```powershell
pnpm --filter ./agent run build
```

查看 CLI 参数:

```powershell
pnpm --filter ./agent run start -- --help
```

## 常用参数

```powershell
pnpm --filter ./agent run start -- `
  -p `
  --model deepseek-v4-pro `
  --permission-mode bypassPermissions `
  --max-turns 6 `
  --no-session-persistence `
  "Say OK only."
```

常用开关:

- `-p` / `--print`: 非交互模式，输出后退出。
- `--model <id>`: 指定 `~/.axiomate.json` 里的模型 key，或直接指定 provider 模型名。
- `--permission-mode bypassPermissions`: 脚本验证时跳过工具权限确认。
- `--max-turns <n>`: 限制 agentic 回合数，适合工具调用测试。
- `--no-session-persistence`: 不写入可恢复会话，避免测试污染历史。
- `--output-format json`: 输出单个 JSON 结果。
- `--output-format stream-json`: 输出事件流，适合自动化断言。
- `--include-partial-messages`: 配合 `stream-json` 查看增量输出。
- `--debug`: 启用 debug。
- `--debug-file <path>`: 写到指定 debug 文件，同时隐式启用 debug。

默认 debug 文件位于:

```text
C:\Users\kiro\.axiomate\debug
```

## 隔离环境

`--bare` 用于最小化启动路径:

```powershell
pnpm --filter ./agent run start -- `
  --bare `
  -p `
  --model deepseek-v4-pro `
  "Say OK only."
```

`--bare` 会跳过 hooks、LSP、插件同步、自动 memory、AXIOMATE.md 自动发现和未显式请求的 MCP。它仍会读取 `~/.axiomate.json` 中已配置模型的凭据。

在 `--bare` 下，内置工具集通常只保留 `Bash`、`Read`、`Edit`。如果要强制文件创建，优先用 `Bash`，因为 `Write` 不在 simple tool set 里:

```powershell
$env:ENABLE_TOOL_SEARCH = 'false'
pnpm --filter ./agent run start -- `
  --bare `
  -p `
  --model deepseek-v4-pro `
  --permission-mode bypassPermissions `
  --tools 'Bash,Read' `
  --max-turns 6 `
  --no-session-persistence `
  "Use the Bash tool to create tmp-cli-smoke.txt containing exactly: ok. Then answer with only ok."
Remove-Item Env:ENABLE_TOOL_SEARCH -ErrorAction SilentlyContinue
```

`ENABLE_TOOL_SEARCH=false` 会禁用 ToolSearchTool，方便 debug 日志里直接看到真实工具数量。PowerShell 中建议把工具列表作为一个整体字符串传入，例如 `--tools 'Bash,Read'`。

## DeepSeek Thinking 回放验证

DeepSeek V4 thinking 模式的关键测试是两轮请求:

1. 第一轮模型必须产生 tool call，并返回 thinking/reasoning。
2. CLI 执行工具。
3. 第二轮请求必须把上一轮 assistant 的 thinking 按对应 provider 形状回放。

第三方 relay DeepSeek V4 Pro:

这个测试只验证默认 DeepSeek V4+ 的 `reasoning_content` 回放路径。
对应模型配置必须显式写 `modelTemplate: "openai-chat-deepseek-v4p"`；
如果留空，runtime 不会按模型名自动套用 model template，第二轮请求也不应出现 `hasReasoning=true`。

```powershell
$debug = 'C:\public\workspace\axiomate\tmp-relay-dsv4-roundtrip-debug.log'
$out = 'C:\public\workspace\axiomate\tmp-relay-dsv4-roundtrip-output.txt'
Remove-Item $debug,$out,'C:\public\workspace\axiomate\tmp-relay-roundtrip.txt' -ErrorAction SilentlyContinue
$env:ENABLE_TOOL_SEARCH = 'false'
pnpm --filter ./agent run start -- `
  --bare `
  -p `
  --debug `
  --debug-file $debug `
  --model your-relay-deepseek-v4-pro `
  --permission-mode bypassPermissions `
  --tools 'Bash,Read' `
  --max-turns 6 `
  --no-session-persistence `
  "Use the Bash tool to create a file named tmp-relay-roundtrip.txt containing exactly one line: relay roundtrip ok. Then answer with only the exact file contents." *> $out
Remove-Item Env:ENABLE_TOOL_SEARCH -ErrorAction SilentlyContinue
Select-String -Path $debug -Pattern 'messagesToOpenAI|stream-request|stream-create-error|API error'
```

期望:

- 第一轮 `stream-request` 成功。
- debug 中出现 `messagesToOpenAI` 的第二轮请求摘要。
- 默认 DeepSeek V4+ 回放形状为顶层 `reasoning_content`，第二轮 assistant tool-call message 应显示 `hasReasoning=true`。

官方 DeepSeek V4 Pro:

```powershell
$debug = 'C:\public\workspace\axiomate\tmp-official-dsv4-roundtrip-debug.log'
$out = 'C:\public\workspace\axiomate\tmp-official-dsv4-roundtrip-output.txt'
Remove-Item $debug,$out,'C:\public\workspace\axiomate\tmp-official-ds-roundtrip.txt' -ErrorAction SilentlyContinue
$env:ENABLE_TOOL_SEARCH = 'false'
pnpm --filter ./agent run start -- `
  --bare `
  -p `
  --debug `
  --debug-file $debug `
  --model deepseek-v4-pro `
  --permission-mode bypassPermissions `
  --tools 'Bash,Read' `
  --max-turns 6 `
  --no-session-persistence `
  "Use the Bash tool to create a file named tmp-official-ds-roundtrip.txt containing exactly one line: official roundtrip ok. Then answer with only the exact file contents." *> $out
Remove-Item Env:ENABLE_TOOL_SEARCH -ErrorAction SilentlyContinue
Select-String -Path $debug -Pattern 'messagesToOpenAI|stream-request|stream-create-error|API error'
```

期望:

- 第二轮 assistant tool-call message `hasReasoning=true`。
- 官方 DeepSeek 使用顶层 `reasoning_content` 回放。
- 没有 request-shape 400。

## 输出和日志检查

查看命令输出尾部:

```powershell
Get-Content .\tmp-relay-dsv4-roundtrip-output.txt -Tail 40
```

查看关键 debug 行:

```powershell
Select-String -Path .\tmp-relay-dsv4-roundtrip-debug.log `
  -Pattern 'stream-request|messagesToOpenAI|stream-create-error|API error' |
  Select-Object -Last 40 |
  ForEach-Object { $_.Line }
```

检查临时文件并清理:

```powershell
Get-Content .\tmp-relay-roundtrip.txt
Remove-Item .\tmp-relay-roundtrip.txt -ErrorAction SilentlyContinue
```

## 常见问题

- `Module not found "dist/cli.js"`: 先运行 `pnpm --filter ./agent run build`。
- 工具数量比预期多: 使用 `--bare`，并设置 `$env:ENABLE_TOOL_SEARCH='false'`。
- `--tools Write,Read` 没有暴露 `Write`: `--bare` simple tool set 不含 `Write`，使用 `Bash` 创建文件。
- MCP schema 400 干扰 provider 测试: 使用 `--bare` 隔离自动 MCP。
- Debug 文件找不到: 用绝对路径传给 `--debug-file`；不传时看 `C:\Users\kiro\.axiomate\debug`。
- 日志可能包含请求摘要、模型名、路径和错误信息；不要把包含 API key 的配置文件或完整请求体贴到 issue 里。
