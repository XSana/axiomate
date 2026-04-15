import type { AgentColorName } from '../../../tools/AgentTool/agentColorManager.js'
import type { AgentMemoryScope } from '../../../tools/AgentTool/agentMemory.js'
import type { SettingSource } from '../../../utils/settings/constants.js'

export type AgentWizardData = {
  location?: SettingSource
  method?: 'generate' | 'manual'
  agentType?: string
  systemPrompt?: string
  whenToUse?: string
  selectedTools?: string[]
  selectedModel?: string
  selectedColor?: string
  selectedMemory?: AgentMemoryScope
  generationPrompt?: string
  generatedAgent?: any
  isGenerating?: boolean
  wasGenerated?: boolean
  finalAgent?: {
    agentType: string
    whenToUse: string
    getSystemPrompt: () => string
    tools?: string[]
    model?: string
    color?: AgentColorName
    source: SettingSource
    memory?: AgentMemoryScope
  }
}
