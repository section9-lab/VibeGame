import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ApplicationMenu, BrowserView, BrowserWindow, Utils } from "electrobun/main";
import { EngineSupervisor } from "./engine/supervisor";
import { buildPreview, ensurePreviewServer } from "./game/build";
import { restoreSnapshot, takeSnapshot } from "./game/snapshots";
import {
	beginProviderLogin,
	generateProjectIcon,
	generateProjectTitle,
	listAvailableModels,
	logoutProvider,
	providerCatalog,
	startModelGateway,
} from "./model/gateway";
import {
	appendEvent,
	createProject,
	deleteProject,
	ensureProject,
	loadIndex,
	projectDir,
	readEvents,
	saveIndex,
	syncProjectTemplate,
	type Project,
	type ProjectIndex,
} from "./projects/store";
import {
	loadSettings,
	AGENTS,
	ACP_PRESETS,
	acpPresetByAgentId,
	resolvedAcpCommand,
	normalizeAgent,
	type Settings,
} from "./settings";
import { commandPath, withAgentPath } from "./acp";
import { listProjectFiles, readProjectFile } from "./projects/files";
import { normalizeLocale, setCurrentLocale, t, type Locale } from "../mainview/src/i18n";

const log = (...parts: unknown[]) => console.log("[vibegame]", ...parts);

// Finder 启动的应用 PATH 很短，先补齐，ACP 命令探测和子进程都靠它。
process.env.PATH = withAgentPath();

function appDataDir(): string {
	const home = homedir();
	if (process.platform === "darwin") return join(home, "Library", "Application Support", "VibeGame");
	if (process.platform === "win32") return join(process.env.APPDATA ?? home, "VibeGame");
	return join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "VibeGame");
}

function resourcesDir(): string {
	const candidates = [
		resolve(import.meta.dir, "app"),
		resolve(process.cwd(), "..", "Resources", "app"),
		resolve(process.cwd(), "resources"),
	];
	return candidates.find((dir) => existsSync(join(dir, "template", "index.html"))) ?? candidates[0]!;
}

const appDir = appDataDir();
const metaJobs = new Set<string>();
const settings: Settings = loadSettings(appDir, resourcesDir());
setCurrentLocale(settings.locale);
const ensured = ensureProject(appDir, settings.templateDir, loadIndex(appDir));
let index: ProjectIndex = ensured.index;
let active: Project = ensured.project;
const previewBase = ensurePreviewServer(settings.projectsRoot);

let gateway: ReturnType<typeof startModelGateway> | null = null;
let gatewayUrl: string | null = null;

type StreamName = "assistantDelta" | "reasoningDelta";

// 三种增量流共用一套节流：代码、助手文字、思考过程。
function createStream(name: StreamName, label: string) {
	let buffer = "";
	let timer: ReturnType<typeof setTimeout> | null = null;
	let total = 0;
	let started = false;

	const flush = () => {
		timer = null;
		if (!buffer) return;
		const text = buffer;
		buffer = "";
		total += text.length;
		if (!started) {
			started = true;
			log("delta stream started", label);
		}
		emitUi({ t: name, projectId: active.id, text });
	};

	return {
		push(text: string) {
			if (!text) return;
			buffer += text;
			if (!timer) timer = setTimeout(flush, 40);
		},
		// 取走当前缓冲（不触发 UI）：cell 事件会把完整内容一起带出去。
		take() {
			if (timer) clearTimeout(timer);
			timer = null;
			const text = buffer;
			buffer = "";
			if (started) log("delta stream total chars", label, total);
			started = false;
			total = 0;
			return text;
		},
		reset() {
			if (timer) clearTimeout(timer);
			timer = null;
			buffer = "";
			started = false;
			total = 0;
		},
	};
}

const textStream = createStream("assistantDelta", "text");
const reasoningStream = createStream("reasoningDelta", "reasoning");

function resetStreams() {
	textStream.reset();
	reasoningStream.reset();
	emitUi({ t: "streamReset" });
}

function restartGateway() {
	gateway?.close();
	gateway = null;
	gatewayUrl = null;
	if (settings.mock) return;
	try {
		gateway = startModelGateway({
			provider: settings.provider,
			model: settings.model,
			sessionId: active.id,
			onTextDelta: (text) => textStream.push(text),
			onThinkingDelta: (text) => reasoningStream.push(text),
		});
		gatewayUrl = gateway.url;
		log("gateway", gatewayUrl, `${settings.provider}/${settings.model}`);
	} catch (error) {
		log("gateway failed", String(error));
	}
}

