# Axiomate

Terminal AI agent with multi-provider support. Fork of Claude Code, rewired to work with any OpenAI-compatible or Anthropic-compatible API endpoint.

Use any model from any provider — SiliconFlow, OpenRouter, local ollama, vLLM, etc. No Anthropic account required.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ with npm
- Git
- [Bun](https://bun.sh/) >= 1.1 (used to build and run the agent)
- [Rust](https://rustup.rs/) toolchain (used for native audio and packaging)

The repo uses npm workspaces and `package-lock.json` for dependency install. Use `npm install` from the repo root; Bun is used by the build/runtime scripts, not as the primary installer.

## Quick Start

```bash
git clone https://github.com/axiomates/axiomate.git
cd axiomate
npm run bootstrap

npm run start
```

### Automated Environment Setup

The bootstrap script works on macOS, Windows, and Linux. It checks Node/npm/Git, installs Bun and Rust when missing, runs `npm install`, builds workspace packages, and builds the agent.

```bash
npm run doctor              # check only, do not install or build
npm run bootstrap           # install tools/deps, build JS workspaces, build agent
npm run bootstrap -- --native
                             # also build platform native NAPI modules
npm run bootstrap -- --no-build
                             # install tools/deps only
```

Useful troubleshooting flags:

```bash
npm run bootstrap -- --skip-tools     # never auto-install Bun/Rust
npm run bootstrap -- --skip-rust      # install/check Bun, skip Rust install
npm run bootstrap -- --skip-install   # do not run npm install
```

`npm run doctor` also checks the transitive packages that Bun commonly reports as missing after an incomplete npm install, such as `lodash.debounce`, `proxy-from-env`, `combined-stream`, `hasown`, `json-schema-traverse`, and `shebang-regex`.

### Platform Notes

#### macOS

Install Apple's compiler tools once:

```bash
xcode-select --install
```

Then run:

```bash
npm run bootstrap
```

For local native modules:

```bash
npm run bootstrap -- --native
```

macOS may ask for Accessibility, Screen Recording, Microphone, or Automation permissions when computer-use, screenshot, audio, or URL handler features are used.

#### Windows

Run from PowerShell or Windows Terminal:

```powershell
npm run bootstrap
```

The script uses the official Bun PowerShell installer and rustup installer when those tools are missing. Native Rust builds may also need Visual Studio 2022 Build Tools with the C++ workload. If native packaging fails, install the toolchain with:

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --source winget --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive"
```

After installing Bun or Rust, a new terminal may be needed if the current shell does not pick up `~/.bun/bin` or `~/.cargo/bin`.

#### Linux

Install system build helpers first. On Debian/Ubuntu:

```bash
sudo apt update
sudo apt install -y curl unzip build-essential pkg-config libasound2-dev xclip wl-clipboard
```

Then run:

```bash
npm run bootstrap
```

For local native audio:

```bash
npm run bootstrap -- --native
```

## Configuration

Models are configured in `~/.axiomate.json`. On first run the file is created automatically — add your models to it:

```jsonc
{
  "searchProviders": {
    "exa": {
      "type": "exa",
      "apiKey": "exa_...",
      "searchType": "auto",
      "numResults": 10
    }
  },
  "models": {
    "qwen/qwen3-235b": {
      "model": "qwen/qwen3-235b",
      "name": "Qwen3 235B",
      "protocol": "openai",
      "baseUrl": "https://openrouter.ai/api/v1",
      "apiKey": "sk-...",
      "effort": "high",
      "contextWindow": 131072,
      "maxOutputTokens": 32768,
      "thinkingParams": {
        "enable_thinking": true,
        "thinking_budget": 8192
      }
    }
  },
  "currentModel": "qwen/qwen3-235b",
  "fastModel": "qwen/qwen3-235b",
  "midModel": "qwen/qwen3-235b"
}
```

### Model Config Fields

| Field | Required | Description |
|-------|----------|-------------|
| `model` | yes | Model ID sent to the provider API |
| `name` | no | Display name in the model picker |
| `protocol` | yes | `"openai"` or `"anthropic"` — determines SDK used |
| `baseUrl` | yes | API endpoint URL |
| `apiKey` | yes | API key for authentication |
| `effort` | no | Fixed effort label shown in the model picker for configured models. Display only; does not automatically send Anthropic `output_config.effort` |
| `contextWindow` | no | Context window size in tokens |
| `maxOutputTokens` | no | Max output tokens per response |
| `supportsImages` | no | Whether the model supports image/vision input. Defaults to `true`. Set to `false` for text-only models to avoid API errors |
| `thinkingParams` | no | Vendor-specific thinking/reasoning params, merged into request when thinking is enabled |
| `extraParams` | no | Extra params merged into every API request body (passthrough) |
### Search Providers

Search providers are configured once at the top level.

Current provider types:

- `"brave-web-search"` — Brave Search API web search endpoint
- `"exa"` — Exa Search API
- `"tavily"` — Tavily Search API
- `"serpapi"` — SerpApi Search API

If `searchProviders` contains multiple entries, `WebSearch` tries them in `searchProviders` order until one works.

Brave example:

```jsonc
{
  "searchProviders": {
    "brave": {
      "type": "brave-web-search",
      "apiKey": "BSA...",
      "baseUrl": "https://api.search.brave.com/res/v1/web/search",
      "country": "US",
      "searchLang": "en",
      "uiLang": "en-US",
      "count": 10,
      "safeSearch": "moderate",
      "extraSnippets": true
    }
  }
}
```

Exa example:

```jsonc
{
  "searchProviders": {
    "exa": {
      "type": "exa",
      "apiKey": "exa_...",
      "baseUrl": "https://api.exa.ai/search",
      "searchType": "auto",
      "category": "news",
      "userLocation": "US",
      "numResults": 10,
      "moderation": false,
      "highlightMaxCharacters": 1200
    }
  }
}
```

Tavily example:

```jsonc
{
  "searchProviders": {
    "tavily": {
      "type": "tavily",
      "apiKey": "tvly-...",
      "baseUrl": "https://api.tavily.com/search",
      "searchDepth": "basic",
      "maxResults": 8,
      "topic": "general",
      "includeAnswer": false,
      "country": "united states",
      "autoParameters": false,
      "exactMatch": false,
      "includeUsage": false
    }
  }
}
```

SerpApi example:

```jsonc
{
  "searchProviders": {
    "serpapi": {
      "type": "serpapi",
      "apiKey": "serp_...",
      "baseUrl": "https://serpapi.com/search.json",
      "engine": "google",
      "googleDomain": "google.com",
      "hl": "en",
      "gl": "us",
      "device": "desktop",
      "safe": "active",
      "num": 10
    }
  }
}
```

Multiple providers with automatic fallback:

```jsonc
{
  "searchProviders": {
    "exa": {
      "type": "exa",
      "apiKey": "exa_..."
    },
    "tavily": {
      "type": "tavily",
      "apiKey": "tvly-..."
    },
    "serpapi": {
      "type": "serpapi",
      "apiKey": "serp_..."
    }
  }
}
```

### Protocol

- `"openai"` — OpenAI-compatible APIs (OpenRouter, SiliconFlow, vLLM, ollama, etc.)
- `"anthropic"` — Anthropic-compatible APIs (Anthropic direct, or providers implementing the Anthropic messages format)

### Multi-Model Setup

- `currentModel` — main model for the conversation loop
- `fastModel` — cheap/fast model for lightweight tasks (token estimation, session search). Falls back to `currentModel`
- `midModel` — mid-tier model for reasoning tasks (memory selection, classification). Falls back to `currentModel`

All three are keys into the `models` map. If only `currentModel` is set, it's used for everything.

## Project Structure

```
axiomate/
  agent/                          Main CLI application
    src/entrypoints/cli.tsx       CLI entry point
    src/services/api/             Provider registry, OpenAI/Anthropic providers
    src/utils/model/              Model selection logic
    src/utils/config.ts           Configuration types and loading
    build.ts                      Dev build script (bundle only)
    package-win.ts                Windows exe packaging script
  clipboard-axiomate/             Clipboard access (Rust NAPI + PowerShell/xclip fallback)
  audio-capture-axiomate/         Audio recording (Rust NAPI, cpal)
  image-processor-axiomate/       Image processing (sharp wrapper)
  computer-use-native-axiomate/   Mouse/keyboard/screenshot (nut-js, node-screenshots)
  computer-use-mcp-axiomate/      Computer use MCP server
  sandbox-axiomate/               Sandbox execution
  treeify-axiomate/               Directory tree display
  mcpb-axiomate/                  MCP bridge
  chrome-mcp-axiomate/            Chrome MCP integration
```

## Build

### Development

Build support workspaces first, then bundle the agent into a single JS file. The development build requires `node_modules` at runtime.

```bash
npm run build        # agent/dist/cli.js
npm run start        # run with Bun
```

`npm run build` includes both support workspace builds and the agent bundle. If you only changed agent source and the support workspaces are already built, use:

```bash
npm run build:agent
```

Manual dependency install:

```bash
npm install
```

Use npm from the repo root so the workspace layout matches `package-lock.json`.

### Tests

```bash
npm run test
```

### Windows Standalone Exe

Compiles everything into a standalone `axiomate.exe` + native addon files. No Bun or node_modules needed to run.

**Additional prerequisite:** Rust with `x86_64-pc-windows-msvc` target.

```bash
npm run package:win
```

Output in `agent/dist/`:

```
axiomate.exe                              ~137 MB  (Bun runtime + all JS)
sharp-win32-x64.node                      image processing
libnut.node                               mouse/keyboard control
node-screenshots.win32-x64-msvc.node      screenshots
audio-capture-axiomate.node               audio recording
```

All files must stay in the same directory. To distribute, copy the entire `dist/` folder.

#### What `package:win` does

1. Compiles `clipboard-axiomate` TypeScript (PowerShell fallback for Windows clipboard)
2. Compiles `audio-capture-axiomate` Rust NAPI (native audio recording via cpal)
3. Bundles all ~6800 JS modules into a single file via `Bun.build()`
4. Compiles the bundle into `axiomate.exe` via `bun build --compile`
5. Copies native `.node` files alongside the exe

## License

MIT
