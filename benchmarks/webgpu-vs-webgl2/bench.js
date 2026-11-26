// WebGPU vs WebGL2 benchmark for the VibeGame renderer.
// Both backends use the exact same three.js WebGPURenderer API; the WebGL2 run
// only sets forceWebGL: true. This isolates the backend instead of comparing
// different three.js builds.
import * as THREE from "../../resources/template/vendor/three.webgpu.js";

const WIDTH = 1280;
const HEIGHT = 720;
const PIXEL_RATIO = 2;
const RAF_MS = 2000;
const THROUGHPUT_MIN_MS = 1200;
const THROUGHPUT_MAX_FRAMES = 90;
const WARMUP_FRAMES = 20;
const ORDER = [
	["webgpu", "webgl2"],
	["webgl2", "webgpu"],
];

const statusEl = document.getElementById("status");
const status = {
	phase: "starting",
	done: false,
	results: [],
	errors: [],
	environment: {
		userAgent: navigator.userAgent,
		dpr: window.devicePixelRatio,
		width: WIDTH,
		height: HEIGHT,
		pixelRatio: PIXEL_RATIO,
		antialias: false,
		rafMs: RAF_MS,
		throughputMinMs: THROUGHPUT_MIN_MS,
	},
	adapter: null,
};
window.__bench = status;

function show(line) {
	if (statusEl) statusEl.textContent = line;
}

function updateStatus() {
	const last = status.results.at(-1);
	show(
		`${status.phase}\n` +
			(last
				? `${last.backend} ${last.case}: raf ${last.raf.fps.toFixed(1)} fps · throughput ${last.throughput.fps.toFixed(1)} fps`
				: ""),
	);
}

function baseScene() {
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b0b10);

	const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 500);
	camera.position.set(0, 16, 30);
	camera.lookAt(0, 0, 0);

	scene.add(new THREE.HemisphereLight(0xffffff, 0x222233, 1.6));
	const sun = new THREE.DirectionalLight(0xffffff, 2.2);
	sun.position.set(8, 22, 12);
	scene.add(sun);

	return { scene, camera, sun };
}

function addGround(scene) {
	const ground = new THREE.Mesh(
		new THREE.PlaneGeometry(120, 120),
		new THREE.MeshStandardMaterial({ color: 0x171722, roughness: 1 }),
	);
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = true;
	scene.add(ground);
	return ground;
}

