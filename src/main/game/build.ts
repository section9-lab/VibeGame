// 预览构建与静态服务。一个服务，按 /p/<projectId>/ 路由到各自项目。
import { extname, join, normalize } from "node:path";
import { t } from "../../mainview/src/i18n";

const TYPES: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".json": "application/json",
};

export type BuildResult = { ok: boolean; log: string; ms: number };

export async function buildPreview(dir: string): Promise<BuildResult> {
	const started = performance.now();
	const outdir = join(dir, ".preview");
	try {
		const result = await Bun.build({
			entrypoints: [join(dir, "src", "main.ts")],
			outdir,
			target: "browser",
			naming: "app.js",
			sourcemap: "inline",
		});
		if (!result.success) {
			const log = result.logs.map((entry) => String(entry)).join("\n") || t("buildFailed");
			return { ok: false, log, ms: performance.now() - started };
		}
		await Bun.write(join(outdir, "index.html"), await Bun.file(join(dir, "index.html")).text());
		return { ok: true, log: "", ms: performance.now() - started };
	} catch (error) {
		return { ok: false, log: String((error as Error)?.stack ?? error), ms: performance.now() - started };
	}
}

let server: ReturnType<typeof Bun.serve> | null = null;

export function ensurePreviewServer(root: string): string {
	if (server) return `http://127.0.0.1:${server.port}`;
	server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: async (request) => {
			const url = new URL(request.url);
			// /p/<id>/... -> <root>/<id>/.preview/...
			const match = url.pathname.match(/^\/p\/([a-z0-9]+)(\/.*)?$/i);
			if (!match) return new Response("not found", { status: 404 });
			const rel = match[2] && match[2] !== "/" ? match[2] : "/index.html";
			const rootDir = normalize(join(root, match[1]!, ".preview"));
			const file = normalize(join(rootDir, rel));
			if (!file.startsWith(rootDir)) return new Response("forbidden", { status: 403 });
			const handle = Bun.file(file);
			if (!(await handle.exists())) return new Response("not found", { status: 404 });
			return new Response(handle, {
				headers: {
					"content-type": TYPES[extname(file)] ?? "application/octet-stream",
					"cache-control": "no-store",
					"content-security-policy":
						"default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; img-src 'self' data: blob:",
				},
			});
		},
	});
	return `http://127.0.0.1:${server.port}`;
}