migrateIcons();
// 后台按项目顺序补图标和标题，不阻塞界面。
void (async () => {
	for (const project of index.projects) await ensureProjectMeta(project.id);
})();
log("app dir", appDir, "| mock", settings.mock, "| demo", settings.demo, "| active", active.id, active.name);
restartGateway();

// ---------- 状态 ----------

type Status = "starting" | "waiting" | "working" | "dead";
let status: Status = "starting";
let buildVersion = 0;
let previewUrl: string | null = null;
let buildTimer: ReturnType<typeof setTimeout> | null = null;
let demoed = false;
let activeCell = 0;
let pendingPrompt: string | null = null;

function currentDir() {
	return projectDir(appDir, active.id);
}

function loadBuildState() {
	const dir = currentDir();
	previewUrl = `${previewBase}/p/${active.id}`;
	if (!existsSync(join(dir, ".preview", "index.html"))) {
		buildVersion = 0;
		return;
	}
	try {
		buildVersion = Number(readFileSync(join(dir, ".preview", "version"), "utf8").trim()) || 1;
	} catch {
		buildVersion = 1;
	}
}
loadBuildState();

type AcpResolved = {
	command: string;
	args: string[];
	env: Record<string, string>;
	launcher: "installed" | "auto" | "missing";
};

/** 桌面端（ChatGPT.app）自带的 Codex CLI。让适配器复用它，账号和版本都跟桌面端一致。 */
function desktopCodexCli(): string | null {
	const candidates = [
		"/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
		join(homedir(), "Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex"),
		"/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex",
	];
	return candidates.find((path) => existsSync(path)) ?? null;
}

function acpEnv(preset: (typeof ACP_PRESETS)[number]): Record<string, string> {
	if (preset.id !== "codex") return {};
	// 用户显式设了 CODEX_PATH 就尊重用户的选择。
	if (process.env.CODEX_PATH) return {};
	const cli = desktopCodexCli();
	return cli ? { CODEX_PATH: cli } : {};
}

/** 用户手填命令 > PATH 上的默认命令 > 旧版二进制 > 内置 Bun 运行官方适配器。 */
function resolveAcp(
	preset: (typeof ACP_PRESETS)[number],
	config: (typeof settings.acp)[keyof typeof settings.acp],
): AcpResolved {
	const env = acpEnv(preset);
	const configured = config.command.trim();
	if (configured) {
		return { command: configured, args: config.args, env, launcher: commandPath(configured) ? "installed" : "missing" };
	}
	const { command, args } = resolvedAcpCommand(preset, config);
	if (commandPath(command)) return { command, args, env, launcher: "installed" };
	const alias = (preset.aliases ?? []).find((entry) => commandPath(entry));
	if (alias) return { command: alias, args, env, launcher: "installed" };
	// 没装全局命令时，用应用自带的 Bun 临时运行官方适配器；首次会自动下载。
	return { command: process.execPath, args: ["x", "--silent", preset.packageName], env, launcher: "auto" };
}

function agentInfos() {
	const builtins = AGENTS.map((entry) => ({
		id: entry.id,
		name: entry.name,
		description: t(entry.descriptionKey),
		kind: "builtin" as const,
		enabled: true,
		available: true,
		launcher: "installed" as const,
		command: "",
		args: [] as string[],
	}));
	const acp = ACP_PRESETS.map((preset) => {
		const config = settings.acp[preset.id];
		const resolved = resolveAcp(preset, config);
		return {
			id: preset.agentId,
			name: preset.name,
			description: t(preset.descriptionKey),
			kind: "acp" as const,
			enabled: config.enabled,
			available: resolved.launcher !== "missing",
			launcher: resolved.launcher,
			// command 保留用户原始输入（空字符串表示用默认值），界面据此显示占位符。
			command: config.command,
			args: config.args,
			defaultCommand: preset.defaultCommand,
			installCommand: preset.installCommand,
			packageName: preset.packageName,
		};
	});
	return [...builtins, ...acp];
}

