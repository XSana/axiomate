import * as React from 'react'
import { Box, Text } from '../../ink.js'
import chalk from 'chalk'
import type { CommandResultDisplay } from '../../commands.js'
import { Select } from '../../components/CustomSelect/select.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  deleteTemplateFromConfig,
  getGlobalConfig,
} from '../../utils/config.js'
import {
  getBuiltinTemplates,
  isBuiltinVendor,
  resolveTemplate,
} from '../../services/api/vendorTemplates.js'
import { TemplateEditor } from './TemplateEditor.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = (args ?? '').trim()
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const sub = parts[0] ?? 'list'

  if (sub === 'list' || sub === 'ls') {
    return <ListTemplatesAndClose onDone={onDone} />
  }

  if (sub === 'show') {
    const name = parts.slice(1).join(' ')
    if (!name) {
      onDone('Usage: /template show <name>', { display: 'system' })
      return
    }
    return <ShowTemplateAndClose name={name} onDone={onDone} />
  }

  if (sub === 'new' || sub === 'add') {
    return <NewTemplateAndClose onDone={onDone} />
  }

  if (sub === 'delete' || sub === 'rm') {
    const name = parts.slice(1).join(' ')
    if (!name) {
      onDone('Usage: /template delete <name>', { display: 'system' })
      return
    }
    return <DeleteTemplateAndClose name={name} onDone={onDone} />
  }

  if (sub === '--help' || sub === '-h' || sub === 'help') {
    onDone(
      'Subcommands:\n' +
        '  /template list                 — list built-in and custom templates\n' +
        '  /template show <name>          — show resolved template JSON\n' +
        '  /template new                  — create a custom template (interactive)\n' +
        '  /template delete <name>        — delete a custom template (built-ins are protected)',
      { display: 'system' },
    )
    return
  }

  onDone(`Unknown /template subcommand: '${sub}'. Try /template help.`, {
    display: 'system',
  })
}

function ListTemplatesAndClose({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  React.useEffect(() => {
    const builtins = Object.keys(getBuiltinTemplates()).sort()
    const customs = Object.keys(getGlobalConfig().templates ?? {}).sort()
    const lines = [
      chalk.bold('Built-in templates:'),
      ...builtins.map(n => `  ${chalk.cyan(n)}`),
    ]
    if (customs.length > 0) {
      lines.push('', chalk.bold('Custom templates:'))
      for (const n of customs) {
        const tpl = getGlobalConfig().templates![n]
        const ext = tpl.extends ? ` (extends ${chalk.dim(tpl.extends)})` : ''
        lines.push(`  ${chalk.cyan(n)}${ext}`)
      }
    } else {
      lines.push('', chalk.dim('No custom templates. Run /template new to add one.'))
    }
    onDone(lines.join('\n'))
  }, [onDone])
  return null
}

function ShowTemplateAndClose({
  name,
  onDone,
}: {
  name: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  React.useEffect(() => {
    const builtins = getBuiltinTemplates()
    const customs = getGlobalConfig().templates ?? {}
    if (!(name in builtins) && !(name in customs)) {
      onDone(`Template '${name}' not found. Run /template list to see available templates.`, {
        display: 'system',
      })
      return
    }
    try {
      const resolved = resolveTemplate(name, customs)
      onDone(
        `${chalk.bold(name)}${name in customs ? ' (custom)' : ' (built-in)'}\n` +
          JSON.stringify(resolved, null, 2),
      )
    } catch (err) {
      onDone(`Error resolving '${name}': ${(err as Error).message}`, {
        display: 'system',
      })
    }
  }, [name, onDone])
  return null
}

function NewTemplateAndClose({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  return (
    <TemplateEditor
      onComplete={name =>
        onDone(`Template ${chalk.bold(name)} saved to ~/.axiomate.json`)
      }
      onCancel={reason => onDone(reason ?? 'Cancelled', { display: 'system' })}
    />
  )
}

function DeleteTemplateAndClose({
  name,
  onDone,
}: {
  name: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const customs = getGlobalConfig().templates ?? {}
  const isBuiltin = isBuiltinVendor(name)
  const exists = name in customs

  React.useEffect(() => {
    if (isBuiltin) {
      onDone(`'${name}' is a built-in template and cannot be deleted.`, {
        display: 'system',
      })
    } else if (!exists) {
      onDone(`Custom template '${name}' not found.`, { display: 'system' })
    }
  }, [name, isBuiltin, exists, onDone])

  if (isBuiltin || !exists) return null

  return (
    <Box flexDirection="column" paddingLeft={1} gap={1}>
      <Text>
        Delete custom template <Text bold>{name}</Text>?
      </Text>
      <Text dimColor>
        Models referencing this template via `vendor: "{name}"` will fail validation
        until the field is updated.
      </Text>
      <Select
        options={[
          { label: 'No — keep template', value: 'no' },
          { label: 'Yes — delete', value: 'yes' },
        ]}
        onChange={v => {
          if (v === 'yes') {
            deleteTemplateFromConfig(name)
            onDone(`Deleted template ${chalk.bold(name)}`)
          } else {
            onDone(`Kept template ${chalk.bold(name)}`, { display: 'system' })
          }
        }}
        onCancel={() =>
          onDone(`Kept template ${chalk.bold(name)}`, { display: 'system' })
        }
      />
    </Box>
  )
}
