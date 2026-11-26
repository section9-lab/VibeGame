// engine-version: 5
import * as THREE from "../vendor/three.webgpu.js";

export type Input = { keys: Record<string, boolean> };
export type RendererBackend = "webgpu" | "webgl2";

export type GameContext = {
	THREE: typeof THREE;
	scene: THREE.Scene;
	camera: THREE.PerspectiveCamera;
	// WebGPU 优先；WebGPU 不可用时，同一个 renderer 会自动退回 WebGL2 backend。
	renderer: THREE.WebGPURenderer;
	backend: RendererBackend;
};

export type GameModule = {
	setup?: (ctx: GameContext) => void | Promise<void>;
	update?: (dt: number, input: Input) => void;
};

const canvas = document.getElementById("game") as HTMLCanvasElement;

function report(message: string) {
	window.dispatchEvent(new CustomEvent("vibegame", { detail: { type: "error", message } }));
}

export async function boot(load: () => Promise<GameModule>) {
	const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
	const renderer = new THREE.WebGPURenderer({
		canvas,
		antialias: true,
		powerPreference: "high-performance",
		// 只有浏览器完全没有 WebGPU 时才跳过 WebGPU；有 WebGPU 但初始化失败时，
		// WebGPURenderer 内部会自己回退到 WebGL2。
		forceWebGL: !hasWebGPU,
	});

	try {
		await renderer.init();
	} catch (error) {
		report(String((error as Error)?.stack ?? error));
		return;
	}

	const backend: RendererBackend = renderer.backend?.isWebGPUBackend ? "webgpu" : "webgl2";
	if (backend === "webgl2") {
		console.warn("VibeGame: WebGPU unavailable, running on the WebGL2 fallback backend");
	}

	// 兼容旧版生成代码：它们会调用 WebGLRenderer 的 renderer.capabilities。
	// WebGPURenderer 没有这个对象；给一个安全的上限，避免旧项目在 WebGPU 下直接报错。
	const compatibleRenderer = renderer as unknown as {
		capabilities?: {
			isWebGL2?: boolean;
			getMaxAnisotropy?: () => number;
			getMaxPrecision?: (precision?: string) => string;
		};
	};
	if (!compatibleRenderer.capabilities) {
		compatibleRenderer.capabilities = {
			isWebGL2: false,
			getMaxAnisotropy: () => 8,
			getMaxPrecision: () => "highp",
		};
	}

	renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
	renderer.setSize(innerWidth, innerHeight, false);

	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x0b0b10);

	const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
	camera.position.set(0, 5, 9);
	camera.lookAt(0, 1, 0);

	addEventListener("resize", () => {
		renderer.setSize(innerWidth, innerHeight, false);
		camera.aspect = innerWidth / innerHeight;
		camera.updateProjectionMatrix();
	});

	const keys: Record<string, boolean> = {};
	addEventListener("keydown", (e) => (keys[e.key.toLowerCase()] = true));
	addEventListener("keyup", (e) => (keys[e.key.toLowerCase()] = false));

	let mod: GameModule = {};
	try {
		mod = await load();
		await mod.setup?.({ THREE, scene, camera, renderer, backend });
	} catch (error) {
		report(String((error as Error)?.stack ?? error));
	}

	let last = performance.now();
	let first = true;
	// 模拟和 HUD 最多 30Hz：很多游戏在 update 里每帧写 DOM，
	// 60Hz 会让 WebKit 每帧重排，预览窗格会长期占满一个核。
	let acc = 0;
	const UPDATE_STEP = 1 / 30;
	renderer.setAnimationLoop((now: number) => {
		if (document.hidden) {
			last = now;
			return;
		}
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		try {
			acc += dt;
			if (acc >= UPDATE_STEP) {
				const step = acc;
				acc = 0;
				mod.update?.(step, { keys });
			}
			renderer.render(scene, camera);
		} catch (error) {
			report(String((error as Error)?.stack ?? error));
		}
		if (first) {
			first = false;
			window.dispatchEvent(new CustomEvent("vibegame", { detail: { type: "ready", backend } }));
		}
	});
}