/** 当前 Agent 是 ACP 时，给出引擎需要的启动参数。 */
function acpLaunch(agent: string) {
	const preset = acpPresetByAgentId(agent);
	if (!preset) return null;
	const config = settings.acp[preset.id];
	const { command, args, env } = resolveAcp(preset, config);
	return {
		command,
		args,
		env,
		name: preset.name,
		loginHint: preset.loginHint,
		model: config.model || undefined,
	};
}

const state = async () => ({
	status,
	theme: settings.theme,
	locale: settings.locale,
	agent: settings.agent,
	agents: agentInfos(),
	providers: await providerCatalog(),
	mock: settings.mock,
	provider: settings.provider,
	model: settings.model,
	previewUrl,
	version: buildVersion,
	project: active,
	projects: index.projects,
	models: await listAvailableModels(),
	replay: replayEvents(),
});

// ---------- 引擎 ----------

let supervisor: EngineSupervisor | null = null;
let engineStarted = false;

function startEngine() {
	supervisor?.kill();
	resetStreams();
	status = "starting";
	activeCell = 0;
	const project = active;
	supervisor = new EngineSupervisor(settings.runnerPath, projectDir(appDir, project.id), {
		onEvent: (event) => handleEngineEvent(project.id, event),
		onLog: (line) => log(line),
	});
	supervisor.spawn();
}

function handleEngineEvent(projectId: string, event: any) {
	if (projectId !== active.id) return;
	if (!["out", "text", "thinking"].includes(event.t)) {
		log("event", event.t, event.t === "cell" ? `#${event.n} ${event.summary}` : "");
	}
	if (event.t === "ready") {
		emitUi({ t: "status", value: "starting" });
		supervisor?.start({
			mock: settings.mock,
			model: settings.model,
			agent: settings.agent,
			gatewayUrl: gatewayUrl ?? undefined,
			acp: acpLaunch(settings.agent) ?? undefined,
		});
		return;
	}
	if (event.t === "started") {
		status = "waiting";
		emitUi({ t: "status", value: status });
		return;
	}
	if (event.t === "waiting") {
		status = "waiting";
		emitUi({ t: "status", value: status });
		if (pendingPrompt) {
			const text = pendingPrompt;
			pendingPrompt = null;
			sendUserMessage(text);
			return;
		}
		demo();
		return;
	}
	if (event.t === "cell") {
		const reasoning = reasoningStream.take().slice(0, 20_000);
		const message = textStream.take().slice(0, 20_000);
		status = "working";
		// bootstrap 格是基础设施，不写进历史也不显示。
		if (event.n === 0) {
			emitUi({ t: "status", value: status });
			return;
		}
		activeCell = event.n;
		emitUi({ t: "status", value: status });
		takeSnapshot(currentDir(), event.n);
		appendEvent(appDir, active.id, {
			kind: "cell",
			n: event.n,
			summary: event.summary,
			code: event.code.slice(0, 20_000),
			reasoning,
			message,
		});
		emitUi({ t: "cell", n: event.n, summary: event.summary, code: event.code, reasoning, message });
		return;
	}
	if (event.t === "out") {
		if (activeCell === 0) return;
		appendEvent(appDir, active.id, { kind: "out", n: activeCell, s: event.s, stream: event.stream });
		emitUi({ t: "out", s: event.s, stream: event.stream });
		return;
	}
	if (event.t === "result") {
		if (event.n === 0) return;
		appendEvent(appDir, active.id, { kind: "result", n: event.n, error: event.error });
		emitUi({ t: "result", n: event.n, error: event.error });
		return;
	}
	if (event.t === "text") {
		textStream.push(String(event.s ?? ""));
		return;
	}
	if (event.t === "thinking") {
		reasoningStream.push(String(event.s ?? ""));
		return;
	}
	if (event.t === "acpOptions") {
		emitUi({ t: "acpOptions", options: event.options });
		return;
	}
	if (event.t === "notice") {
		const text = String(event.text ?? "").slice(0, 4000);
		if (!text) return;
		appendEvent(appDir, active.id, { kind: "notice", text, tone: event.tone });
		emitUi({ t: "notice", text, tone: event.tone });
		return;
	}
	if (event.t === "assistant") {
		// 这一轮的完整回复：清掉仍在流式的缓冲，落成一条真正的消息，切换项目后还能看到。
		// 思考/代码缓冲也必须一起清，否则尾部的思考会漏进下一轮的第一个 cell。
		textStream.reset();
		reasoningStream.reset();
		const text = String(event.text ?? "").trim().slice(0, 20_000);
		if (!text) return;
		appendEvent(appDir, active.id, { kind: "assistant", text });
		emitUi({ t: "assistant", text });
		return;
	}
	if (event.t === "wrote") {
		appendEvent(appDir, active.id, { kind: "wrote" });
		scheduleBuild();
		return;
	}
	if (event.t === "usage") {
		appendEvent(appDir, active.id, { kind: "usage", ...event });
		emitUi({ t: "usage", input: event.input, output: event.output, cost: event.cost });
		return;
	}
	if (event.t === "dead") {
		status = "dead";
		emitUi({ t: "status", value: status });
		emitUi({ t: "fatal", message: event.error });
		log("engine dead:", event.error);
	}
}

