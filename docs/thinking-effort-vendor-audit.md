# Thinking / Effort / Vendor System Audit

**Date**: 2026-05-17
**Scope**: Schema layer, Vendor template DSL, Effort runtime, Wizard / onboarding, ModelPicker, EffortCallout, /template & /model commands, JSON editor flow, wire path
**Recent commits in scope**: `924239cb`, `f6022ef2`, `9cc54570`, `f1f185e4` (none-effort, partial valueMap, wizard filter, per-model effort)

False positives from raw exploration have been removed. Each finding below is grounded in a verified code reference.

---

## Critical (act before next release)

### C1. `thinking.enabled: false` + `thinking.effort` 非 'none' 时 effort 被静默忽略

**Where**: `agent/src/services/api/vendorTemplates.ts:331-380`

**Code**:
```ts
if (thinking.effort === 'none') {
  if (template.disabledPatch) deepMerge(out, structuredClone(template.disabledPatch))
  return out
}
if (thinking.enabled) {
  if (template.enabledPatch) deepMerge(out, structuredClone(template.enabledPatch))
  if (thinking.effort !== undefined && template.effort) { /* effort patch */ }
  if (thinking.budget !== undefined && template.budget) { /* budget patch */ }
} else {
  if (template.disabledPatch) deepMerge(out, structuredClone(template.disabledPatch))
}
```

**Repro**: User hand-edits `~/.axiomate.json` with `thinking: { enabled: false, effort: 'high' }`. Runtime walks the `else` branch (line 374) and emits `disabledPatch` only — `effort: 'high'` is dropped on the floor. No log, no error. User wonders why high-effort isn't taking effect.

**Severity**: high (silent data loss / contradicts user intent).

**Recommendation**: Add a `logForDebugging` call when `thinking.enabled === false && thinking.effort !== undefined && thinking.effort !== 'none'`. Stretch goal: Zod `.refine` to reject the combination at config load time.

---

### C2. `thinking.budget` 在没有 `template.budget.patch` 的 vendor 上被静默丢弃

**Where**: `agent/src/services/api/vendorTemplates.ts:354-362`

**Code**:
```ts
if (thinking.budget !== undefined && template.budget) {
  const patch = substitutePlaceholder(
    structuredClone(template.budget.patch),
    '<budget>',
    thinking.budget,
  )
  deepMerge(out, patch)
}
```

**Built-in templates without budget**: `openai-default`, `openai-responses`, `deepseek-reasoning`. Anthropic and aliyun/SiliconFlow do support budget.

**Repro**: User configures `thinking: { enabled: true, effort: 'high', budget: 8192 }` on an OpenAI-default model. Budget is silently dropped. User wonders why their token budget isn't capping anything.

**Severity**: high (silent data loss).

**Recommendation**: Add `logForDebugging` when `thinking.budget !== undefined && !template.budget`.

---

## Medium

### M1. `vendor` 与 `protocol` 不交叉校验

**Where**: `agent/src/utils/modelConfigSchema.ts:79-80`

**Code**:
```ts
protocol: z.enum(['openai-chat', 'openai-responses', 'anthropic']),
vendor: z.string().optional(),
```

**Repro**: User writes `protocol: 'openai-chat'` + `vendor: 'anthropic'`. Zod accepts. Runtime resolves the anthropic template (with `output_config.effort` etc.) but the wire body is sent through the OpenAI Chat client. The OpenAI endpoint 400's on the unknown fields; the user gets a vendor-side error instead of a config-side error.

**Severity**: medium (recoverable, but late surface).

**Recommendation**: Zod `.refine`:
```ts
.refine(c => !(c.vendor === 'anthropic' && c.protocol !== 'anthropic'),
        "vendor 'anthropic' requires protocol: 'anthropic'")
.refine(c => !(c.vendor === 'openai-responses' && c.protocol !== 'openai-responses'),
        "vendor 'openai-responses' requires protocol: 'openai-responses'")
```

---

### M2. `extends: '<typo>'` 错误延迟到运行时

**Where**: `agent/src/utils/modelConfigSchema.ts:30` vs `agent/src/services/api/vendorTemplates.ts:228-232`

**Code (Zod)**:
```ts
extends: z.string().optional(),
```

