import figures from 'figures'

export type TreeNode = {
  [key: string]: TreeNode | string | undefined
}

export type TreeifyOptions = {
  showValues?: boolean
  hideFunctions?: boolean
  colors?: {
    treeChar?: (text: string) => string
    key?: (text: string) => string
    value?: (text: string) => string
  }
}

type TreeCharacters = {
  branch: string
  lastBranch: string
  line: string
  empty: string
}

const DEFAULT_TREE_CHARS: TreeCharacters = {
  branch: figures.lineUpDownRight, // '├'
  lastBranch: figures.lineUpRight, // '└'
  line: figures.lineVertical, // '│'
  empty: ' ',
}

const identity = (text: string) => text

/**
 * Render a nested object as a terminal tree string.
 * Based on https://github.com/notatestuser/treeify
 */
export function treeify(obj: TreeNode, options: TreeifyOptions = {}): string {
  const {
    showValues = true,
    hideFunctions = false,
    colors = {},
  } = options

  const colorTreeChar = colors.treeChar ?? identity
  const colorKey = colors.key ?? identity
  const colorValue = colors.value ?? identity

  const lines: string[] = []
  const visited = new WeakSet<object>()

  function growBranch(
    node: TreeNode | string,
    prefix: string,
    _isLast: boolean,
    depth: number = 0,
  ): void {
    if (typeof node === 'string') {
      lines.push(prefix + colorValue(node))
      return
    }

    if (typeof node !== 'object' || node === null) {
      if (showValues) {
        const valueStr = String(node)
        lines.push(prefix + colorValue(valueStr))
      }
      return
    }

    // Check for circular references
    if (visited.has(node)) {
      lines.push(prefix + colorValue('[Circular]'))
      return
    }
    visited.add(node)

    const keys = Object.keys(node).filter(key => {
      const value = node[key]
      if (hideFunctions && typeof value === 'function') return false
      return true
    })

    keys.forEach((key, index) => {
      const value = node[key]
      const isLastKey = index === keys.length - 1
      const nodePrefix = depth === 0 && index === 0 ? '' : prefix

      // Determine which tree character to use
      const treeChar = isLastKey
        ? DEFAULT_TREE_CHARS.lastBranch
        : DEFAULT_TREE_CHARS.branch
      const coloredTreeChar = colorTreeChar(treeChar)
      const coloredKey =
        key.trim() === '' ? '' : colorKey(key)

      let line =
        nodePrefix + coloredTreeChar + (coloredKey ? ' ' + coloredKey : '')

      // Check if we should add a colon (not for empty/whitespace keys)
      const shouldAddColon = key.trim() !== ''

      // Check for circular reference before recursing
      if (value && typeof value === 'object' && visited.has(value)) {
        const coloredVal = colorValue('[Circular]')
        lines.push(
          line + (shouldAddColon ? ': ' : line ? ' ' : '') + coloredVal,
        )
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        lines.push(line)
        // Calculate the continuation prefix for nested items
        const continuationChar = isLastKey
          ? DEFAULT_TREE_CHARS.empty
          : DEFAULT_TREE_CHARS.line
        const coloredContinuation = colorTreeChar(continuationChar)
        const nextPrefix = nodePrefix + coloredContinuation + ' '
        growBranch(value, nextPrefix, isLastKey, depth + 1)
      } else if (Array.isArray(value)) {
        // Handle arrays
        lines.push(
          line +
            (shouldAddColon ? ': ' : line ? ' ' : '') +
            '[Array(' +
            value.length +
            ')]',
        )
      } else if (showValues) {
        // Add value if showValues is true
        const valueStr =
          typeof value === 'function' ? '[Function]' : String(value)
        const coloredVal = colorValue(valueStr)
        line += (shouldAddColon ? ': ' : line ? ' ' : '') + coloredVal
        lines.push(line)
      } else {
        lines.push(line)
      }
    })
  }

  // Start growing the tree
  const keys = Object.keys(obj)
  if (keys.length === 0) {
    return colorValue('(empty)')
  }

  // Special case for single empty/whitespace string key
  if (
    keys.length === 1 &&
    keys[0] !== undefined &&
    keys[0].trim() === '' &&
    typeof obj[keys[0]] === 'string'
  ) {
    const firstKey = keys[0]
    const coloredTreeChar = colorTreeChar(DEFAULT_TREE_CHARS.lastBranch)
    const coloredVal = colorValue(obj[firstKey] as string)
    return coloredTreeChar + ' ' + coloredVal
  }

  growBranch(obj, '', true)
  return lines.join('\n')
}