function demo() {
	// ACP Agent 用的是用户自己的订阅，不能在新建项目时自动塞一条演示提示。
	if (acpPresetByAgentId(settings.agent)) return;
	if ((!settings.mock && !settings.demo) || demoed) return;
	const users = readEvents(appDir, active.id).filter((event) => event.kind === "user");
	if (users.length > 0) return;
	demoed = true;
	log("demo prompt");
	sendUserMessage(t("demoPrompt"));
}

function sendUserMessage(text: string) {
	// 新回合开始：先清掉上一回合的流式缓冲，避免半截思考/回复漏进新一轮。
	resetStreams();
	emitUi({ t: "user", text });
	const first = !readEvents(appDir, active.id).some((event) => event.kind === "user");
	appendEvent(appDir, active.id, { kind: "user", text });
	if (first) void ensureProjectMeta(active.id);
	supervisor?.sendMessage(text);
}

// 读-改-写，避免两个进程互相覆盖 projects.json。
function patchProject(projectId: string, patch: { iconSvg?: string; name?: string; autoName?: boolean }) {
	const fresh = loadIndex(appDir);
	const target = fresh.projects.find((entry) => entry.id === projectId);
	if (!target) return;
	Object.assign(target, patch);
	saveIndex(appDir, fresh);
	const local = index.projects.find((entry) => entry.id === projectId);
	if (local) Object.assign(local, patch);
	if (active.id === projectId) Object.assign(active, patch);
}

// 创建时用的机器名字：等用户发了第一条描述，再由模型换成真正的标题。（autoName 一直等到模型或用户定稿）
function needsAutoName(project: Project) {
	return project.autoName !== false;
}

async function ensureProjectMeta(projectId: string) {
	const project = index.projects.find((entry) => entry.id === projectId);
	if (!project || metaJobs.has(projectId)) return;
	const needsIcon = !project.iconSvg;
	const needsName = needsAutoName(project);
	if (!needsIcon && !needsName) return;
	const firstUser = readEvents(appDir, projectId).find((event: any) => event.kind === "user");
	if (!firstUser) return;
	metaJobs.add(projectId);
	log("meta generating", projectId, { needsIcon, needsName });
	try {
		const prompt = String(firstUser.text ?? "");
		const [svg, title] = await Promise.all([
			needsIcon ? generateProjectIcon(prompt, settings.provider, settings.model) : Promise.resolve(null),
			needsName ? generateProjectTitle(prompt, settings.provider, settings.model) : Promise.resolve(null),
		]);
		// 生成期间用户可能已经手动改名或删了项目，落盘前重新读一次索引。
		const fresh = loadIndex(appDir).projects.find((entry) => entry.id === projectId);
		if (!fresh) return;
		const patch: { iconSvg?: string; name?: string; autoName?: boolean } = {};
		if (svg) patch.iconSvg = svg;
		if (title && fresh.autoName !== false) {
			patch.name = title;
			patch.autoName = false;
		}
		if (Object.keys(patch).length === 0) return;
		patchProject(projectId, patch);
		emitUi({ t: "projects", projects: index.projects, activeId: active.id });
		log("meta ready", projectId, patch.name ?? "", svg ? `${svg.length} chars` : "no icon");
	} finally {
		metaJobs.delete(projectId);
	}
}

// 清掉上一版的 emoji 图标，等 AI 重新生成。
function migrateIcons() {
	let changed = false;
	for (const project of index.projects) {
		if (project.icon) {
			delete project.icon;
			changed = true;
		}
	}
	if (changed) saveIndex(appDir, index);
}

type BuildTrigger = "write" | "initial" | "manual";
type BuildOutcome = { ok: boolean; log: string; url: string | null; version: number };

