// 模型网关。跑在主进程里，对引擎暴露一个最小的 Responses API 端点。
// 好处是 key 留在主进程，引擎子进程只看到 http://127.0.0.1:port。
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { fileCredentialStore } from "./credentials";
import { sanitizeIconSvg, sanitizeProjectTitle } from "./icon";
import { toContext, toResponse } from "./convert";

export type ModelRef = { provider: string; id: string; name: string };

const store = fileCredentialStore();
const models = builtinModels({ credentials: store as any });

let cached: ModelRef[] | null = null;

export async function listAvailableModels(): Promise<ModelRef[]> {
	if (cached) return cached;
	try {
		const available = await models.getAvailable();
		cached = available
			.map((model) => ({ provider: model.provider, id: model.id, name: model.name ?? model.id }))
			.sort((a, b) => (a.provider === b.provider ? a.id.localeCompare(b.id) : a.provider.localeCompare(b.provider)));
	} catch {
		cached = [];
	}
	return cached;
}

export type ProviderInfo = {
	id: string;
	name: string;
	auth: "oauth" | "api_key";
	subscription: boolean;
	configured: boolean;
	canLogin: boolean;
};

// 列出 pi-ai 注册的全部供应商，不再手工挑 8 个。
const CURATED: string[] = [];

export async function providerCatalog(): Promise<ProviderInfo[]> {
	const providers = CURATED.length
		? CURATED.map((id) => models.getProvider(id)).filter(Boolean)
		: [...models.getProviders()];
	const result = await Promise.all(
		providers.map(async (provider: any) => {
			const subscription = Boolean(provider.auth.oauth);
			const login = subscription ? provider.auth.oauth?.login : provider.auth.apiKey?.login;
			const check = await models.checkAuth(provider.id).catch(() => undefined);
			return {
				id: provider.id,
				name: provider.name ?? provider.id,
				auth: subscription ? ("oauth" as const) : ("api_key" as const),
				subscription,
				configured: Boolean(check),
				canLogin: Boolean(login),
			};
		}),
	);
	return result.sort((a, b) => {
		if (a.configured !== b.configured) return a.configured ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
}

export async function beginProviderLogin(
	providerId: string,
	interaction: {
		signal?: AbortSignal;
		notify: (event: any) => void;
		prompt: (prompt: any) => Promise<string>;
	},
): Promise<void> {
	const provider = models.getProvider(providerId);
	if (!provider) throw new Error(`unknown provider ${providerId}`);
	const type = provider.auth.oauth ? "oauth" : "api_key";
	await models.login(providerId, type, interaction as any);
	cached = null;
}

export async function logoutProvider(providerId: string): Promise<void> {
	await models.logout(providerId);
	cached = null;
}

/**
 * 用当前模型给项目画一个 64x64 的 SVG 图标。失败返回 null，界面保留占位图标。
 */
export async function generateProjectIcon(prompt: string, provider: string, modelId: string): Promise<string | null> {
	const model = models.getModel(provider, modelId);
	if (!model) return null;
	const systemPrompt = [
		"You design tiny application icons.",
		"Return ONLY an <svg> element, no markdown, no explanation.",
		"Constraints: width=64 height=64, viewBox=0 0 64 64, xmlns set.",
		"Flat vector shapes only. No text, no gradients, no filters, no <image>, no external references, no scripts.",
		"Use 2 to 4 colors that read well on a dark background (#12121a).",
		"The icon must suggest the game described by the user, as a simple symbolic object.",
	].join("\n");
	try {
		const result = await models.completeSimple(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: prompt.slice(0, 600), timestamp: Date.now() }],
			} as any,
			{ sessionId: `icon-${Date.now()}`, reasoning: { effort: "minimal" } } as any,
		);
		if (result.stopReason === "error") return null;
		const text = (result.content ?? [])
			.filter((block: any) => block.type === "text")
			.map((block: any) => block.text)
			.join("\n");
		return sanitizeIconSvg(text);
	} catch (error) {
		console.error("[icon] failed", String((error as Error)?.message ?? error));
		return null;
	}
}