function buildInstanced(count) {
	const { scene, camera } = baseScene();
	const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
	const material = new THREE.MeshStandardMaterial({
		color: 0x4cc9f0,
		roughness: 0.45,
		metalness: 0.1,
	});
	const mesh = new THREE.InstancedMesh(geometry, material, count);
	const dummy = new THREE.Object3D();
	const side = Math.ceil(Math.sqrt(count));
	for (let i = 0; i < count; i++) {
		const x = ((i % side) - side / 2) * 1.15;
		const z = (Math.floor(i / side) - side / 2) * 1.15;
		dummy.position.set(x, 0.35, z);
		dummy.rotation.set(0, (i % 17) * 0.37, 0);
		dummy.scale.setScalar(0.7 + ((i * 37) % 100) / 250);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	scene.add(mesh);
	return {
		scene,
		camera,
		dispose: () => disposeScene(scene),
	};
}

function buildUnique(count) {
	const { scene, camera } = baseScene();
	const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
	const material = new THREE.MeshStandardMaterial({
		color: 0xff8a3d,
		roughness: 0.55,
		metalness: 0.05,
	});
	const side = Math.ceil(Math.sqrt(count));
	for (let i = 0; i < count; i++) {
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(
			((i % side) - side / 2) * 1.15,
			0.35,
			(Math.floor(i / side) - side / 2) * 1.15,
		);
		mesh.rotation.y = (i % 17) * 0.37;
		scene.add(mesh);
	}
	return {
		scene,
		camera,
		dispose: () => disposeScene(scene),
	};
}

function buildTriangles(instances) {
	const { scene, camera } = baseScene();
	// 128 × 16 torus knot: about 2,048 triangles per instance before instancing.
	const geometry = new THREE.TorusKnotGeometry(0.35, 0.12, 128, 16);
	const material = new THREE.MeshStandardMaterial({
		color: 0x9b8cff,
		roughness: 0.35,
		metalness: 0.2,
	});
	const mesh = new THREE.InstancedMesh(geometry, material, instances);
	const dummy = new THREE.Object3D();
	const side = Math.ceil(Math.sqrt(instances));
	for (let i = 0; i < instances; i++) {
		dummy.position.set(
			((i % side) - side / 2) * 2.6,
			1,
			(Math.floor(i / side) - side / 2) * 2.6,
		);
		dummy.rotation.set(0.3, (i % 23) * 0.27, 0.1);
		dummy.scale.setScalar(1);
		dummy.updateMatrix();
		mesh.setMatrixAt(i, dummy.matrix);
	}
	mesh.instanceMatrix.needsUpdate = true;
	scene.add(mesh);
	return {
		scene,
		camera,
		dispose: () => disposeScene(scene),
	};
}

function buildShadowedUnique(count) {
	const { scene, camera, sun } = baseScene();
	addGround(scene);
	sun.castShadow = true;
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.camera.left = -35;
	sun.shadow.camera.right = 35;
	sun.shadow.camera.top = 35;
	sun.shadow.camera.bottom = -35;
	sun.shadow.camera.near = 0.5;
	sun.shadow.camera.far = 90;

	const geometry = new THREE.BoxGeometry(0.6, 0.6, 0.6);
	const material = new THREE.MeshStandardMaterial({
		color: 0xff6b6b,
		roughness: 0.5,
		metalness: 0.05,
	});
	const side = Math.ceil(Math.sqrt(count));
	for (let i = 0; i < count; i++) {
		const mesh = new THREE.Mesh(geometry, material);
		mesh.position.set(
			((i % side) - side / 2) * 1.3,
			0.35,
			(Math.floor(i / side) - side / 2) * 1.3,
		);
		mesh.rotation.y = (i % 17) * 0.37;
		mesh.castShadow = true;
		mesh.receiveShadow = true;
		scene.add(mesh);
	}
	return {
		scene,
		camera,
		dispose: () => disposeScene(scene),
	};
}

const CASES = [
	{ id: "instanced-150k", label: "150k instanced cubes", shadows: false, build: () => buildInstanced(150000) },
	{ id: "unique-8k", label: "8k unique meshes", shadows: false, build: () => buildUnique(8000) },
	{ id: "triangles-8m", label: "8M triangles (instanced)", shadows: false, build: () => buildTriangles(2000) },
	{ id: "shadows-4k", label: "4k unique + shadows", shadows: true, build: () => buildShadowedUnique(4000) },
];

function disposeScene(scene) {
	const seen = new Set();
	scene.traverse((object) => {
		if (object.geometry && !seen.has(object.geometry)) {
			seen.add(object.geometry);
			object.geometry.dispose();
		}
		const materials = Array.isArray(object.material) ? object.material : [object.material];
		for (const material of materials) {
			if (material && !seen.has(material)) {
				seen.add(material);
				material.dispose();
			}
		}
	});
	scene.clear();
}

async function createRenderer(backend, shadows) {
	const canvas = document.createElement("canvas");
	canvas.style.width = `${WIDTH}px`;
	canvas.style.height = `${HEIGHT}px`;
	document.body.appendChild(canvas);

	const renderer = new THREE.WebGPURenderer({
		canvas,
		antialias: false,
		powerPreference: "high-performance",
		forceWebGL: backend === "webgl2",
	});
	await renderer.init();
	renderer.setPixelRatio(PIXEL_RATIO);
	renderer.setSize(WIDTH, HEIGHT, false);
	renderer.shadowMap.enabled = shadows;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	return { renderer, canvas };
}

function disposeRenderer(renderer, canvas) {
	try {
		renderer.setAnimationLoop(null);
	} catch {}
	try {
		renderer.dispose();
	} catch {}
	canvas.remove();
}

async function syncRenderer(renderer) {
	const backend = renderer.backend;
	if (backend?.isWebGPUBackend) {
		const device = backend.device;
		const started = performance.now();
		if (device?.queue?.onSubmittedWorkDone) await device.queue.onSubmittedWorkDone();
		return { kind: "webgpu", waitMs: performance.now() - started };
	}
	const gl = backend?.getContext?.() ?? backend?.gl;
	if (!gl) return { kind: "none", waitMs: 0 };
	const finishStart = performance.now();
	gl.finish();
	const finishMs = performance.now() - finishStart;
	const readStart = performance.now();
	// finish() is not always a hard sync in embedded WebKit. A 1x1 readback
	// forces the default framebuffer to be resolved before we stop the clock.
	gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
	return {
		kind: "webgl2",
		finishMs,
		readMs: performance.now() - readStart,
		contextLost: gl.isContextLost?.() ?? null,
	};
}

function percentile(sorted, p) {
	if (!sorted.length) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
	return sorted[index];
}

function summarizeFrameTimes(times, elapsedMs, frames) {
	const sorted = [...times].sort((a, b) => a - b);
	return {
		frames,
		elapsedMs,
		fps: frames / (elapsedMs / 1000),
		avgFrameMs: elapsedMs / frames,
		p50FrameMs: percentile(sorted, 0.5),
		p95FrameMs: percentile(sorted, 0.95),
		maxFrameMs: sorted.at(-1) ?? 0,
	};
}

async function warmup(renderer, scene, camera) {
	for (let i = 0; i < WARMUP_FRAMES; i++) renderer.render(scene, camera);
	await syncRenderer(renderer);
}

function measureRaf(renderer, scene, camera) {
	return new Promise((resolve) => {
		const times = [];
		let start = 0;
		let last = 0;
		let frames = 0;
		const tick = (now) => {
			if (!start) {
				start = now;
				last = now;
			}
			renderer.render(scene, camera);
			if (frames > 0) times.push(now - last);
			last = now;
			frames++;
			if (now - start >= RAF_MS) {
				resolve(summarizeFrameTimes(times, now - start, frames));
				return;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
}

async function measureThroughput(renderer, scene, camera) {
	const preSync = await syncRenderer(renderer);
	const started = performance.now();
	let frames = 0;
	while (frames < THROUGHPUT_MAX_FRAMES && performance.now() - started < THROUGHPUT_MIN_MS) {
		renderer.render(scene, camera);
		frames++;
	}
	const submitMs = performance.now() - started;
	const postSync = await syncRenderer(renderer);
	const totalMs = performance.now() - started;
	return {
		frames,
		submitMs,
		totalMs,
		fps: frames / (totalMs / 1000),
		sync: { pre: preSync, post: postSync },
	};
}

function readInfo(renderer) {
	const info = renderer.info;
	return {
		calls: info.render.calls,
		drawCalls: info.render.drawCalls,
		triangles: info.render.triangles,
		geometries: info.memory.geometries,
		textures: info.memory.textures,
	};
}

async function readAdapter() {
	if (!navigator.gpu) return null;
	try {
		const adapter = await navigator.gpu.requestAdapter();
		if (!adapter?.info) return null;
		return {
			vendor: adapter.info.vendor,
			architecture: adapter.info.architecture,
			device: adapter.info.device,
			description: adapter.info.description,
		};
	} catch {
		return null;
	}
}

async function run() {
	status.adapter = await readAdapter();
	for (let pass = 0; pass < ORDER.length; pass++) {
		for (const backend of ORDER[pass]) {
			for (const testCase of CASES) {
				status.phase = `pass ${pass + 1}/2 · ${backend} · ${testCase.id}`;
				updateStatus();
				const built = testCase.build();
				const { renderer, canvas } = await createRenderer(backend, testCase.shadows);
				try {
					const actual = renderer.backend?.isWebGPUBackend ? "webgpu" : "webgl2";
					if (actual !== backend) throw new Error(`expected ${backend}, got ${actual}`);
					await warmup(renderer, built.scene, built.camera);
					const raf = await measureRaf(renderer, built.scene, built.camera);
					const throughput = await measureThroughput(renderer, built.scene, built.camera);
					status.results.push({
						pass: pass + 1,
						backend,
						case: testCase.id,
						label: testCase.label,
						raf,
						throughput,
						info: readInfo(renderer),
					});
				} finally {
					disposeRenderer(renderer, canvas);
					built.dispose();
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				updateStatus();
			}
		}
	}
}

run()
	.catch((error) => {
		status.errors.push(String((error && (error.stack || error.message)) || error));
	})
	.finally(() => {
		status.done = true;
		status.phase = status.errors.length ? "failed" : "done";
		updateStatus();
		console.log("BENCHMARK_RESULT", JSON.stringify(status));
	});
