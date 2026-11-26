// 最小 ACP（Agent Client Protocol v1）客户端：stdio + NDJSON JSON-RPC。
// 只实现 VibeGame 需要的能力：create session、prompt、文件读写、权限自动允许。
// Agent 自己执行工具，我们只把工具调用/文本映射成宿主已有的 cell 事件流。
import { mkdirSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { AcpConfigOption, AcpLaunch, EngineEvent } from "../../src/main/engine/protocol";

type Emit = (event: EngineEvent) => void;

type PendingRequest = {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout> | null;
};

type CellState = { n: number; emitted: Set<string>; status: string; inputSeen: boolean };

const INIT_TIMEOUT = 120_000;
const MAX_LINE = 8_000_000;
const MAX_CONTENT = 20_000;


function clip(text: string, limit = MAX_CONTENT): string {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.slice(0, half)}\n… [省略 ${text.length - limit} 字符] …\n${text.slice(-half)}`;
}

function textOfContent(content: any): string {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (content.type === "text" && typeof content.text === "string") return content.text;
	return "";
}

/** 把模型给的原始工具参数压成终端里能读的一段文字。 */
function describeInput(raw: unknown): string {
	if (raw == null) return "";
	if (typeof raw === "string") return clip(raw, 4000);
	if (typeof raw !== "object") return String(raw);
	const value = raw as Record<string, unknown>;
	if (typeof value.command === "string") return value.command;
	if (typeof value.file_path === "string" && typeof value.content === "string") {
		return `${value.file_path}\n\n${clip(value.content, 4000)}`;
	}
	try {
		return clip(JSON.stringify(raw, null, 2), 4000);
	} catch {
		return "";
	}
}

export class AcpSession {
	private proc: any = null;
	private emit: Emit;
	private cwd: string;
	private label: string;
	private loginHint = "";
	private nextId = 1;
	private pending = new Map<number, PendingRequest>();
	private cells = new Map<string, CellState>();
	private nextCell = 1;
	private sessionId: string | null = null;
	private closed = false;
	/** 当前这一轮是否被用户取消（runner 用它决定要不要报错）。 */
	cancelling = false;
	private turnText = "";
	private authMethods: any[] = [];
	private watcher: FSWatcher | null = null;
	private watchTimer: ReturnType<typeof setTimeout> | null = null;
	private lastGame = "";
	/** session/new 里当前账号真正可用的模型（去掉 [effort] 后缀）。 */
	private availableModelBases = new Set<string>();

	constructor(options: { cwd: string; emit: Emit }) {
		this.cwd = options.cwd;
		this.emit = options.emit;
		this.label = "ACP Agent";
	}

	get ready() {
		return this.sessionId !== null;
	}

	/** 启动进程、initialize、session/new。失败时抛错，由调用方转成 dead 事件。 */
	async start(launch: AcpLaunch) {
		this.label = launch.name || launch.command;
		this.loginHint = launch.loginHint ?? "";
		this.startWatcher();

		try {
			this.proc = Bun.spawn({
				cmd: [launch.command, ...launch.args],
				cwd: this.cwd,
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
				env: { ...process.env, ...(launch.env ?? {}), TERM: "dumb", NO_COLOR: "1", FORCE_COLOR: "0" },
			});
		} catch (error) {
			throw new Error(
				`无法启动 ${this.label}：${String((error as Error)?.message ?? error)}。请在设置 → Agent → 本机 ACP Agent 里安装适配器或填写正确的启动命令。`,
			);
		}

		void this.pump(this.proc.stdout, false);
		void this.pump(this.proc.stderr, true);
		void this.proc.exited.then((code: number) => {
			if (this.closed) return;
			this.closed = true;
			this.rejectAll(new Error(`${this.label} 已退出`));
			this.emit({ t: "dead", error: `${this.label} 已退出（code ${code}）` });
		});

		const init = await this.request(
			"initialize",
			{
				protocolVersion: 1,
				clientCapabilities: {
					fs: { readTextFile: true, writeTextFile: true },
					terminal: false,
				},
				clientInfo: { name: "vibegame", title: "VibeGame", version: "0.1.0" },
			},
			INIT_TIMEOUT,
		);
		this.authMethods = Array.isArray(init?.authMethods) ? init.authMethods : [];

		try {
			await this.bootstrap(launch);
		} catch (error) {
			// 本机 CLI 还没登录时，Adapter 会要求 authenticate。只试一次，失败就把提示抛给界面。
			if (!isAuthError(error)) throw error;
			if (!(await this.authenticate())) throw new Error(this.friendly(error));
			await this.bootstrap(launch);
		}
	}

	private async bootstrap(launch: AcpLaunch) {
		const created = await this.newSession();
		this.sessionId = created.sessionId;
		this.rememberModels(created);
		let state = (await this.ensureUsableModel(created)) ?? created;
		this.publishOptions(state);

		// 恢复用户上次选的模型；只有适配器确实提供这个值时才设置。
		const saved = launch.model?.trim();
		if (saved && saved !== this.optionCurrent(state, "model") && this.hasOptionValue(state, "model", saved)) {
			state = (await this.applyConfig("model", saved)) ?? state;
			this.publishOptions(state);
		}
	}

	/** 读出账号真正可用的模型；Claude 这类没有 models 字段的适配器不设置。 */
	private rememberModels(created: any) {
		const list = created?.models?.availableModels;
		if (!Array.isArray(list)) return;
		this.availableModelBases = new Set(
			list.map((entry: any) => this.baseModel(entry?.modelId)).filter((id: string) => Boolean(id)),
		);
	}

	private baseModel(id: unknown): string {
		return String(id ?? "").split("[")[0]!.trim();
	}

	private optionCurrent(state: any, id: string): string {
		const option = (state?.configOptions ?? []).find((entry: any) => entry?.id === id);
		return String(option?.currentValue ?? "");
	}

	private hasOptionValue(state: any, id: string, value: string): boolean {
		const option = (state?.configOptions ?? []).find((entry: any) => entry?.id === id);
		return (Array.isArray(option?.options) ? option.options : []).some((entry: any) => entry?.value === value);
	}

	/** 把 ACP 的 select 配置（模型等）转成界面能用的列表。 */
	private publishOptions(state: any) {
		const list: any[] = Array.isArray(state?.configOptions) ? state.configOptions : [];
		const options: AcpConfigOption[] = [];
		for (const raw of list) {
			if (!raw || raw.type !== "select" || typeof raw.id !== "string") continue;
			const values = (Array.isArray(raw.options) ? raw.options : [])
				.filter((entry: any) => entry && typeof entry.value === "string")
				.filter(
					(entry: any) =>
						raw.id !== "model" ||
						!this.availableModelBases.size ||
						this.availableModelBases.has(this.baseModel(entry.value)),
				)
				.map((entry: any) => ({
					value: entry.value,
					name: typeof entry.name === "string" ? entry.name : entry.value,
					...(typeof entry.description === "string" ? { description: entry.description } : {}),
				}));
			if (!values.length) continue;
			options.push({
				id: raw.id,
				name: String(raw.name ?? raw.id),
				currentValue: String(raw.currentValue ?? ""),
				values,
			});
		}
		this.emit({ t: "acpOptions", options });
	}

	private async applyConfig(configId: string, value: string): Promise<any> {
		return this.request("session/set_config_option", { sessionId: this.sessionId, configId, value }, 30_000);
	}

	/** 供宿主切换模型等配置；成功后把新的完整配置推回界面。 */
	async setConfigOption(configId: string, value: string) {
		const result = await this.applyConfig(configId, value);
		this.publishOptions(result);
	}

	/**
	 * Codex 的默认模型来自 ~/.codex/config.toml，可能是当前账号不支持的型号
	 * （例如 ChatGPT 账号配了 gpt-6.1-sol）。session/new 会给出可用模型列表，
	 * 这里只在「当前型号不在列表里」时切到第一个可用型号，不覆盖正常配置。
	 */
	private async ensureUsableModel(created: any): Promise<any | null> {
		if (!this.availableModelBases.size || !this.sessionId) return null;
		const current = this.baseModel(created?.models?.currentModelId);
		if (!current || this.availableModelBases.has(current)) return null;

		const modelOption = (created?.configOptions ?? []).find((option: any) => option?.id === "model");
		const choices = (Array.isArray(modelOption?.options) ? modelOption.options : [])
			.filter((option: any) => typeof option?.value === "string");
		const pick =
			choices.find((option: any) => this.availableModelBases.has(this.baseModel(option.value))) ?? choices[0];
		if (!pick) return null;

		this.emit({
			t: "out",
			s: `\n[acp] 模型 ${current} 在当前账号不可用，切换到 ${pick.name ?? pick.value}\n`,
			stream: "stderr",
		});
		return this.applyConfig("model", pick.value);
	}

	/** 优先选浏览器/ChatGPT 登录方式；这是 Agent 自己的订阅授权，不经过 VibeGame 存凭据。 */
	private friendly(error: unknown): string {
		const message = String((error as Error)?.message ?? error);
		if (!isAuthError(error)) return message;
		const hint = this.loginHint || "请先在终端用官方 CLI 登录一次，再回到这里重试。";
		return `${this.label} 需要登录：${hint}`;
	}

	private async authenticate(): Promise<boolean> {
		if (!this.authMethods.length) return false;
		const pick =
			this.authMethods.find((method) => /chatgpt|login|oauth/i.test(String(method?.id ?? method?.name ?? ""))) ??
			this.authMethods[0];
		const methodId = pick?.id ?? pick?.methodId ?? pick?.name;
		if (!methodId) return false;
		this.emit({ t: "out", s: `\n[acp] 需要登录，正在调用 ${pick.name ?? methodId}…\n`, stream: "stderr" });
		// 浏览器授权可能停留很久，单独放宽超时。
		await this.request("authenticate", { methodId }, 180_000);
		return true;
	}

	async prompt(text: string) {
		if (!this.sessionId) throw new Error(`${this.label} 会话未就绪`);
		this.cancelling = false;
		this.turnText = "";
		const params = { sessionId: this.sessionId, prompt: [{ type: "text", text }] };
		let result: any;
		try {
			result = await this.request("session/prompt", params, 0);
		} catch (error) {
			// 有些 Adapter 到发第一条消息才报未登录，这时补一次授权再重发。
			if (!isAuthError(error) || this.cancelling) throw error;
			if (!(await this.authenticate())) throw new Error(this.friendly(error));
			result = await this.request("session/prompt", params, 0);
		}
		const stop = result?.stopReason;
		if (stop && stop !== "end_turn" && stop !== "cancelled") {
			this.emit({ t: "out", s: `\n[acp] 本轮结束：${stop}\n`, stream: "stderr" });
		}
		// 用户主动停止的回合不落成正式回复，避免把半截内容写进历史。
		const finalText = stop === "cancelled" ? "" : this.turnText.trim();
		if (finalText) this.emit({ t: "assistant", text: finalText });
		this.turnText = "";
	}

	cancel() {
		if (!this.sessionId || this.closed) return;
		this.cancelling = true;
		this.notify("session/cancel", { sessionId: this.sessionId });
		// 取消时所有挂起的权限请求都必须回 cancelled，否则 Agent 会卡住。
		for (const id of [...this.requests]) {
			this.respond(id, { outcome: { outcome: "cancelled" } });
		}
	}

	close() {
		if (this.closed) return;
		this.closed = true;
		this.watcher?.close();
		this.watcher = null;
		if (this.watchTimer) clearTimeout(this.watchTimer);
		this.watchTimer = null;
		this.rejectAll(new Error("ACP 会话已关闭"));
		try {
			this.proc?.kill();
		} catch {}
		this.proc = null;
	}

	// 权限请求的 id 单独记一份，取消时统一回复。
	private requests = new Set<number>();

	private async newSession(): Promise<any> {
		const result = await this.request("session/new", { cwd: this.cwd, mcpServers: [] }, INIT_TIMEOUT);
		if (typeof result?.sessionId !== "string" || !result.sessionId) {
			throw new Error(`${this.label} 没有返回 sessionId`);
		}
		return result;
	}

	// ---------- JSON-RPC ----------

	private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
		if (this.closed) return Promise.reject(new Error(`${this.label} 已退出`));
		const id = this.nextId++;
		return new Promise((resolvePromise, rejectPromise) => {
			const timer =
				timeoutMs > 0
					? setTimeout(() => {
							this.pending.delete(id);
							rejectPromise(new Error(`${this.label} 的 ${method} 超时`));
						}, timeoutMs)
					: null;
			this.pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	private notify(method: string, params: unknown) {
		this.write({ jsonrpc: "2.0", method, params });
	}

	private respond(id: number, result: unknown) {
		this.requests.delete(id);
		this.write({ jsonrpc: "2.0", id, result });
	}

	private respondError(id: number, message: string, code = -32601) {
		this.requests.delete(id);
		this.write({ jsonrpc: "2.0", id, error: { code, message } });
	}

	private write(payload: Record<string, unknown>) {
		if (!this.proc?.stdin) return;
		try {
			this.proc.stdin.write(JSON.stringify(payload) + "\n");
			void this.proc.stdin.flush();
		} catch (error) {
			this.emit({ t: "out", s: `[acp] 写入失败：${String((error as Error)?.message ?? error)}\n`, stream: "stderr" });
		}
	}

	private async pump(stream: ReadableStream<Uint8Array>, isError: boolean) {
		const decoder = new TextDecoder();
		// stdout 和 stderr 必须各用一份缓冲，否则并发输出会拼坏 JSON 行。
		let buffer = "";
		for await (const chunk of stream as any) {
			buffer += decoder.decode(chunk, { stream: true });
			if (buffer.length > MAX_LINE) {
				this.emit({ t: "out", s: "[acp] 单行消息过长，已丢弃\n", stream: "stderr" });
				buffer = "";
				continue;
			}
			for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
				const line = buffer.slice(0, index).trim();
				buffer = buffer.slice(index + 1);
				if (!line) continue;
				if (isError) {
					this.emit({ t: "out", s: `${line}\n`, stream: "stderr" });
					continue;
				}
				this.onLine(line);
			}
		}
		if (buffer.trim()) {
			if (isError) this.emit({ t: "out", s: `${buffer}\n`, stream: "stderr" });
			else this.onLine(buffer.trim());
		}
	}

	private onLine(line: string) {
		let message: any;
		try {
			message = JSON.parse(line);
		} catch {
			// 适配器偶尔会把日志打到 stdout；不要因此断掉协议。
			this.emit({ t: "out", s: `[acp] ${line.slice(0, 500)}\n`, stream: "stderr" });
			return;
		}
		if (message.jsonrpc !== "2.0") return;

		if (typeof message.method === "string") {
			if (message.id !== undefined && message.id !== null) void this.onAgentRequest(message);
			else this.onNotification(message);
			return;
		}

		// 响应
		const pending = this.pending.get(message.id);
		if (!pending) return;
		this.pending.delete(message.id);
		if (pending.timer) clearTimeout(pending.timer);
		if (message.error) {
			const error: any = new Error(String(message.error.message ?? "ACP 请求失败"));
			error.code = message.error.code;
			error.data = message.error.data;
			pending.reject(error);
		} else {
			pending.resolve(message.result);
		}
	}

	private async onAgentRequest(message: any) {
		const id = message.id;
		const params = message.params ?? {};
		try {
			if (message.method === "session/request_permission") {
				this.requests.add(id);
				const options: any[] = Array.isArray(params.options) ? params.options : [];
				const allow =
					options.find((option) => option.kind === "allow_once") ??
					options.find((option) => option.kind === "allow_always");
				if (this.cancelling || !allow) this.respond(id, { outcome: { outcome: "cancelled" } });
				else this.respond(id, { outcome: { outcome: "selected", optionId: allow.optionId } });
				return;
			}
			if (message.method === "fs/read_text_file") {
				const path = this.ensureInside(String(params.path ?? ""));
				let content = readFileSync(path, "utf8");
				if (typeof params.line === "number" && params.line > 0) {
					const lines = content.split("\n");
					const start = params.line - 1;
					const end = typeof params.limit === "number" && params.limit > 0 ? start + params.limit : undefined;
					content = lines.slice(start, end).join("\n");
				}
				this.respond(id, { content });
				return;
			}
			if (message.method === "fs/write_text_file") {
				const path = this.ensureInside(String(params.path ?? ""));
				mkdirSync(dirname(path), { recursive: true });
				writeFileSync(path, String(params.content ?? ""));
				this.respond(id, null);
				return;
			}
			this.respondError(id, `不支持的客户端方法：${message.method}`);
		} catch (error) {
			this.respondError(id, String((error as Error)?.message ?? error), -32603);
		}
	}

	private onNotification(message: any) {
		if (message.method === "session/update") {
			const update = message.params?.update;
			if (update) this.onUpdate(update);
		}
	}

	// ---------- 事件映射 ----------

	private onUpdate(update: any) {
		const kind = update.sessionUpdate;
		if (kind === "agent_message_chunk") {
			const text = textOfContent(update.content);
			if (!text) return;
			this.turnText += text;
			this.emit({ t: "text", s: text });
			return;
		}
		if (kind === "agent_thought_chunk") {
			const text = textOfContent(update.content);
			if (text) this.emit({ t: "thinking", s: text });
			return;
		}
		if (kind === "tool_call" || kind === "tool_call_update") {
			const cell = this.ensureCell(update);
			// 有些 Agent 先报 pending，稍后才补 rawInput；第一次看到时补一行命令。
			if (!cell.inputSeen && update.rawInput !== undefined) {
				const code = describeInput(update.rawInput);
				if (code) {
					cell.inputSeen = true;
					this.emit({ t: "out", s: `\n${code}\n`, stream: "stdout" });
				}
			}
			this.emitContent(update);
			this.setStatus(update);
			return;
		}
		if (kind === "config_option_update") {
			this.publishOptions({ configOptions: update.configOptions });
			return;
		}
		if (kind === "notice") {
			const title = String(update.title ?? "").trim();
			const detail = String(update.description ?? "").trim();
			if (title) this.emit({ t: "out", s: `\n[${title}]${detail ? ` ${detail}` : ""}\n`, stream: "stderr" });
			return;
		}
		// plan / usage_update / current_mode_update 等暂不展示。
	}

	private ensureCell(update: any): CellState {
		const id = String(update.toolCallId ?? "");
		const existing = this.cells.get(id);
		if (existing) return existing;
		const n = this.nextCell++;
		const code = describeInput(update.rawInput);
		const cell: CellState = { n, emitted: new Set(), status: "", inputSeen: code.length > 0 };
		this.cells.set(id, cell);
		// 工具调用之前的说明文字已经在宿主那边绑定到这一格，这里清空避免末尾重复。
		this.turnText = "";
		const summary = String(update.title ?? update.kind ?? "工具调用").trim() || "工具调用";
		this.emit({ t: "cell", n, summary, code });
		return cell;
	}

	private emitContent(update: any) {
		if (!Array.isArray(update.content)) return;
		const cell = this.cells.get(String(update.toolCallId ?? ""));
		if (!cell) return;
		for (const block of update.content) {
			let key: string;
			try {
				key = JSON.stringify(block);
			} catch {
				continue;
			}
			if (cell.emitted.has(key)) continue;
			cell.emitted.add(key);
			if (block?.type === "content") {
				const text = textOfContent(block.content);
				if (text) this.emit({ t: "out", s: text.endsWith("\n") ? text : `${text}\n`, stream: "stdout" });
			} else if (block?.type === "diff") {
				const path = String(block.path ?? "");
				const rel = relative(this.cwd, path);
				const shown = rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
				let text = `\n[编辑] ${shown}\n`;
				// 只展开游戏文件的完整新内容；其它文件可能很大。
				const isGame = rel === join("src", "game.ts") || path.endsWith("/src/game.ts");
				if (isGame && typeof block.newText === "string") {
					text += `${clip(block.newText)}\n`;
				}
				this.emit({ t: "out", s: text, stream: "stdout" });
			}
		}
	}

	private setStatus(update: any) {
		const status = String(update.status ?? "");
		if (!status) return;
		const cell = this.cells.get(String(update.toolCallId ?? ""));
		if (!cell || cell.status === status) return;
		cell.status = status;
		if (status === "completed") this.emit({ t: "result", n: cell.n, error: null, quit: false });
		else if (status === "failed") {
			const reason =
				typeof update.rawOutput === "string"
					? update.rawOutput
					: textOfContent(update.rawOutput) || "工具执行失败";
			this.emit({ t: "result", n: cell.n, error: clip(reason, 2000), quit: false });
		}
	}

	// ---------- 文件与项目规则 ----------

	private ensureInside(path: string): string {
		if (!path) throw new Error("缺少文件路径");
		const absolute = isAbsolute(path) ? resolve(path) : resolve(this.cwd, path);
		const root = this.cwd.endsWith(sep) ? this.cwd : this.cwd + sep;
		if (absolute !== this.cwd && !absolute.startsWith(root)) {
			throw new Error(`拒绝访问项目目录之外的文件：${path}`);
		}
		return absolute;
	}


	private startWatcher() {
		this.lastGame = this.readGame();
		try {
			this.watcher = watch(join(this.cwd, "src"), { recursive: false }, (_event, filename) => {
				if (filename && String(filename) !== "game.ts") return;
				if (this.watchTimer) clearTimeout(this.watchTimer);
				this.watchTimer = setTimeout(() => {
					this.watchTimer = null;
					const next = this.readGame();
					if (next === this.lastGame) return;
					this.lastGame = next;
					this.emit({ t: "wrote" });
				}, 250);
			});
		} catch {
			// src 目录不存在时忽略；构建流程本来也要求它存在。
		}
	}

	private readGame(): string {
		try {
			return readFileSync(join(this.cwd, "src", "game.ts"), "utf8");
		} catch {
			return "";
		}
	}

	private rejectAll(error: Error) {
		for (const [, pending] of this.pending) {
			if (pending.timer) clearTimeout(pending.timer);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

function isAuthError(error: unknown) {
	const value = error as any;
	if (value?.code === -32000 || value?.code === -32001) return true;
	return /auth|login|sign in|unauthor/i.test(String(value?.message ?? ""));
}