**Code (runtime)**:
```ts
const tpl = customTemplates?.[current] ?? builtinTemplates[current as VendorTemplateName]
if (!tpl) throw new Error(`Unknown vendor template: '${current}'. Built-in templates: ...`)
```

**Repro**: 用户写 `extends: 'openai-defaut'` (typo)。Zod 通过——保存模板成功；下次 model 用这个 template 时才 throw，error 会在请求发送路径上炸。

**Severity**: medium。

**Recommendation**: 在 `/template new` 完成时（保存前）调用 `resolveTemplate(name, knownCustoms)`，捕获 throw 并把错误展示给用户重新编辑。这样错误立即可见。

---

### M3. JSON parse 错误对终端用户不友好（注释 / 尾逗号）

**Where**: `agent/src/utils/promptEditor.ts:273-284`

**Code**:
```ts
try { parsed = JSON.parse(result.content) }
catch (err) {
  const message = err instanceof Error ? err.message : String(err)
  return { ok: false, error: `Invalid JSON: ${message}`, raw: result.content, tempPath }
}
```

**Repro**: 用户在 `$EDITOR` 里写 JSON 时加了 `// 注释` 或尾逗号 `{ x: 1, }`。报错 "Unexpected token /" / "Unexpected token }"——没说"JSON 不支持注释/尾逗号"。

**Severity**: medium（影响 DX）。

**Recommendation**: 把 JSON 错误信息映射到更友好的文案；或在错误下补一句 hint。

---

### M4. `getCyclableEffortLevels` 直接读 `getGlobalConfig().templates`，不像 `applyThinkingTemplate` 接收参数

**Where**: `agent/src/utils/effort.ts:79-82`

**Code**:
```ts
const customTemplates = getGlobalConfig().templates
const vendor = config.vendor ?? inferVendor(config)
let template
try { template = resolveTemplate(vendor, customTemplates) } catch { ... }
```

**与之对比** `applyThinkingTemplate` 是 pure function，由调用方先 resolve template 后传入。

**严重性**：medium（不是 bug，但分层不一致影响可测试性）。审计 agent 之前把这点列为高严重 — 实际是分层差异，**可接受**——因为 `getCyclableEffortLevels` 是 UI helper，需要的是"现在这个 model 的 cyclable set"，从 globalConfig 读 templates 是合理的。但如果将来希望从 settings hot-reload，就需要 caller 传 templates。**建议留档不动**。

---

## Low / 文档级

### L1. wizard `'off'` vs runtime `'none'` 语义混淆

**Where**: `agent/src/components/OnboardingProviderStep.reducer.ts:30` 与 `agent/src/utils/effort.ts:10`

```ts
// Wizard
export type ThinkingChoice = 'off' | 'low' | 'medium' | 'high' | 'max'

// Runtime
export type EffortLevel = 'none' | 'low' | 'medium' | 'high' | 'max'
```

- `wizard 'off'` → 配置文件**省略 thinking 字段** → `modelSupportsEffort=false` → picker 不显示 effort 控件
- `runtime 'none'` → 配置 `thinking: { enabled: true, effort: 'none' }` 时 wire 走 `disabledPatch`

两者都 "关 thinking" 但走不同路径，是有意设计：'off' 是"该模型不进入 effort 体系"，'none' 是"在 effort 体系里临时关一下"。

**Severity**: low（语义合理但易混淆）。

**Recommendation**: 在 `OnboardingProviderStep.reducer.ts` 顶部加注释说明二者区别——已有部分但可加显式对比表。

---

### L2. `'none'` 在 Zod schema 但 `toPersistableEffort` 过滤

**Where**: `agent/src/utils/modelConfigSchema.ts:16` 与 `agent/src/utils/effort.ts:137-149`

**为何不是 bug**：`toPersistableEffort` 只用于 **settings.effortByModel** 写回路径——picker 收起来时调，过滤运行时档位。`models[*].thinking.effort`（在 `~/.axiomate.json`）仍允许 `'none'`，是合法配置（"该模型默认关 thinking，但允许 picker 切档"——上一个 plan 显式支持的 use case）。两个 schema 各管各的，没有冲突。

**Severity**: low / **属于误报**。审计原报告把这条列为 medium，实际不是 bug。**仅记录在此供未来参考**。