// Builds are serialized: a Play click can land while a `wrote` build is in flight.
let buildChain: Promise<unknown> = Promise.resolve();

function enqueueBuild(trigger: BuildTrigger): Promise<BuildOutcome> {
	const run = () => runBuild(trigger);
	const task = buildChain.then(run, run);
	buildChain = task.then(
		() => undefined,
		() => undefined,
	);
	return task;
}

function scheduleBuild() {
	if (buildTimer) clearTimeout(buildTimer);
	buildTimer = setTimeout(() => {
		buildTimer = null;
		void enqueueBuild("write");
	}, 300);
}

// Build once when a project has never been built; an existing build is never rebuilt automatically.
function ensureInitialBuild() {
	// 旧项目的引擎文件还是 WebGL 模板；先同步到当前模板，再决定是否需要重建。
	if (syncProjectTemplate(appDir, settings.templateDir, active.id)) buildVersion = 0;
	if (buildVersion > 0) return;
	if (!existsSync(join(currentDir(), "src", "game.ts"))) return;
	void enqueueBuild("initial");
}

async function runBuild(trigger: BuildTrigger): Promise<BuildOutcome> {
	const projectId = active.id;
	const dir = currentDir();
	const migrated = syncProjectTemplate(appDir, settings.templateDir, projectId);
	if (trigger === "initial" && buildVersion > 0 && !migrated) {
		return { ok: true, log: "", url: previewUrl, version: buildVersion };
	}
	try {
		const result = await buildPreview(dir);
		let version = buildVersion;
		if (result.ok) {
			// The version file is the source of truth; read it so builds of other projects cannot mix in.
			let previous = 0;
			try {
				previous = Number(readFileSync(join(dir, ".preview", "version"), "utf8").trim()) || 0;
			} catch {
				previous = 0;
			}
			version = previous + 1;
			await Bun.write(join(dir, ".preview", "version"), String(version));
			log(`build ok in ${Math.round(result.ms)}ms, ${projectId} version ${version}`);
		} else {
			log("build failed", result.log.slice(0, 600));
		}
		const activeNow = active.id === projectId;
		if (activeNow && result.ok) {
			buildVersion = version;
			previewUrl = `${previewBase}/p/${projectId}`;
		}
		const outcome: BuildOutcome = {
			ok: result.ok,
			log: result.log.slice(0, 4000),
			url: `${previewBase}/p/${projectId}`,
			version: activeNow ? buildVersion : version,
		};
		if (activeNow) emitUi({ t: "build", projectId, ...outcome, trigger });
		return outcome;
	} catch (error) {
		const message = String((error as Error)?.message ?? error);
		log("build crashed", message);
		if (active.id === projectId) emitUi({ t: "build", projectId, ok: false, log: message, url: previewUrl, version: buildVersion, trigger });
		return { ok: false, log: message, url: previewUrl, version: buildVersion };
	}
}

function replayEvents() {
	const items: any[] = [];
	for (const event of readEvents(appDir, active.id)) {
		if (event.n === 0) continue;
		if (event.kind === "user") items.push({ t: "user", text: event.text });
		else if (event.kind === "cell")
			items.push({
				t: "cell",
				n: event.n,
				summary: event.summary,
				code: event.code,
				reasoning: event.reasoning ?? "",
				message: event.message ?? "",
			});
		else if (event.kind === "out") items.push({ t: "out", s: event.s, stream: event.stream });
		else if (event.kind === "result") items.push({ t: "result", n: event.n, error: event.error });
		else if (event.kind === "assistant") items.push({ t: "assistant", text: event.text });
		else if (event.kind === "notice") items.push({ t: "notice", text: event.text, tone: event.tone });
	}
	return items;
}

function switchProject(id: string) {
	const project = index.projects.find((entry) => entry.id === id);
	if (!project || project.id === active.id) return;
	active = project;
	index.activeId = id;
	const next = loadIndex(appDir);
	next.activeId = id;
	index = next;
	writeFileSync(join(appDir, "projects.json"), JSON.stringify(index, null, 2));
	if (buildTimer) clearTimeout(buildTimer);
	buildTimer = null;
	loadBuildState();
	if (syncProjectTemplate(appDir, settings.templateDir, id)) buildVersion = 0;
	restartGateway();
	startEngine();
	void ensureProjectMeta(id);
	emitUi({ t: "projects", projects: index.projects, activeId: id });
	emitUi({ t: "history", items: replayEvents(), previewUrl, version: buildVersion });
	ensureInitialBuild();
	log("switch project", id);
}

