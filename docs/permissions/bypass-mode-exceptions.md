# Bypass Permissions Mode — `.axiomate/` 路径例外

## 背景

`.axiomate/` 目录（项目级和用户级 `~/.axiomate/`）被标记为 `DANGEROUS_DIRECTORIES`，即使在 bypass-permissions 模式下，默认也会触发权限确认。这是为了防止 AI 意外修改用户的配置、hooks 或其他敏感文件。

但部分 `.axiomate/` 子路径是 AI 正常工作流的一部分（plan、skills、agents），在 bypass 模式下应当免权限写入。

## 当前例外规则

### 无条件免权限（任何模式）

| 路径 | 说明 |
|------|------|
| `~/.axiomate/plans/{session-slug}*.md` | 当前 session 的 plan 文件 |
| session scratchpad | 当前 session 的暂存目录 |
| agent memory | agent 自学习记忆目录 |
| memdir (auto memory) | 跨 session 持久记忆（默认路径下） |
| `{project}/.axiomate/launch.json` | desktop preview 配置 |

### bypass-permissions 模式额外免权限

| 路径 | 说明 |
|------|------|
| `~/.axiomate/plans/*.md` | 所有 plan 文件（跨 session） |
| `{project}/.axiomate/skills/**` | 项目级自定义 skills |
| `{project}/.axiomate/commands/**` | 项目级自定义 commands |
| `{project}/.axiomate/agents/**` | 项目级自定义 agents |
| `~/.axiomate/skills/**` | 用户级自定义 skills |
| `~/.axiomate/commands/**` | 用户级自定义 commands |
| `~/.axiomate/agents/**` | 用户级自定义 agents |

### 始终需要权限确认（bypass-immune）

| 路径 | 说明 |
|------|------|
| `~/.axiomate/settings.json` | 用户全局配置 |
| `{project}/.axiomate/settings.json` | 项目配置 |
| `{project}/.axiomate/settings.local.json` | 项目本地配置 |
| `.git/**` | Git 内部文件 |
| `.env*` | 环境变量文件 |
| shell 配置 (`.bashrc`, `.zshrc` 等) | 用户 shell 配置 |

## 设计意图

- **Plan 文件跨 session**：用户常见的工作流是在 session A 创建 plan，关闭后在 session B 继续执行。bypass 模式下放宽匹配避免无谓的权限弹窗。
- **Skills/commands/agents**：这些是用户通过 AI 创建和迭代的自定义扩展，bypass 模式的用户已明确信任 AI 的操作。
- **Settings 始终确认**：设置文件修改可能改变 axiomate 的行为模式（如权限模式本身），必须保持人工确认。

## 实现位置

- 例外判断：`agent/src/utils/permissions/filesystem.ts` → `checkEditableInternalPath()`
- Safety check：`agent/src/utils/permissions/filesystem.ts` → `checkPathSafetyForAutoEdit()`
- Bypass 判断：`agent/src/utils/permissions/permissions.ts` → step 1g / step 2a

## Plan 文件的 session 隔离机制

每个 session 启动时生成唯一的 word slug（如 `brave-fox`），对应文件 `~/.axiomate/plans/brave-fox.md`。同一 session 内写入该文件无条件免权限。

跨 session 时，新 session 的 slug 不同，原 plan 文件不匹配 `isSessionPlanFile()` 检查。在非 bypass 模式下会触发权限确认；在 bypass 模式下通过 `isAnyPlanFile()` 放行。

Fork/Resume 语义：
- **Resume**：复用原 session 的 slug → 继续编辑同一 plan 文件（免权限）
- **Fork**：生成新 slug，复制原 plan 内容 → 独立文件（免权限）