// 项目标题同样由模型起名，和图标分开请求，一处失败不影响另一处。
export async function generateProjectTitle(prompt: string, provider: string, modelId: string): Promise<string | null> {
	const model = models.getModel(provider, modelId);
	if (!model) return null;
	const systemPrompt = [
		"You name tiny game projects.",
		"Return ONLY the title on one line: no quotes, no markdown, no explanation, no trailing punctuation.",
		"Use 4 to 10 Chinese characters (or at most 4 English words).",
		"Be concrete about the game (subject + genre), never use generic words like 游戏 / 项目 / game.",
	].join("\n");
	try {
		const result = await models.completeSimple(
			model,
			{
				systemPrompt,
				messages: [{ role: "user", content: prompt.slice(0, 600), timestamp: Date.now() }],
			} as any,
			{ sessionId: `title-${Date.now()}`, reasoning: { effort: "minimal" } } as any,
		);
		if (result.stopReason === "error") return null;
		const text = (result.content ?? [])
			.filter((block: any) => block.type === "text")
			.map((block: any) => block.text)
			.join("\n");
		return sanitizeProjectTitle(text);
	} catch (error) {
		console.error("[title] failed", String((error as Error)?.message ?? error));
		return null;
	}
}

export function startModelGateway(options: {
	provider: string;
	model: string;
	sessionId: string;
	onTextDelta?: (text: string) => void;
	onThinkingDelta?: (text: string) => void;
}) {
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			if (request.method !== "POST" || url.pathname !== "/responses") {
				return Response.json({ error: { message: "not found" } }, { status: 404 });
			}

			let body: any;
			try {
				body = await request.json();
			} catch {
				return Response.json({ error: { message: "invalid json" } }, { status: 400 });
			}

			const model = models.getModel(options.provider, options.model);
			if (!model) {
				return Response.json(
					{ error: { message: `unknown model ${options.provider}/${options.model}` } },
					{ status: 404 },
				);
			}

			let lastError: unknown = null;
			// 只有 agent 自己的模型调用才推送到界面；cell 里的 call_llm_api 属于工具内部调用，不展示。
			const isAgentCall = typeof body.instructions === "string" && body.instructions.trim().length > 0;
			for (let attempt = 1; attempt <= 2; attempt += 1) {
				let sawText = false;
				let sawThinking = false;
				try {
					const stream = models.streamSimple(model, toContext(body) as any, {
						signal: request.signal,
						sessionId: options.sessionId,
						reasoning: { effort: body?.reasoning?.effort ?? "medium" },
					} as any);
					for await (const event of stream as any) {
						if (isAgentCall && event?.type === "text_delta" && event.delta) {
							sawText = true;
							options.onTextDelta?.(String(event.delta));
						}
						if (isAgentCall && event?.type === "thinking_delta" && event.delta) {
							sawThinking = true;
							options.onThinkingDelta?.(String(event.delta));
						}
					}
					const result = await (stream as any).result();
					if (result.stopReason === "error") {
						console.error("[gateway] provider error", result.errorMessage);
						return Response.json(
							{ error: { message: result.errorMessage ?? "provider error" } },
							{ status: 502 },
						);
					}
					// 有些供应商不逐字流式输出；没有收到增量时用最终结果补齐。
					if (isAgentCall && !sawText) {
						const text = (result.content ?? [])
							.filter((block: any) => block.type === "text")
							.map((block: any) => block.text)
							.join("");
						if (text) options.onTextDelta?.(text);
					}
					if (isAgentCall && !sawThinking) {
						const thinking = (result.content ?? [])
							.filter((block: any) => block.type === "thinking")
							.map((block: any) => block.thinking)
							.join("");
						if (thinking) options.onThinkingDelta?.(thinking);
					}
					return Response.json(toResponse(body, result, options.model));
				} catch (error) {
					lastError = error;
					console.error("[gateway] attempt failed", attempt, String((error as Error)?.stack ?? error).slice(0, 1500));
				}
			}
			const message = String((lastError as Error)?.message ?? lastError);
			return Response.json({ error: { message } }, { status: 502 });
		},
	});

	return {
		url: `http://127.0.0.1:${server.port}`,
		close: () => server.stop(true),
	};
}