function createNewProject(prompt?: string) {
	const project = createProject(appDir, settings.templateDir, t("projectNumber", { n: index.projects.length + 1 }));
	index = loadIndex(appDir);
	active = project;
	pendingPrompt = prompt ?? null;
	loadBuildState();
	restartGateway();
	startEngine();
	emitUi({ t: "projects", projects: index.projects, activeId: project.id });
	emitUi({ t: "history", items: [], previewUrl, version: 0 });
	ensureInitialBuild();
	log("create project", project.id);
}

function removeProject(id: string) {
	const wasActive = active.id === id;
	index = deleteProject(appDir, id);
	if (!index.projects.length) {
		const project = createProject(appDir, settings.templateDir, t("projectFirst"));
		index = loadIndex(appDir);
		active = project;
	} else if (wasActive) {
		active = index.projects[0]!;
		index.activeId = active.id;
	}
	writeFileSync(join(appDir, "projects.json"), JSON.stringify(index, null, 2));
	// 只有删掉当前项目才需要切引擎、重放历史；删别的项目不该打断正在进行的对话。
	if (wasActive) {
		loadBuildState();
		if (syncProjectTemplate(appDir, settings.templateDir, active.id)) buildVersion = 0;
		restartGateway();
		startEngine();
		emitUi({ t: "projects", projects: index.projects, activeId: active.id });
		emitUi({ t: "history", items: replayEvents(), previewUrl, version: buildVersion });
		ensureInitialBuild();
	} else {
		emitUi({ t: "projects", projects: index.projects, activeId: active.id });
	}
}

// 手动改名：只动显示名，autoName 置 false 后后台就不会再被模型覆盖。
function renameProject(id: string, name: string) {
	const trimmed = name.trim().slice(0, 40);
	if (!trimmed) return;
	if (!index.projects.some((entry) => entry.id === id)) return;
	patchProject(id, { name: trimmed, autoName: false });
	emitUi({ t: "projects", projects: index.projects, activeId: active.id });
	log("rename project", id, trimmed);
}

// ---------- 登录 ----------

type PendingLogin = {
	providerId: string;
	controller: AbortController;
	answer: ((value: string) => void) | null;
};

let pendingLogin: PendingLogin | null = null;

async function startLogin(providerId: string) {
	cancelLogin();
	const controller = new AbortController();
	const login: PendingLogin = { providerId, controller, answer: null };
	pendingLogin = login;
	const notify = (event: any) => {
		emitUi({ t: "authEvent", providerId, event });
		if (event?.type === "auth_url" && event.url) Utils.openExternal(event.url);
		if (event?.type === "device_code" && event.verificationUri) Utils.openExternal(event.verificationUri);
	};
	try {
		await beginProviderLogin(providerId, {
			signal: controller.signal,
			notify,
			prompt: (prompt: any) =>
				new Promise<string>((resolve) => {
					login.answer = resolve;
					emitUi({ t: "authPrompt", providerId, prompt });
				}),
		});
		emitUi({ t: "authDone", providerId, ok: true });
	} catch (error) {
		emitUi({ t: "authDone", providerId, ok: false, error: String((error as Error)?.message ?? error) });
	} finally {
		if (pendingLogin === login) pendingLogin = null;
	}
}

function answerLogin(providerId: string, value: string) {
	if (!pendingLogin || pendingLogin.providerId !== providerId) return;
	const resolve = pendingLogin.answer;
	pendingLogin.answer = null;
	resolve?.(value);
}

function cancelLogin() {
	if (!pendingLogin) return;
	pendingLogin.controller.abort();
	pendingLogin = null;
}

function saveSettings() {
	writeFileSync(
		join(appDir, "settings.json"),
		JSON.stringify(
			{
				provider: settings.provider,
				model: settings.model,
				theme: settings.theme,
				locale: settings.locale,
				agent: settings.agent,
				acp: settings.acp,
			},
			null,
			2,
		),
	);
}

function setTheme(theme: "dark" | "light") {
	settings.theme = theme;
	saveSettings();
	emitUi({ t: "theme", value: theme });
}

