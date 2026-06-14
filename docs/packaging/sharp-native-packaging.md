# Sharp Native Packaging (Cross-Platform)

Sharp 在打包的单文件 exe 中需要三个组件协同工作：

1. **Build-time plugin** — 替换 `sharp/lib/sharp.js`（原生模块定位器），使其从 exe 同目录加载 .node
2. **Native addon** — 平台特定的 `.node` 文件（sharp 的 C++ binding）
3. **libvips shared library** — sharp 的图像处理后端

## 各平台实现

### macOS (`package-mac.ts`)

| 组件 | 来源包 | 文件 |
|------|--------|------|
| Plugin | `sharpMacRuntimePlugin` | 替换 sharp.js → `require(join(exeDir, runtimeName))` |
| Addon | `@img/sharp-darwin-{arm64,x64}` | `sharp-darwin-{arch}.node` |
| libvips | `@img/sharp-libvips-darwin-{arm64,x64}` | `libvips-cpp.42.dylib` |
| Fixup | `install_name_tool` | 重写 rpath → `@loader_path/` |

### Linux (`package-linux.ts`)

| 组件 | 来源包 | 文件 |
|------|--------|------|
| Plugin | `sharpLinuxRuntimePlugin` | 替换 sharp.js → `require(join(exeDir, runtimeName))` |
| Addon | `@img/sharp-linux-{x64,arm64}` | `sharp-linux-{arch}.node` |
| libvips | `@img/sharp-libvips-linux-{x64,arm64}` | `libvips-cpp.so.42` |
| Fixup | `patchelf --set-rpath $ORIGIN` | 使 .node 从同目录找 libvips |

### Windows (`package-win.ts`)

| 组件 | 来源包 | 文件 |
|------|--------|------|
| Plugin | `sharpWinRuntimePlugin` | 替换 sharp.js → `require(join(exeDir, runtimeName))` + dlopen 回退 |
| Addon | `@img/sharp-win32-x64` | `sharp-win32-x64.node` |
| libvips | `@img/sharp-win32-x64`（同包） | `libvips-42.dll` + `libvips-cpp.dll` |
| Fixup | 无 | Windows DLL 搜索自动查找进程 exe 同目录 |

## 为什么需要 build-time plugin

Sharp 的 `lib/sharp.js` 在运行时通过 `require('@img/sharp-<platform>/sharp.node')` 定位原生 addon。在编译后的单文件 exe 中：
- `@img/sharp-*` npm 包不存在于文件系统
- Bun.plugin 虚拟模块对 require() 无效
- Module._resolveFilename 在 Bun 编译二进制中不生效

所以必须在 **打包时** 替换 sharp.js 的内容，使其直接从 `dirname(process.execPath)` 加载。

## 注意事项

- Windows 的 libvips DLL 打包在 `@img/sharp-win32-x64` 自身内（不像 macOS/Linux 有独立的 `@img/sharp-libvips-*` 包）
- 如果升级 sharp 版本，需同步检查三个平台的 package 脚本和对应的 `@img/sharp-*` 子包名/路径
- `nativeModuleShim.ts` 的 `process.dlopen` shim 是兜底机制（处理动态路径的 .node 加载），但 sharp 的主路径由 plugin 保证
