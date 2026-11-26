# VibeGame 项目

这是一个 three.js 游戏项目。游戏逻辑只写在 `src/game.ts`，它必须导出 `setup(ctx)` 和 `update(dt, input)` 两个函数。

## 代码约束

- 不要 import 任何模块；THREE 从 `ctx.THREE` 取。
- 不要修改 `src/main.ts`、`src/engine.ts`、`index.html`、`vendor/`。
- 保存 `src/game.ts` 后预览会自动重建，不需要运行构建命令。

## ctx

`ctx` 提供：

- `ctx.THREE`
- `ctx.scene`
- `ctx.camera`
- `ctx.renderer`
- `ctx.backend`：`"webgpu"` 或 `"webgl2"`

`ctx.renderer` 是 `THREE.WebGPURenderer`。WebGPU 优先，WebGPU 不可用时自动回退 WebGL2。

`update(dt, input)` 的 `input.keys` 是当前按下的键，键名小写。

## 性能

- 大量重复物体用 `ctx.THREE.InstancedMesh` 或 `ctx.THREE.BatchedMesh`，不要给每个物体单独 `new ctx.THREE.Mesh`。
- 不要使用 WebGLRenderer 专属 API（例如 `renderer.getContext()`、`renderer.capabilities`）。
- 自定义着色器优先用内置材质；确需自定义时用 TSL，不要写 GLSL。

## 如果你是 Fibona Agent

- 你只有 `game.read()` 和 `game.write(text)`；没有 fs、bash、网络。
- 先 `game.read()` 看当前文件，再用一次 `game.write(完整文件)` 写入新版本；必须是完整文件，不是 diff。
- 一次用户请求最多写 2 个 cell。写完 print 一行中文说明，然后自然结束这个 cell。

## 回复

用中文，保持简短。