function applyLocale(value: string) {
	const next: Locale = normalizeLocale(value) ?? settings.locale;
	if (next === settings.locale) return;
	settings.locale = next;
	setCurrentLocale(next);
	installApplicationMenu();
	saveSettings();
	emitUi({ t: "locale", value: next });
	log("set locale", next);
}

function setModel(provider: string, model: string) {
	settings.provider = provider;
	settings.model = model;
	saveSettings();
	restartGateway();
	startEngine();
	emitUi({ t: "model", provider, model });
	log("set model", provider, model);
}

function setAgent(agent: string) {
	const next = normalizeAgent(agent);
	const preset = acpPresetByAgentId(next);
	// 未启用的 ACP Agent 不出现在聊天选择器里；旧界面传来也直接忽略。
	if (preset && !settings.acp[preset.id].enabled) return;
	if (next === settings.agent) return;
	settings.agent = next;
	saveSettings();
	emitUi({ t: "agent", value: next });
	emitUi({ t: "status", value: "starting" });
	startEngine();
	log("set agent", next);
}

/** 切换 ACP 会话内的模型；同时记住，下次启动直接恢复。 */
function setAcpConfig(configId: string, value: string) {
	const preset = acpPresetByAgentId(settings.agent);
	if (!preset) return;
	if (configId === "model") {
		settings.acp[preset.id].model = value;
		saveSettings();
	}
	supervisor?.setAcpOption(configId, value);
	log("set acp config", preset.id, configId, value);
}

function setAcpAgent(id: string, patch: { enabled?: boolean; command?: string; args?: string[] }) {
	// 界面传的是 agentId（acp-claude-code），settings.json 的键是 preset id（claude-code）。
	const preset = ACP_PRESETS.find((entry) => entry.id === id || entry.agentId === id);
	if (!preset) return;
	const config = settings.acp[preset.id];
	const wasActive = settings.agent === preset.agentId;
	if (typeof patch.enabled === "boolean") config.enabled = patch.enabled;
	if (typeof patch.command === "string") config.command = patch.command.trim().slice(0, 400);
	if (Array.isArray(patch.args)) {
		config.args = patch.args.filter((arg) => typeof arg === "string").slice(0, 20);
	}
	if (!config.enabled && wasActive) {
		settings.agent = "fibona";
		emitUi({ t: "agent", value: "fibona" });
		emitUi({ t: "status", value: "starting" });
		startEngine();
	} else if (wasActive && (patch.command !== undefined || patch.args !== undefined)) {
		// 改命令后立刻重启，用户不用再切一次 Agent。
		emitUi({ t: "status", value: "starting" });
		startEngine();
	}
	saveSettings();
	emitUi({ t: "agents", agents: agentInfos() });
	log("set acp", preset.id, JSON.stringify(config));
}

// ---------- 窗口与 RPC ----------

