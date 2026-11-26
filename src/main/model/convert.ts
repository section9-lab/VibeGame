// Responses API 的请求和 pi-ai 的 Context 互转。只覆盖 fibona 用到的那一小部分。
import type { Message, Tool } from "@earendil-works/pi-ai";

const now = () => Date.now();

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: any) => (typeof part === "string" ? part : (part?.text ?? "")))
		.join("");
}

export function toContext(body: any): { systemPrompt?: string; messages: Message[]; tools?: Tool[] } {
	const messages: Message[] = [];
	const toolNames = new Map<string, string>();
	const rawInput = typeof body.input === "string" ? [{ role: "user", content: body.input }] : (body.input ?? []);

	for (const item of rawInput) {
		if (typeof item === "string") {
			messages.push({ role: "user", content: item, timestamp: now() });
			continue;
		}
		if (item.type === "function_call") {
			toolNames.set(item.call_id, item.name);
			messages.push({
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: item.call_id,
						name: item.name,
						arguments: safeJson(item.arguments),
					},
				],
				api: "openai-completions",
				provider: "gateway",
				model: body.model ?? "gateway",
				usage: zeroUsage(),
				stopReason: "toolUse",
				timestamp: now(),
			});
			continue;
		}
		if (item.type === "function_call_output") {
			messages.push({
				role: "toolResult",
				toolCallId: item.call_id,
				toolName: toolNames.get(item.call_id) ?? "set_next_cell",
				content: [{ type: "text", text: textOf(item.output) }],
				isError: false,
				timestamp: now(),
			});
			continue;
		}
		if (item.role === "developer") {
			messages.push({ role: "system", content: textOf(item.content), timestamp: now() });
			continue;
		}
		if (item.role === "user") {
			messages.push({ role: "user", content: textOf(item.content), timestamp: now() });
			continue;
		}
		if (item.role === "assistant") {
			// 回放的 assistant 消息也带齐字段，否则 pi-ai 估算上下文时会读 usage。
			messages.push({
				role: "assistant",
				content: [{ type: "text", text: textOf(item.content) }],
				api: "openai-completions",
				provider: "gateway",
				model: body.model ?? "gateway",
				usage: zeroUsage(),
				stopReason: "stop",
				timestamp: now(),
			} as Message);
			continue;
		}
	}

	const tools: Tool[] = (body.tools ?? [])
		.filter((tool: any) => tool?.type === "function" && tool.name)
		.map((tool: any) => ({ name: tool.name, description: tool.description ?? "", parameters: tool.parameters ?? {} }));

	return { systemPrompt: body.instructions, messages, tools: tools.length ? tools : undefined };
}

export function toResponse(body: any, result: any, modelId: string) {
	const textBlocks = (result.content ?? []).filter((block: any) => block.type === "text");
	const toolCalls = (result.content ?? []).filter((block: any) => block.type === "toolCall");
	const text = textBlocks.map((block: any) => block.text).join("");
	const output: any[] = [];

	if (text) {
		output.push({
			type: "message",
			id: `msg_${result.responseId ?? randomId()}`,
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text, annotations: [] }],
		});
	}
	for (const call of toolCalls) {
		output.push({
			type: "function_call",
			id: `fc_${call.id}`,
			call_id: call.id,
			name: call.name,
			arguments: JSON.stringify(call.arguments ?? {}),
			status: "completed",
		});
	}

	const usage = result.usage ?? {};
	return {
		id: result.responseId ?? `resp_${randomId()}`,
		object: "response",
		created_at: Math.floor(now() / 1000),
		status: result.stopReason === "error" ? "failed" : "completed",
		model: result.responseModel ?? modelId,
		output,
		output_text: text,
		usage: {
			input_tokens: usage.input ?? 0,
			output_tokens: usage.output ?? 0,
			total_tokens: usage.totalTokens ?? 0,
			cost: usage.cost?.total ?? 0,
		},
		...(result.stopReason === "error"
			? { error: { code: "provider_error", message: result.errorMessage ?? "provider error" } }
			: {}),
		_request: { model: body.model, items: body.input?.length ?? 0 },
	};
}

function safeJson(value: unknown) {
	if (typeof value !== "string") return value ?? {};
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

function zeroUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function randomId() {
	return Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}
