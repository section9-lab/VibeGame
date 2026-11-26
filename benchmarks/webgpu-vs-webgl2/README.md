# WebGPU vs WebGL2 benchmark

This benchmark compares the two backends of the same `THREE.WebGPURenderer`
(three.js 0.187). The WebGL2 run only adds `forceWebGL: true`; the scene code,
materials, lights and measurement loop are identical.

## Run

From the repository root:

```
hutch run bench:gpu
```

Or directly:

```
swift benchmarks/webgpu-vs-webgl2/run-wkwebview.swift
```

The Swift runner starts a local `python3 -m http.server` on port 8788, opens a
visible WKWebView, waits for `window.__bench.done`, writes `results.json` next to
this file, then stops the server.

A visible window is required. WebKit throttles `requestAnimationFrame` for hidden
or occluded WKWebViews.

## What is measured

Two numbers per case:

- `raf`: real animation-loop FPS over 2 seconds. This is what a player sees, but
  it is capped by the display refresh rate (60 fps here).
- `throughput`: 90 back-to-back renders, timed until the GPU has actually
  finished. WebGPU waits on `queue.onSubmittedWorkDone()`; WebGL2 waits on a 1x1
  `readPixels` because `gl.finish()` alone did not block in this WKWebView build.
  This removes the vsync cap and shows backend headroom.

Canvas: 1280 × 720 CSS pixels at `devicePixelRatio = 2` (2560 × 1440 drawing
buffer). Antialiasing is off in both runs. Shadow cases use one 2048² directional
shadow map.

Cases:

- `instanced-150k`: 150,000 instanced cubes, 1 draw call, 1.8M triangles.
- `unique-8k`: 8,000 separate meshes, 8,000 draw calls, 96k triangles.
- `triangles-8m`: 2,000 instanced torus knots, 1 draw call, about 8.2M triangles.
- `shadows-4k`: 4,000 separate shadow-casting meshes plus ground, one shadow pass.

## Results

Machine: Apple M5, 8-core GPU, macOS 26.6, WKWebView (WebKit), three.js 0.187.
Values below are medians of two passes. Full raw data: `results.json`.

`instanced-150k`

- WebGPU: 60.6 rAF fps, 450.0 throughput fps
- WebGL2: 60.6 rAF fps, 412.0 throughput fps
- Difference: rAF +0.0% (vsync capped), throughput +9.2%

`unique-8k`

- WebGPU: 52.6 rAF fps, 83.0 throughput fps
- WebGL2: 43.1 rAF fps, 77.2 throughput fps
- Difference: rAF +21.9%, throughput +7.5%

`triangles-8m`

- WebGPU: 60.3 rAF fps, 375.3 throughput fps
- WebGL2: 60.7 rAF fps, 381.5 throughput fps
- Difference: rAF -0.7%, throughput -1.6% (within noise)

`shadows-4k`

- WebGPU: 57.7 rAF fps, 209.8 throughput fps
- WebGL2: 38.8 rAF fps, 172.8 throughput fps
- Difference: rAF +48.9%, throughput +21.4%

## Interpretation

- WebGPU wins clearly when the CPU or shadow pipeline is the bottleneck
  (`unique-8k`, `shadows-4k`). That matches the architecture: fewer per-draw CPU
  costs, better command submission, and a more efficient shadow path.
- Heavy but well-batched vertex work (`instanced-150k`, `triangles-8m`) is already
  fast in both backends; vsync hides the difference and throughput is close.
- WebGPU is not a magic multiplier. A scene with 8,000 independent meshes is
  still slow in absolute terms; instancing/batching remains the first fix.

## Caveats

- One machine, one OS, one WebKit build. Do not generalize to Windows WebView2 or
  Linux WebKitGTK without re-running there.
- `requestAnimationFrame` is capped at 60 fps. The throughput number is the better
  signal for headroom, but it is a synthetic loop, not an interactive session.
- WebGPU `renderer.info.render.drawCalls/triangles` reported 0 in this build, so
  the benchmark does not use `renderer.info` for scene accounting.
- Antialiasing is off. The app template currently enables it, so real preview
  numbers will be lower for both backends.
- The benchmark intentionally uses the same three.js renderer for both runs. It
  does not compare a WebGL-only three build against a WebGPU-only build.
