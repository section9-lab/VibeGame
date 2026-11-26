import Electrobun, { Electroview } from "electrobun/view";
import { t, type Locale } from "@/i18n";

export type Status = "starting" | "waiting" | "working" | "dead";
export type ProjectRef = { id: string; name: string; autoName?: boolean; icon?: string; iconSvg?: string };
export type ModelRef = { provider: string; id: string; name: string };
export type AcpOptionValue = { value: string; name: string; description?: string };
export type AcpConfigOption = {
	id: string;
	name: string;
	currentValue: string;
	values: AcpOptionValue[];
};
export type AgentInfo = {
	id: string;
	name: string;
	description: string;
	/** 内置 Agent 或用户在本机启用的 ACP Agent */
	kind: "builtin" | "acp";
	enabled: boolean;
	/** PATH 上能否找到启动命令（内置 Agent 恒为 true） */
	available: boolean;
	/** installed=本机命令；auto=用内置 Bun 自动下载运行；missing=用户手填的命令不存在 */
	launcher: "installed" | "auto" | "missing";
	command: string;
	args: string[];
	defaultCommand?: string;
	installCommand?: string;
	packageName?: string;
};
export type ProviderInfo = {
	id: string;
	name: string;
	auth: "oauth" | "api_key";
	subscription: boolean;
	configured: boolean;
	canLogin: boolean;
};
export type AuthPrompt = {
	type: "text" | "secret" | "manual_code" | "select";
	message: string;
	placeholder?: string;
	options?: { id: string; label: string; description?: string }[];
};
export type AuthEvent = {
	type: string;
	url?: string;
	instructions?: string;
	userCode?: string;
	verificationUri?: string;
	message?: string;
};

export type ProjectFileNode =
	| { type: "folder"; name: string; path: string; children: ProjectFileNode[] }
	| { type: "file"; name: string; path: string; size: number };

export type ProjectFileContent = {
	path: string;
	name: string;
	content: string;
	language: string;
	size: number;
	binary: boolean;
};

export type FileListingResult =
	| { ok: true; dir: string; files: ProjectFileNode[] }
	| { ok: false; error: string };

export type FileReadResult =
	| { ok: true; file: ProjectFileContent }
	| { ok: false; error: string };

export type BuildOutcome = { ok: boolean; log: string; url: string | null; version: number };

export type UiEvent =
	| { t: "status"; value: Status }
	| { t: "user"; text: string }
	| { t: "cell"; n: number; summary: string; code: string; reasoning?: string; message?: string }
	| { t: "out"; s: string; stream: "stdout" | "stderr" }
	| { t: "result"; n: number; error: string | null }
	| { t: "build"; projectId: string; ok: boolean; log: string; url: string | null; version: number; trigger: "write" | "initial" | "manual" }
	| { t: "usage"; input: number; output: number; cost: number | null }
	| { t: "projects"; projects: ProjectRef[]; activeId: string }
	| { t: "history"; items: UiEvent[]; previewUrl: string | null; version: number }
	| { t: "model"; provider: string; model: string }
	| { t: "agent"; value: string }
	| { t: "agents"; agents: AgentInfo[] }
	| { t: "assistant"; text: string }
	| { t: "notice"; text: string; tone: "info" | "error" }
	| { t: "acpOptions"; options: AcpConfigOption[] }
	| { t: "fatal"; message: string }
	| { t: "theme"; value: "dark" | "light" }
	| { t: "locale"; value: Locale }
	| { t: "assistantDelta"; projectId: string; text: string }
	| { t: "reasoningDelta"; projectId: string; text: string }
	| { t: "streamReset" }
	| { t: "authEvent"; providerId: string; event: AuthEvent }
	| { t: "authPrompt"; providerId: string; prompt: AuthPrompt }
	| { t: "authDone"; providerId: string; ok: boolean; error?: string };

export type AppState = {
	status: Status;
	theme: "dark" | "light";
	locale: Locale;
	agent: string;
	agents: AgentInfo[];
	providers: ProviderInfo[];
	mock: boolean;
	provider: string;
	model: string;
	previewUrl: string | null;
	version: number;
	project: ProjectRef;
	projects: ProjectRef[];
	models: ModelRef[];
	replay: UiEvent[];
};

type RPC = {
	bun: {
		requests: {
			getState: { params: Record<string, never>; response: AppState };
			listFiles: { params: Record<string, never>; response: FileListingResult };
			readFile: { params: { path: string }; response: FileReadResult };
			buildNow: { params: Record<string, never>; response: BuildOutcome };
		};
		messages: {
			userMessage: { text: string };
			interrupt: Record<string, never>;
			rollback: { name: string };
			previewEvent: { type: string; message?: string };
			createProject: Record<string, never>;
			switchProject: { id: string };
			deleteProject: { id: string };
			renameProject: { id: string; name: string };
			setModel: { provider: string; model: string };
			setAgent: { agent: string };
			setAcp: { id: string; enabled?: boolean; command?: string; args?: string[] };
			setAcpConfig: { configId: string; value: string };
			setTheme: { theme: "dark" | "light" };
			setLocale: { locale: Locale };
			beginLogin: { providerId: string };
			authAnswer: { providerId: string; value: string };
			cancelLogin: Record<string, never>;
			logout: { providerId: string };
		};
	};
	webview: { requests: Record<string, never>; messages: { engineEvent: UiEvent } };
};

export function createRpc(onEvent: (event: UiEvent) => void) {
	const rpc = Electroview.defineRPC<RPC>({
		handlers: { requests: {}, messages: { engineEvent: onEvent } },
	});
	const electrobun = new Electrobun.Electroview({ rpc });
	return {
		send: (name: keyof RPC["bun"]["messages"], payload?: unknown) => {
			const fn = (electrobun.rpc as any)?.send?.[name];
			return fn?.(payload);
		},
		getState: () => electrobun.rpc?.request?.getState?.({}) as Promise<AppState>,
		listFiles: () =>
			(electrobun.rpc?.request?.listFiles?.({}) ??
				Promise.resolve({ ok: false, error: t("rpcUnavailable") })) as Promise<FileListingResult>,
		readFile: (path: string) =>
			(electrobun.rpc?.request?.readFile?.({ path }) ??
				Promise.resolve({ ok: false, error: t("rpcUnavailable") })) as Promise<FileReadResult>,
		buildNow: () =>
			(electrobun.rpc?.request?.buildNow?.({}) ??
				Promise.resolve({ ok: false, log: t("rpcUnavailable"), url: null, version: 0 })) as Promise<BuildOutcome>,
	};
}

export type Client = ReturnType<typeof createRpc>;