const rpc = BrowserView.defineRPC<{
	bun: {
		requests: {
			getState: { params: Record<string, never>; response: any };
			listFiles: { params: Record<string, never>; response: any };
			buildNow: { params: Record<string, never>; response: BuildOutcome };
			readFile: { params: { path: string }; response: any };
		};
		messages: {
			userMessage: { text: string };
			interrupt: Record<string, never>;
			rollback: { name: string };
			previewEvent: { type: string; message?: string };
			setTheme: { theme: "dark" | "light" };
			setLocale: { locale: string };
			beginLogin: { providerId: string };
			authAnswer: { providerId: string; value: string };
			cancelLogin: Record<string, never>;
			logout: { providerId: string };
			createProject: { prompt?: string };
			switchProject: { id: string };
			deleteProject: { id: string };
			renameProject: { id: string; name: string };
			setModel: { provider: string; model: string };
			setAgent: { agent: string };
			setAcp: { id: string; enabled?: boolean; command?: string; args?: string[] };
			setAcpConfig: { configId: string; value: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: { engineEvent: Record<string, unknown> };
	};
}>({
	maxRequestTime: 20_000,
	handlers: {
		requests: {
			getState: () => state(),
			buildNow: () => enqueueBuild("manual"),
			listFiles: () => {
				log("rpc listFiles");
				try {
					return { ok: true, ...listProjectFiles(currentDir()) };
				} catch (error) {
					return { ok: false, error: String((error as Error)?.message ?? error) };
				}
			},
			readFile: ({ path }: { path: string }) => {
				log("rpc readFile", path);
				try {
					return { ok: true, file: readProjectFile(currentDir(), path) };
				} catch (error) {
					return { ok: false, error: String((error as Error)?.message ?? error) };
				}
			},
		},
		messages: {
			userMessage: ({ text }: { text: string }) => {
				log("rpc userMessage", text.slice(0, 80));
				sendUserMessage(text);
			},
			previewEvent: (payload: any) => {
				log("preview", payload.type, payload.message?.slice?.(0, 200) ?? "");
				// 等界面挂载再起引擎，避免它的事件抢在初始状态之前。
				if (payload?.type === "ui-ready" && !engineStarted) {
					engineStarted = true;
					if (syncProjectTemplate(appDir, settings.templateDir, active.id)) buildVersion = 0;
					startEngine();
					ensureInitialBuild();
				}
			},
			setTheme: ({ theme }: { theme: "dark" | "light" }) => setTheme(theme),
			setLocale: ({ locale }: { locale: string }) => applyLocale(locale),
			beginLogin: ({ providerId }: { providerId: string }) => void startLogin(providerId),
			authAnswer: ({ providerId, value }: { providerId: string; value: string }) => answerLogin(providerId, value),
			cancelLogin: () => cancelLogin(),
			logout: ({ providerId }: { providerId: string }) => void logoutProvider(providerId),
			interrupt: () => supervisor?.interrupt(),
			rollback: ({ name }: { name: string }) => {
				if (restoreSnapshot(currentDir(), name)) scheduleBuild();
			},
			createProject: ({ prompt }: { prompt?: string }) => createNewProject(prompt),
			switchProject: ({ id }: { id: string }) => switchProject(id),
			deleteProject: ({ id }: { id: string }) => removeProject(id),
			renameProject: ({ id, name }: { id: string; name: string }) => renameProject(id, name),
			setModel: ({ provider, model }: { provider: string; model: string }) => setModel(provider, model),
			setAgent: ({ agent }: { agent: string }) => setAgent(agent),
			setAcp: ({ id, enabled, command, args }: { id: string; enabled?: boolean; command?: string; args?: string[] }) =>
				setAcpAgent(id, { enabled, command, args }),
			setAcpConfig: ({ configId, value }: { configId: string; value: string }) => setAcpConfig(configId, value),
		},
	},
});

// WKWebView 的 ⌘C/⌘V/⌘X 走的是应用菜单的标准编辑项（paste: / copy: 等 selector），
// 没有菜单时这些快捷键根本不会传到网页里，粘贴就"失效"了。这里补一份最小菜单。
function installApplicationMenu() {
	if (process.platform !== "darwin") return;
	ApplicationMenu.setApplicationMenu([
		{
			label: "VibeGame",
			submenu: [
				{ role: "about" },
				{ type: "divider" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "showAll" },
				{ type: "divider" },
				{ role: "quit", accelerator: "Command+Q" },
			],
		},
		{
			label: t("menuEdit"),
			submenu: [
				{ role: "undo", accelerator: "Command+Z" },
				{ role: "redo", accelerator: "Command+Shift+Z" },
				{ type: "divider" },
				{ role: "cut", accelerator: "Command+X" },
				{ role: "copy", accelerator: "Command+C" },
				{ role: "paste", accelerator: "Command+V" },
				{ role: "pasteAndMatchStyle", accelerator: "Command+Option+Shift+V" },
				{ role: "delete" },
				{ role: "selectAll", accelerator: "Command+A" },
			],
		},
		{
			label: t("menuWindow"),
			submenu: [
				{ role: "minimize", accelerator: "Command+M" },
				{ role: "zoom" },
				{ type: "divider" },
				{ role: "close", accelerator: "Command+W" },
			],
		},
	]);
}

const win = new BrowserWindow({
	title: "VibeGame",
	url: "views://mainview/index.html",
	frame: { width: 1400, height: 900 },
	titleBarStyle: "hiddenInset",
	transparent: false,
	rpc,
});

// 菜单要在原生应用和窗口就绪之后再设，提前调用会让窗口创建不出来。
installApplicationMenu();

function emitUi(payload: Record<string, unknown>) {
	try {
		(win as any).webview?.rpc?.send?.engineEvent(payload);
	} catch (error) {
		log("emit failed", String(error));
	}
}

win.on("close", () => {
	supervisor?.kill();
	gateway?.close();
});
