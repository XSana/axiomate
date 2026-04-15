import type { ComponentType, ReactNode } from 'react'

export type WizardStepComponent<T extends Record<string, unknown> = Record<string, unknown>> =
  ComponentType<Record<string, never>> | (() => ReactNode)

export type WizardContextValue<T extends Record<string, unknown> = Record<string, unknown>> = {
  currentStepIndex: number
  totalSteps: number
  wizardData: T
  setWizardData: (data: T) => void
  updateWizardData: (updates: Partial<T>) => void
  goNext: () => void
  goBack: () => void
  goToStep: (index: number) => void
  cancel: () => void
  title?: string
  showStepCounter?: boolean
}

export type WizardProviderProps<T extends Record<string, unknown> = Record<string, unknown>> = {
  steps: WizardStepComponent<T>[]
  initialData?: T
  onComplete: (data: T) => void | Promise<void>
  onCancel?: () => void
  children?: ReactNode
  title?: string
  showStepCounter?: boolean
}
