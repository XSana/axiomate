/**
 * Shared vitest plugins. Imported by vitest.config.ts and the
 * per-layer configs (integration / e2e / all) so all test runs get
 * the same transforms.
 */

/**
 * Transform CJS `require('./foo.js')` → `require('./foo')` for relative
 * imports inside TypeScript source files. Source uses `.js` suffix to
 * satisfy `"module": "NodeNext"` (what tsc emits), but at test time the
 * `.ts` file is what actually exists. Vite's default resolver handles ESM
 * `import` with `.js` suffix by falling back to `.ts`, but CJS `require()`
 * doesn't get the same treatment. Stripping the `.js` lets Vite's resolver
 * find the `.ts` file via default extension resolution.
 *
 * Scoped to project src/ TypeScript files only — won't touch node_modules.
 */
export const relativeRequireJsToTs = {
  name: 'relative-require-js-to-ts',
  transform(code: string, id: string): string | null {
    if (!id.endsWith('.ts') && !id.endsWith('.tsx')) return null
    if (id.includes('/node_modules/')) return null
    const transformed = code.replace(
      /require\((['"])(\.{1,2}\/[^'"]+?)\.js\1\)/g,
      'require($1$2$1)',
    )
    return transformed === code ? null : transformed
  },
}
