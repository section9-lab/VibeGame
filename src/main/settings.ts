// 配置来源：环境变量 > 应用的 settings.json > pi 的默认 provider/model。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { piAgentDir } from "./model/credentials";
import { detectLocale, normalizeLocale, type Locale, type MessageKey } from "../mainview/src/i18n";

export type AgentId = "fibona" | "mini-swe-agent" | AcpAgentId;

export type AgentInfo = { id: AgentId; name: string; descriptionKey: MessageKey };

// 内置 Agent 清单。界面从这里渲染，避免两边各写一份名称。
export const AGENTS: AgentInfo[] = [
	{
		id: "fibona",
		name: "Fibona Agent",
		descriptionKey: "agentFibonaDescription",
	},
	{
		id: "mini-swe-agent",
		name: "Mini SWE-agent",
		descriptionKey: "agentMiniDescription",
	},
];

// ---------- 本机 ACP Agent ----------
// 这些 Agent 用用户本机 CLI 的登录态（Claude 订阅 / ChatGPT 订阅），不经过应用内登录。
// 命令默认指向官方 ACP 适配器；用户可以在设置页改成任意安装路径。

export type AcpPresetId = "claude-code" | "codex";
export type AcpAgentId = "acp-claude-code" | "acp-codex";

export type AcpPreset = {
	/** 设置页里的稳定 id，也是 settings.json 的键 */
	id: AcpPresetId;
	/** 传给引擎的 Agent id（acp- 前缀，避免和内置 id 冲突） */
	agentId: AcpAgentId;
	name: string;
	descriptionKey: MessageKey;
	/** 官方适配器 npm 包名 */
	packageName: string;
	/** PATH 上应存在的可执行文件名 */
	defaultCommand: string;
	/** 旧版包的二进制名，装上老版本也能识别 */
	aliases?: string[];
	/** 安装提示，界面原样展示 */
	installCommand: string;
	/** 未登录时的提示（引擎报错会带上） */
	loginHint: string;
};

export const ACP_PRESETS: AcpPreset[] = [
	{
		id: "claude-code",
		agentId: "acp-claude-code",
		name: "Claude Code",
		descriptionKey: "agentAcpClaudeDescription",
		packageName: "@agentclientprotocol/claude-agent-acp",
		defaultCommand: "claude-agent-acp",
		aliases: ["claude-code-acp"],
		installCommand: "npm install -g @agentclientprotocol/claude-agent-acp",
		loginHint: "请先在终端运行 claude 并登录 Claude 订阅，或设置 ANTHROPIC_API_KEY。",
	},
	{
		id: "codex",
		agentId: "acp-codex",
		name: "Codex",
		descriptionKey: "agentAcpCodexDescription",
		packageName: "@agentclientprotocol/codex-acp",
		defaultCommand: "codex-acp",
		installCommand: "npm install -g @agentclientprotocol/codex-acp",
		loginHint: "请先在终端运行 codex login，或登录 ChatGPT 桌面端。",
	},
];

export type AcpConfig = { enabled: boolean; command: string; args: string[]; model: string };
export type AcpSettings = Record<AcpPresetId, AcpConfig>;

function defaultAcpSettings(): AcpSettings {
	return {
		"claude-code": { enabled: false, command: "", args: [], model: "" },
		codex: { enabled: false, command: "", args: [], model: "" },
	};
}

export function acpPresetByAgentId(agentId: string): AcpPreset | undefined {
	return ACP_PRESETS.find((preset) => preset.agentId === agentId);
}

/** 生效命令：用户填写优先，否则用官方适配器默认命令。 */
export function resolvedAcpCommand(preset: AcpPreset, config: AcpConfig | undefined) {
	const command = config?.command?.trim() || preset.defaultCommand;
	const args = config?.args?.length ? config.args : [];
	return { command, args };
}

export function normalizeAgent(value: unknown): AgentId {
	const id = String(value ?? "").trim().toLowerCase();
	if (["mini-swe-agent", "mini", "swe-agent", "sweagent", "minisweagent"].includes(id)) return "mini-swe-agent";
	const acp = ACP_PRESETS.find((preset) => preset.agentId === id);
	if (acp) return acp.agentId;
	return "fibona";
}

export type Settings = {
	mock: boolean;
	demo: boolean;
	theme: "dark" | "light";
	locale: Locale;
	agent: string;
	provider: string;
	model: string;
	acp: AcpSettings;
	appDir: string;
	projectsRoot: string;
	runnerPath: string;
	templateDir: string;
};

function readJson(path: string): any {
	if (!existsSync(path)) return {};
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return {};
	}
}

// 老版本 settings.json 没有 acp 字段；逐项补默认值，避免半截配置让界面崩。
function readAcpSettings(file: any): AcpSettings {
	const result = defaultAcpSettings();
	for (const preset of ACP_PRESETS) {
		const raw = file?.acp?.[preset.id];
		if (!raw || typeof raw !== "object") continue;
		result[preset.id] = {
			enabled: raw.enabled === true,
			command: typeof raw.command === "string" ? raw.command.slice(0, 400) : "",
			args: Array.isArray(raw.args) ? raw.args.filter((arg: unknown) => typeof arg === "string").slice(0, 20) : [],
			model: typeof raw.model === "string" ? raw.model.slice(0, 200) : "",
		};
	}
	return result;
}

export function loadSettings(appDir: string, resourcesDir: string): Settings {
	const env = process.env;
	const appFile = readJson(join(appDir, "settings.json"));
	const piFile = readJson(join(piAgentDir(), "settings.json"));

	const provider = env.VIBEGAME_PROVIDER ?? appFile.provider ?? piFile.defaultProvider ?? "openai-codex";
	const model = env.VIBEGAME_MODEL ?? appFile.model ?? piFile.defaultModel ?? "gpt-5.6-luna";
	const mock = env.VIBEGAME_MOCK === "1" ? true : env.VIBEGAME_MOCK === "0" ? false : !existsSync(join(piAgentDir(), "auth.json"));
	const acp = readAcpSettings(appFile);
	let agent = normalizeAgent(env.VIBEGAME_AGENT ?? appFile.agent);
	// 指向一个被关掉的 ACP Agent 时回落到内置 Agent，否则重启后引擎会找不到命令。
	const acpAgent = acpPresetByAgentId(agent);
	if (acpAgent && !acp[acpAgent.id].enabled) agent = "fibona";

	return {
		mock,
		demo: env.VIBEGAME_DEMO === "1" || appFile.demo === true,
		theme: appFile.theme === "light" ? "light" : "dark",
		locale: normalizeLocale(env.VIBEGAME_LOCALE) ?? normalizeLocale(appFile.locale) ?? detectLocale(),
		agent,
		provider,
		model,
		acp,
		appDir,
		projectsRoot: join(appDir, "projects"),
		runnerPath: join(resourcesDir, "engine", "runner.ts"),
		templateDir: join(resourcesDir, "template"),
	};
}
