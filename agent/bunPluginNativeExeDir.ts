// Bun.build plugin: rewrite literal .node imports so they resolve from
// <exeDir>/<basename>.node at runtime instead of Bun's virtual-path resolver.
//
// A Bun-compiled single-file exe bundles all JS into a virtual filesystem
// (B:/~BUN/root/). Literal requires like `require('./foo.node')` or
// `require('@pkg/foo.node')` inside bundled code resolve against that
// virtual path and miss the real .node files copied beside the exe. This
// plugin replaces each literal .node import with a tiny shim that computes
// the absolute on-disk path from `process.execPath` at runtime.
//
// Covers: audio-capture-axiomate, node-screenshots, sharp (@img/sharp-*),
// and every other workspace/third-party package that references .node
// files as static string literals.
//
// The `bindings` package used by @nut-tree-fork/libnut-{win32,darwin} also
// walks from Bun's virtual module path before it reaches process.dlopen. The
// plugin replaces that package with an executable-directory resolver as well.

import { basename } from 'node:path'
import type { BunPlugin } from 'bun'

export const nativeExeDirPlugin: BunPlugin = {
  name: 'native-exe-dir',
  setup(build) {
    build.onResolve({ filter: /\.node$/ }, args => {
      // sharp has its own multi-step runtime loader and package-export
      // resolution; rewriting its .node imports here breaks the path chain
      // that worked in older mac package builds. Leave sharp untouched and
      // only rewrite the simpler direct native imports we control.
      if (/sharp/i.test(args.path)) {
        return
      }
      return {
        path: args.path,
        namespace: 'native-exe-dir',
      }
    })

    build.onLoad({ filter: /.*/, namespace: 'native-exe-dir' }, args => {
      const file = basename(args.path)
      return {
        contents:
          "const { dirname, join } = require('node:path')\n" +
          'const exeDir = dirname(process.execPath)\n' +
          `module.exports = require(join(exeDir, ${JSON.stringify(file)}))\n`,
        loader: 'js',
      }
    })

    build.onResolve({ filter: /^bindings$/ }, () => ({
      path: 'bindings',
      namespace: 'bindings-exe-dir',
    }))

    build.onLoad({ filter: /.*/, namespace: 'bindings-exe-dir' }, () => ({
      contents:
        "const { basename, dirname, join } = require('node:path')\n" +
        'module.exports = function bindings(options) {\n' +
        "  const requested = typeof options === 'string' ? options : options && options.bindings\n" +
        "  if (!requested) throw new Error('bindings resolver requires a binding name')\n" +
        '  const base = basename(requested)\n' +
        "  const file = base.endsWith('.node') ? base : base + '.node'\n" +
        '  return require(join(dirname(process.execPath), file))\n' +
        '}\n',
      loader: 'js',
    }))
  },
}
