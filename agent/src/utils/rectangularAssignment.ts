/**
 * Rectangular (n × m) linear-sum assignment.
 *
 * Given a cost matrix, find a subset of row-column pairs such that:
 *   - each row is used at most once
 *   - each column is used at most once
 *   - pairs with cost ≥ forbiddenCost are excluded ("infeasible")
 *   - total cost of selected pairs is minimized
 *
 * For our repair use case, rows are LLM-emitted input keys and columns are
 * schema property names. Replacing the per-key greedy assignment with a
 * globally-optimal one eliminates the "two inputs best-match same property;
 * the displaced one loses to unknown" failure mode.
 *
 * Algorithm: Hungarian (Kuhn-Munkres) O(n³), padded to a square matrix so
 * the rectangular case reduces to the square case. Padding uses a cost
 * strictly larger than `forbiddenCost`, so the algorithm will only pick a
 * padding cell as a last resort — and such cells are discarded from the
 * result. Above `maxDimension` the caller's input is considered pathological
 * and we fall back to greedy sorted-by-cost.
 */

export type AssignmentOptions = {
  /**
   * Pair cost at or above this value is treated as infeasible and never
   * selected in the returned `rowToCol`. Default: 1e9.
   */
  forbiddenCost?: number
  /**
   * Hard cap on `max(rows, cols)` before falling back to greedy. Default: 64.
   * Hungarian is O(n³); 64³ ≈ 260k ops is fine, much larger risks latency.
   */
  maxDimension?: number
}

export type AssignmentResult = {
  /** Map from row index → column index for each selected feasible pair. */
  rowToCol: Map<number, number>
  /** Sum of selected pairs' costs (excluding infeasible/padding). */
  totalCost: number
}

const DEFAULT_FORBIDDEN_COST = 1e9
const DEFAULT_MAX_DIMENSION = 64

export function rectangularAssignment(
  costMatrix: readonly (readonly number[])[],
  options: AssignmentOptions = {},
): AssignmentResult {
  const forbiddenCost = options.forbiddenCost ?? DEFAULT_FORBIDDEN_COST
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION

  const n = costMatrix.length
  const m = n > 0 ? costMatrix[0]!.length : 0
  if (n === 0 || m === 0) {
    return { rowToCol: new Map(), totalCost: 0 }
  }

  if (Math.max(n, m) > maxDimension) {
    return greedyAssignment(costMatrix, forbiddenCost)
  }

  // Pad to square N×N with padding cost strictly greater than forbiddenCost
  // so the algorithm uses real feasible cells whenever possible. Real
  // forbidden cells stay above padding only if `forbiddenCost` itself is
  // set high enough — padding is `forbiddenCost + 1`, guaranteed > any
  // forbidden real cell because we also treat `>= forbiddenCost` as forbidden.
  const N = Math.max(n, m)
  const paddingCost = forbiddenCost + 1
  const padded: number[][] = new Array(N)
  for (let i = 0; i < N; i++) {
    const row = new Array<number>(N)
    for (let j = 0; j < N; j++) {
      if (i < n && j < m) {
        const c = costMatrix[i]![j]!
        // Normalize: any cost >= forbiddenCost collapses to a uniform value
        // > padding, so Hungarian consistently avoids them.
        row[j] = c >= forbiddenCost ? paddingCost + 1 : c
      } else {
        row[j] = paddingCost
      }
    }
    padded[i] = row
  }

  const rowToColSquare = hungarian(padded, N)

  const rowToCol = new Map<number, number>()
  let totalCost = 0
  for (let i = 0; i < n; i++) {
    const j = rowToColSquare[i]
    if (j === undefined || j < 0 || j >= m) continue
    const original = costMatrix[i]![j]!
    if (original >= forbiddenCost) continue
    rowToCol.set(i, j)
    totalCost += original
  }
  return { rowToCol, totalCost }
}

// ---------------------------------------------------------------------------
// Hungarian algorithm (1-indexed internally, per the classical formulation)
// ---------------------------------------------------------------------------

function hungarian(cost: readonly (readonly number[])[], n: number): number[] {
  const u = new Array<number>(n + 1).fill(0)
  const v = new Array<number>(n + 1).fill(0)
  const p = new Array<number>(n + 1).fill(0)
  const way = new Array<number>(n + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY)
    const used = new Array<boolean>(n + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]!
      let delta = Number.POSITIVE_INFINITY
      let j1 = 0
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!
          if (cur < minv[j]!) {
            minv[j] = cur
            way[j] = j0
          }
          if (minv[j]! < delta) {
            delta = minv[j]!
            j1 = j
          }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta
          v[j] = v[j]! - delta
        } else {
          minv[j] = minv[j]! - delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)

    do {
      const j1 = way[j0]!
      p[j0] = p[j1]!
      j0 = j1
    } while (j0)
  }

  const rowToCol = new Array<number>(n).fill(-1)
  for (let j = 1; j <= n; j++) {
    const i = p[j]!
    if (i !== 0) rowToCol[i - 1] = j - 1
  }
  return rowToCol
}

// ---------------------------------------------------------------------------
// Greedy fallback for pathological dimensions
// ---------------------------------------------------------------------------

function greedyAssignment(
  costMatrix: readonly (readonly number[])[],
  forbiddenCost: number,
): AssignmentResult {
  const n = costMatrix.length
  const m = costMatrix[0]?.length ?? 0
  type Cell = { row: number; col: number; cost: number }
  const cells: Cell[] = []
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < m; j++) {
      const c = costMatrix[i]![j]!
      if (c < forbiddenCost) cells.push({ row: i, col: j, cost: c })
    }
  }
  cells.sort((a, b) => a.cost - b.cost)
  const usedRows = new Set<number>()
  const usedCols = new Set<number>()
  const rowToCol = new Map<number, number>()
  let totalCost = 0
  for (const cell of cells) {
    if (usedRows.has(cell.row) || usedCols.has(cell.col)) continue
    usedRows.add(cell.row)
    usedCols.add(cell.col)
    rowToCol.set(cell.row, cell.col)
    totalCost += cell.cost
  }
  return { rowToCol, totalCost }
}