---

### L3. dead code: `getEffortLevelDescription` / `getEffortValueDescription`

**Where**: `agent/src/utils/effort.ts:272-296`

Grep 确认无任何 caller。

**Severity**: low（编译产物不变，但增加阅读负担）。

**Recommendation**: 删除。如果未来需要可重新加。

---

### L4. 数值 effort 作为 `EffortValue` 联合类型成员，但 UI 永远不产生数字

**Where**: `agent/src/utils/effort.ts:20`，`parseEffortValue`/`isValidNumericEffort` 只在 env override 路径产生

**Repro**: `AXIOMATE_CODE_EFFORT_LEVEL=42` 启动会产生 number 进 `AppState.effortValueByModel`。`convertEffortValueToLevel` 把数字一律映射到 `'high'`。功能完整但无 UI 入口。

**Severity**: low（latent feature）。

**Recommendation**: 文档化 env override 接受数字的语义，或直接 narrow 为 string-only。

---

### L5. `effortByModel` 可能积累已删除模型的旧 entry

**Where**: `agent/src/utils/settings/types.ts:603-612`

**Repro**: 用户用 picker 给 `gpt-5.4` 设了 high → settings.effortByModel.gpt-5.4 = 'high'。然后用户 `/model edit` 删除 gpt-5.4 → settings.effortByModel 里的旧 entry 不会被清理。

**Severity**: low（不会出错，文件膨胀微小）。

**Recommendation**: `/model remove` 实现时一并清理 effortByModel 里同 id 的 entry。

---

### L6. `'none'` 不暴露在 wizard / EffortCallout

**Where**: `OnboardingProviderStep.tsx:549-555`，`EffortCallout.tsx:75-82`

**为何不是 bug**：故意设计——首次配置场景"开启 thinking 但默认关"反直觉。但**未文档化**。

**Severity**: low。

**Recommendation**: 在 `effort.ts` `EffortLevel` 类型注释里加一句 "'none' is reachable only via ModelPicker cycling; first-config UIs (wizard / callout) intentionally hide it."

---

### L7. 注释 vs 代码：`applyThinkingTemplate` 的 valueMap 'none' 注释

**Where**: `agent/src/services/api/vendorTemplates.ts:328-336`

**Code**:
```ts
// 'none' is a runtime-only override: regardless of thinking.enabled, it
// sends the disabledPatch and skips enabledPatch / effort.patch / budget.
// valueMap remapping does NOT apply — 'none' always means "off".
if (thinking.effort === 'none') {
  if (template.disabledPatch) deepMerge(out, structuredClone(template.disabledPatch))
  return out
}
```

注释说 "valueMap remapping does NOT apply"——代码确实在 valueMap lookup 之前 return，所以**注释是正确的**。但 Zod schema 已用 `.strict()` 禁止 valueMap 含 `'none'` 键，所以注释提到的"防御场景"实际上不可能出现。这条**仅是文档冗余**。

**Severity**: low / **属于误报**（审计原报告标 high，但 Zod 已防住）。

**Recommendation**: 注释保留作为"防御性说明"。可删第三行避免误导。

---

## 报告汇总

| ID | Severity | Action | LoC 估算 |
|---|---|---|---|
| C1 | high | logDebug + 可选 Zod refine | 5–15 |
| C2 | high | logDebug | 5 |
| M1 | medium | 2 个 Zod refine | 10 |
| M2 | medium | TemplateEditor 保存前 dry-resolve | 10 |
| M3 | medium | JSON 错误信息映射 | 10 |
| M4 | medium | 不动（设计取舍） | 0 |
| L1 | low | reducer.ts 顶部注释 | 5 |
| L3 | low | 删 dead code | -25 |
| L5 | low | /model remove 时同步清 | 5 |
| L6 | low | EffortLevel 类型注释 | 3 |

**审计结论**: 系统整体**架构良好**——schema/runtime/UI 三层分离、partial valueMap 设计合理、per-model 持久化已落地。两条 high 都是"用户配置反直觉值时 silent drop"——加 `logForDebugging` 即可。两条 medium（vendor/protocol 校验、extends typo）属于配置友好度优化，可在下一个 PR 一并修。
