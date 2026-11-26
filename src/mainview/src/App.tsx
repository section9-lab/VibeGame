import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Compass, Gamepad2, Plus, Settings2 } from "lucide-react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { cn } from "@/lib/utils";
import {
	createRpc,
	type AcpConfigOption,
	type AgentInfo,
	type AuthEvent,
	type AuthPrompt,
	type Client,
	type ModelRef,
	type ProjectRef,
	type ProviderInfo,
	type Status,
	type UiEvent,
} from "@/rpc";
import { createTranslator, detectLocale, normalizeLocale, t as globalT, type Locale } from "@/i18n";
import { I18nProvider, useI18n } from "@/i18n/I18nProvider";
import { Chat, type ChatItem } from "@/Chat";
import { appendLiveDelta, dropLive } from "@/lib/chat-items";
import { TooltipProvider } from "@/components/ui/tooltip"
import { SettingsPage } from "@/SettingsPage";
import { LoginDialog } from "@/LoginDialog";
import { PreviewPane } from "@/PreviewPane";
import { ProjectHeader } from "@/ProjectHeader";
import { projectDisplayName } from "@/lib/project-name";
import { gameSuggestions } from "@/lib/game-suggestions";
import { VibeGameMark } from "@/components/vibegame-mark";

type View = "workspace" | "discover" | "settings";

const LOCALE_CACHE_KEY = "vibegame-locale";

function readCachedLocale(): Locale {
	try {
		const cached = normalizeLocale(localStorage.getItem(LOCALE_CACHE_KEY));
		if (cached) return cached;
	} catch {
		// Storage may be unavailable; fall back to the system language.
	}
	return detectLocale();
}

function cacheLocale(locale: Locale) {
	try {
		localStorage.setItem(LOCALE_CACHE_KEY, locale);
	} catch {
		// Storage is optional, settings.json remains the source of truth.
	}
}

let seq = 0;
const key = (prefix: string) => `${prefix}-${seq++}`;

export default function App() {
	const [client, setClient] = useState<Client | null>(null);
	const [view, setView] = useState<View>("workspace");
	const [items, setItems] = useState<ChatItem[]>([]);
	const [status, setStatus] = useState<Status>("starting");
	const [theme, setTheme] = useState<"dark" | "light">("dark");
	const [locale, setLocale] = useState<Locale>(readCachedLocale);
	const t = useMemo(() => createTranslator(locale), [locale]);
	const [agent, setAgent] = useState("fibona");
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [projects, setProjects] = useState<ProjectRef[]>([]);
	const [activeId, setActiveId] = useState("");
	const [models, setModels] = useState<ModelRef[]>([]);
	const [acpOptions, setAcpOptions] = useState<AcpConfigOption[]>([]);
	const [model, setModel] = useState("");
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	// 点聊天里的“添加 ACP Agent”时，把设置页直接带到对应区域。
	const [settingsIntent, setSettingsIntent] = useState<{
		nonce: number;
		tab: "agent" | "providers";
		anchor?: string;
	} | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [version, setVersion] = useState(0);
	const [applied, setApplied] = useState(0);
	const [running, setRunning] = useState(false);
	const [backend, setBackend] = useState<"webgpu" | "webgl2" | null>(null);
	const [fileRevision, setFileRevision] = useState(0);
	const [buildLog, setBuildLog] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [building, setBuilding] = useState(false);	const [now, setNow] = useState(() => Date.now());
	const [login, setLogin] = useState<{
		providerId: string | null;
		prompt: AuthPrompt | null;
		event: AuthEvent | null;
		error: string | null;
		done: boolean;
	}>({ providerId: null, prompt: null, event: null, error: null, done: false });

	const clientRef = useRef<Client | null>(null);
	const buildingRef = useRef(false);
	const cellStateRef = useRef<Map<string, string>>(new Map());
	const outputQueueRef = useRef<Map<string, string>>(new Map());
	const outputFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const readyRef = useRef(false);
	const replayingRef = useRef(false);
	const queueRef = useRef<UiEvent[]>([]);
	const cellRefs = useRef<Map<number, string>>(new Map());
	// 当前流式内容所在的行 key。cell/assistant 落盘时复用这条行原地升级，
	// 不再“删一行 + 加一行”，从而不会触发行数不变时的 anchor 重新定位。
	const liveKeyRef = useRef<string | null>(null);
	const iframeRef = useRef<HTMLIFrameElement>(null);
	const activeIdRef = useRef("");

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		try {
			localStorage.setItem("vibegame-theme", theme);
		} catch {
			// 存储不可用时忽略，主题仍在本机 settings.json 里持久化。
		}
	}, [theme]);

	useEffect(() => {
		return () => {
			if (outputFlushRef.current !== null) clearTimeout(outputFlushRef.current);
		};
	}, []);

	useEffect(() => {
		cacheLocale(locale);
	}, [locale]);

	// Load an already-built preview. No build happens here.
	const startPreview = useCallback((url: string, nextVersion: number) => {
		const frame = iframeRef.current;
		if (!frame) return;
		clientRef.current?.send("previewEvent", { type: "ui-apply", message: `${url} v${nextVersion}` });
		// 加时间戳，保证点“再次运行”时绕过 iframe 缓存。
		frame.src = `${url}/?v=${nextVersion}&t=${Date.now()}`;
		setRunning(true);
		setBackend(null);
		setApplied(nextVersion);
		setPreviewError(null);
	}, []);

	// Play always rebuilds the current src/game.ts first, then loads the fresh preview.
	const runPreview = useCallback(async () => {
		if (buildingRef.current) return;
		buildingRef.current = true;
		setBuilding(true);
		setPreviewError(null);
		const projectId = activeIdRef.current;
		try {
			const result = await clientRef.current?.buildNow();
			if (!result) return;
			// The user may switch projects while the build runs; never load another project's preview.
			if (activeIdRef.current !== projectId) return;
			if (result.ok && result.url) startPreview(result.url, result.version);
			else setBuildLog(result.log || null);
		} finally {
			buildingRef.current = false;
			setBuilding(false);
		}
	}, [startPreview]);

	const stopPreview = useCallback(() => {
		const frame = iframeRef.current;
		if (frame) frame.src = "about:blank";
		setRunning(false);
		setBackend(null);
		setApplied(version);
	}, [version]);

	const split = useDefaultLayout({
		id: "vibegame-workspace",
		panelIds: ["chat", "preview"],
		onlySaveAfterUserInteractions: true,
	});

	useEffect(() => {
		// 离开工作区会卸载 iframe，回来时标记为未运行，避免出现“状态说在运行、画面却是空白”。
		if (view !== "workspace") setRunning(false);
	}, [view]);

	useEffect(() => {
		// 进设置页时重新探测一次 ACP 命令，装完适配器不用重启应用。
		if (view !== "settings") return;
		void clientRef.current?.getState().then((state) => {
			if (state?.agents) setAgents(state.agents);
		});
	}, [view]);

	const refreshProviders = useCallback(async () => {
		const state = await clientRef.current?.getState();
		if (state) setProviders(state.providers ?? []);
	}, []);

	const handle = useCallback(
		(event: UiEvent) => {
			// 初始状态到达前先缓存实时事件，避免 history 回放把正在跑的格子标成中断。
			if (!readyRef.current && !replayingRef.current) {
				queueRef.current.push(event);
				return;
			}
			switch (event.t) {
				case "status":
					setStatus(event.value);
					if (event.value === "waiting" || event.value === "dead") {
						setItems((prev) =>
							prev.map((item, index) => {
								const last = index === prev.length - 1;
								if (!last) return item;
								if (item.kind === "cell" && item.state === "running") {
									return { ...item, state: event.value === "waiting" ? "waiting" : "interrupted" };
								}
								// 回合已结束但 live 行没被 cell/assistant 接走（比如只有思考、没有工具调用）：
								// 停止“Thinking…”转圈，否则会一直闪。
								if (item.kind === "live" && item.streaming) return { ...item, streaming: false };
								return item;
							}),
						);
					}
					return;
				case "theme":
					setTheme(event.value);
					return;
				case "locale":
					setLocale(normalizeLocale(event.value) ?? "en");
					return;
				case "user": {
					const hadLive = liveKeyRef.current !== null;
					liveKeyRef.current = null;
					// 如果尾部还有没落盘的 live 行，“删 live + 加 user”在同一个 commit 里行数不变，
					// 滚动容器会去对齐一条历史 anchor（表现为跳到会话顶部）。
					// 分两次提交后，user 行走“新增 anchor”路径，正常停在新回合顶部。
					if (hadLive) flushSync(() => setItems(dropLive));
					setItems((prev) => [...prev, { key: key("u"), kind: "user", text: event.text }]);
					return;
				}
				case "assistantDelta":
					if (activeIdRef.current && event.projectId !== activeIdRef.current) return;
					liveKeyRef.current ??= key("l");
					setItems((prev) => appendLiveDelta(prev, liveKeyRef.current!, "message", event.text));
					return;
				case "reasoningDelta":
					if (activeIdRef.current && event.projectId !== activeIdRef.current) return;
					liveKeyRef.current ??= key("l");
					setItems((prev) => appendLiveDelta(prev, liveKeyRef.current!, "reasoning", event.text));
					return;
				case "streamReset":
					// 主进程只是清空本次模型调用的增量缓冲（每次模型调用都会发一次）。
					// 不能在这里删 live 行：思考卡会随着每次模型调用消失又重建，表现为持续闪烁。
					// live 行只由 cell / assistant / user / history 消费。
					return;
				case "cell": {
					// 有 live 行就原地升级成 cell（同一个 key / 同一个 DOM 节点），
					// 思考卡不会卸载重建，滚动容器也不会把它当成“新行”重新对错。
					const id = liveKeyRef.current ?? key("c");
					liveKeyRef.current = null;
					cellRefs.current.set(event.n, id);
					setItems((prev) => {
						const row: ChatItem = {
							key: id,
							kind: "cell",
							n: event.n,
							summary: event.summary,
							code: event.code,
							output: "",
							error: null,
							state: "running",
							startedAt: Date.now(),
							reasoning: event.reasoning ?? "",
							message: event.message ?? "",
						};
						const last = prev[prev.length - 1];
						return last?.kind === "live" ? [...prev.slice(0, -1), row] : [...prev, row];
					});
					return;
				}
				case "out": {
					const id = lastCellKey(cellRefs.current);
					if (!id) return;
					// 输出是按块到达的；每块都 setItems 会让整条长对话重排。
					// 先累积，最多每 80ms 合批刷新一次。
					const queued = outputQueueRef.current;
					queued.set(id, (queued.get(id) ?? "") + event.s);
					if (outputFlushRef.current === null) {
						outputFlushRef.current = setTimeout(() => {
							outputFlushRef.current = null;
							const pending = new Map(queued);
							queued.clear();
							if (pending.size === 0) return;
							setItems((prev) =>
								prev.map((item) => {
									const chunk = pending.get(item.key);
									return chunk && item.kind === "cell" ? { ...item, output: item.output + chunk } : item;
								}),
							);
						}, 80);
					}
					return;
				}
				case "result": {
					const id = cellRefs.current.get(event.n) ?? lastCellKey(cellRefs.current);
					if (!id) return;
					const pending = outputQueueRef.current.get(id) ?? "";
					outputQueueRef.current.delete(id);
					setItems((prev) =>
						prev.map((item) =>
							item.key === id && item.kind === "cell"
								? {
										...item,
										output: item.output + pending,
										error: event.error,
										state: event.error ? "error" : "done",
										endedAt: Date.now(),
									}
								: item,
						),
					);
					return;
				}
				case "build": {
					if (activeIdRef.current && event.projectId !== activeIdRef.current) return;
					setFileRevision((value) => value + 1);
					setPreviewUrl(event.url);
					setVersion(event.version);
					if (!event.ok) {
						setBuildLog(event.log);
						return;
					}
					setBuildLog(null);
					if (event.trigger === "write" && event.url) {
						// The engine wrote a new version: auto-start it, as before.
						startPreview(event.url, event.version);
					} else {
						// Initial/manual builds only enable Play; the user presses it.
						setApplied(event.version);
					}
					return;
				}
				case "usage":
					return;
				case "projects":
					setProjects(event.projects);
					setActiveId(event.activeId);
					activeIdRef.current = event.activeId;
					return;
				case "history":
					if (outputFlushRef.current !== null) {
						clearTimeout(outputFlushRef.current);
						outputFlushRef.current = null;
					}
					outputQueueRef.current.clear();
					setAcpOptions([]);
					cellRefs.current.clear();
					liveKeyRef.current = null;
					// 先把旧 transcript 清成空再回放：否则行数与旧列表恰好相同时，
					// 滚动容器会把整份历史当成“同一条消息被替换”，去对齐旧的 anchor。
					flushSync(() => setItems([]));
					setBackend(null);
					setPreviewUrl(event.previewUrl);
					setVersion(event.version);
					setApplied(0);
					setRunning(false);
					const frame = iframeRef.current;
					if (frame) frame.src = "about:blank";
					setBuildLog(null);
					setPreviewError(null);
					for (const item of event.items) handle(item);
					setItems((prev) =>
						prev.map((item) =>
							item.kind === "cell" && item.state === "running" ? { ...item, state: "interrupted" } : item,
						),
					);
					return;
				case "model":
					// 换模型会重启网关和引擎，旧的 live 行属于上一轮，直接收掉。
					liveKeyRef.current = null;
					setItems(dropLive);
					setModel(`${event.provider}/${event.model}`);
					return;
				case "agents":
					setAgents(event.agents);
					return;
				case "assistant":
					// 回复流式行原地升级成正式消息：行数不变，也不再把新消息对齐到视口顶部。
					// 尾部思考一并带过去，否则它会随流式行一起消失（历史回放里本来就没有这段）。
					liveKeyRef.current = null;
					setItems((prev) => {
						const last = prev[prev.length - 1];
						if (last?.kind === "live") {
							const row: ChatItem = {
								key: last.key,
								kind: "assistant",
								text: event.text,
								reasoning: last.reasoning,
							};
							return [...prev.slice(0, -1), row];
						}
						return [...prev, { key: key("a"), kind: "assistant", text: event.text }];
					});
					return;
				case "acpOptions":
					setAcpOptions(event.options);
					return;
				case "notice":
					setItems((prev) => [...prev, { key: key("n"), kind: "notice", text: event.text, tone: event.tone }]);
					return;
				case "agent":
					setAgent(event.value);
					setAcpOptions([]);
					liveKeyRef.current = null;
					setItems(dropLive);
					setItems((prev) =>
						prev.map((item) =>
							item.kind === "cell" && item.state === "running" ? { ...item, state: "interrupted" } : item,
						),
					);
					return;
				case "authEvent":
					setLogin((prev) => ({ ...prev, event: event.event, providerId: event.providerId, error: null }));
					return;
				case "authPrompt":
					setLogin((prev) => ({ ...prev, prompt: event.prompt, providerId: event.providerId }));
					return;
				case "authDone":
					setLogin((prev) => ({
						...prev,
						prompt: null,
						done: event.ok,
						error: event.ok ? null : (event.error ?? globalT("loginFailed")),
					}));
					void refreshProviders();
					return;
				case "fatal":
					setItems((prev) => [
						...prev,
						{
							key: key("n"),
							kind: "notice",
							text: globalT("engineStopped", { message: event.message }),
							tone: "error",
						},
					]);
					return;
			}
		},
		[refreshProviders, startPreview],
	);

	useEffect(() => {
		const c = createRpc(handle);
		clientRef.current = c;
		setClient(c);
		void c.getState().then((state) => {
			if (!state) return;
			c.send("previewEvent", {
				type: "ui-state",
				message: `${state.project.id} v${state.version} providers=${state.providers?.length ?? 0} models=${state.models?.length ?? 0} theme=${state.theme}`,
			});
			setModels(state.models ?? []);
			setModel(`${state.provider}/${state.model}`);
			setAgent(state.agent ?? "fibona");
			setAgents(state.agents ?? []);
			setTheme(state.theme ?? "dark");
			setLocale(state.locale ?? "en");
			setProviders(state.providers ?? []);
			setProjects(state.projects ?? []);
			setActiveId(state.project.id);
			activeIdRef.current = state.project.id;
			setStatus(state.status);
			setPreviewUrl(state.previewUrl);
			setVersion(state.version);
			setRunning(false);
			replayingRef.current = true;
			handle({ t: "history", items: state.replay ?? [], previewUrl: state.previewUrl, version: state.version });
			replayingRef.current = false;
			readyRef.current = true;
			const queued = queueRef.current;
			queueRef.current = [];
			for (const event of queued) handle(event);
		}).finally(() => {
			c.send("previewEvent", { type: "ui-ready" });
		});
	}, [handle]);

	useEffect(() => {
		const onMessage = (event: MessageEvent) => {
			const data = event.data;
			if (!data?.source || data.source !== "vibegame") return;
			client?.send("previewEvent", { type: `page-${data.type}`, message: data.message });
			if (!event.origin.startsWith("http://127.0.0.1:")) return;
			client?.send("previewEvent", { type: data.type, message: data.message });
			if (data.type === "error" && data.message) setPreviewError(String(data.message));
			if (data.type === "ready" && (data.backend === "webgpu" || data.backend === "webgl2")) {
				setBackend(data.backend);
			}
		};
		addEventListener("message", onMessage);
		return () => removeEventListener("message", onMessage);
	}, [client]);

	useEffect(() => {
		// Opening or switching to a project that already has a build preloads it once.
		if (version > 0 && applied === 0 && previewUrl) startPreview(previewUrl, version);
	}, [version, applied, previewUrl, startPreview]);

	useEffect(() => {
		for (const item of items) {
			if (item.kind !== "cell") continue;
			const prev = cellStateRef.current.get(item.key);
			if (prev === item.state) continue;
			cellStateRef.current.set(item.key, item.state);
			clientRef.current?.send("previewEvent", { type: "ui-cell-state", message: `${item.key} #${item.n} ${item.state}` });
		}
	}, [items]);

	useEffect(() => {
		const active = items.some((item) => item.kind === "cell" && (item.state === "running" || item.state === "waiting"));
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, [items]);

	const clearSettingsIntent = useCallback(() => setSettingsIntent(null), []);

	const acpSelected = agents.find((entry) => entry.id === agent)?.kind === "acp";
	const acpModelOption = acpOptions.find((entry) => entry.id === "model");
	const acpModel = acpSelected && acpModelOption
		? { current: acpModelOption.currentValue, values: acpModelOption.values }
		: null;
	const send = (text: string) => {
		if (status === "dead") return;
		client?.send("userMessage", { text });
	};

	const loginProvider = providers.find((entry) => entry.id === login.providerId);

	return (
		<I18nProvider locale={locale}>
			<TooltipProvider>
				<div className="flex h-full flex-col bg-background text-foreground">
					<header className="electrobun-webkit-app-region-drag h-9 shrink-0 select-none" />

					<div className="flex min-h-0 flex-1">
						<Rail
							view={view}
							setView={setView}
							projects={projects}
							activeId={activeId}
							onCreate={() => {
								client?.send("createProject", {});
								setView("workspace");
							}}
							onSwitch={(id) => {
								client?.send("switchProject", { id });
								setView("workspace");
							}}
						/>

						<div className="min-h-0 flex-1">
						{view === "workspace" && (
							<main className="h-full min-h-0 p-3">
								<div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/10 dark:shadow-black/30">
								<ProjectHeader
									key={activeId}
									project={projects.find((entry) => entry.id === activeId) ?? null}
									lastProject={projects.length <= 1}
									onDelete={(id) => client?.send("deleteProject", { id })}
									onRename={(id, name) => client?.send("renameProject", { id, name })}
								/>
								<div className="min-h-0 flex-1">
								<Group
									orientation="horizontal"
									className="h-full min-h-0"
									defaultLayout={split.defaultLayout}
									onLayoutChanged={split.onLayoutChanged}
								>
									<Panel id="chat" defaultSize="48" minSize={320} className="h-full min-h-0">
										<Chat
											// 切换项目时重建滚动容器：旧 transcript 的行数与新项目恰好相同时，
											// 滚动容器会把“行数不变”误判成同一条消息被替换。
											key={activeId}
											items={items}
											status={status}
											nowMs={now}
											agent={agent}
											agents={agents.filter((entry) => entry.kind === "builtin" || entry.enabled)}
											model={model}
											models={models}
											onSend={send}
											onStop={() => client?.send("interrupt", {})}
											onAgent={(value) => client?.send("setAgent", { agent: value })}
											onAddAcpAgent={() => {
												setSettingsIntent({ nonce: Date.now(), tab: "agent", anchor: "settings-acp-agents" });
												setView("settings");
											}}
											onModel={(value) => {
												const [provider, ...rest] = value.split("/");
												setModel(value);
												client?.send("setModel", { provider, model: rest.join("/") });
											}}
											acpModel={acpModel}
											onAcpModel={(value) => client?.send("setAcpConfig", { configId: "model", value })}
										/>
									</Panel>
									<Separator className="relative w-2 shrink-0 bg-card outline-none after:pointer-events-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring" />

									<Panel id="preview" defaultSize="52" minSize="32" className="h-full min-h-0">
										<PreviewPane
											client={client}
											projectId={activeId}
											fileRevision={fileRevision}
											iframeRef={iframeRef}
											previewUrl={previewUrl}
											backend={backend}
											version={version}
											applied={applied}
											running={running}
											buildLog={buildLog}
											previewError={previewError}
											onRun={runPreview}
										building={building}
											onStop={stopPreview}
											onFixError={(message) => {
												client?.send("userMessage", { text: t("fixPreviewPrompt", { message }) });
												setPreviewError(null);
											}}
										/>
									</Panel>
								</Group>
								</div>
								</div>
							</main>
						)}

						{view === "discover" && (
							<div className="h-full p-3">
								<div className="h-full min-h-0 overflow-y-auto rounded-2xl border border-border bg-card p-8 shadow-xl shadow-black/10 dark:shadow-black/30">
								<div className="mx-auto max-w-3xl">
									<h1 className="text-lg font-semibold">{t("discover")}</h1>
									<p className="mt-1 text-xs text-muted-foreground">{t("discoverHint")}</p>
									<div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
										{gameSuggestions(t).map((entry) => {
											const Icon = entry.icon;
											return (
											<button
												key={entry.id}
												onClick={() => {
													client?.send("createProject", { prompt: entry.prompt });
													setView("workspace");
												}}
												className={cn(
													"group rounded-lg border border-border bg-gradient-to-br to-transparent p-4 text-start transition hover:border-ring",
													entry.tone,
												)}
											>
												<Icon className="size-4 text-muted-foreground" />
												<div className="mt-6 text-sm font-medium">{entry.title}</div>
												<div className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">{entry.prompt}</div>
											</button>
											);
										})}
									</div>
								</div>
								</div>
							</div>
						)}

						{view === "settings" && (
							<div className="h-full p-3">
								<div className="h-full min-h-0 overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-black/10 dark:shadow-black/30">
							<SettingsPage
								theme={theme}
								locale={locale}
								providers={providers}
								agent={agent}
								agents={agents}
								acpAgents={agents.filter((entry) => entry.kind === "acp")}
								acpModel={acpModel}
								onAcpModel={(value) => client?.send("setAcpConfig", { configId: "model", value })}
								intent={settingsIntent}
								onIntentHandled={clearSettingsIntent}
								onAcp={(id, patch) => client?.send("setAcp", { id, ...patch })}
								provider={model.split("/")[0] ?? ""}
								model={model.split("/").slice(1).join("/")}
								models={models}
								onTheme={(next) => {
									setTheme(next);
									client?.send("setTheme", { theme: next });
								}}
								onAgent={(next) => client?.send("setAgent", { agent: next })}
								onLocale={(next) => {
									setLocale(next);
									client?.send("setLocale", { locale: next });
								}}
								onLogin={(providerId) => {
									setLogin({ providerId, prompt: null, event: null, error: null, done: false });
									client?.send("beginLogin", { providerId });
								}}
								onLogout={(providerId) => {
									client?.send("logout", { providerId });
									setTimeout(() => void refreshProviders(), 800);
								}}
								onModel={(provider, next) => {
									client?.send("setModel", { provider, model: next });
								}}
							/>
								</div>
							</div>
						)}
						</div>
					</div>
				</div>

				<LoginDialog
					open={Boolean(login.providerId)}
					providerId={login.providerId}
					providerName={loginProvider?.name ?? login.providerId ?? ""}
					prompt={login.prompt}
					event={login.event}
					error={login.error}
					done={login.done}
					client={client}
					onClose={() => {
						client?.send("cancelLogin", {});
						setLogin({ providerId: null, prompt: null, event: null, error: null, done: false });
					}}
				/>
			</TooltipProvider>
		</I18nProvider>
	);
}

function Rail({
	view,
	setView,
	projects,
	activeId,
	onCreate,
	onSwitch,
}: {
	view: View;
	setView: (view: View) => void;
	projects: ProjectRef[];
	activeId: string;
	onCreate: () => void;
	onSwitch: (id: string) => void;
}) {
	const { t } = useI18n();
	return (
		<nav className="flex w-16 shrink-0 flex-col items-center gap-1 py-2">
			<button
				onClick={() => setView("workspace")}
				className="grid size-10 place-items-center rounded-xl"
				title="VibeGame"
				aria-label="VibeGame"
			>
				<VibeGameMark className="size-[38px]" />
			</button>

			<div className="mt-3 flex flex-col items-center gap-1">
				<RailButton icon={Compass} label={t("discover")} active={view === "discover"} onClick={() => setView("discover")} />
			</div>

			<div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto pt-3">
				{projects.map((project) => (
					<button
						key={project.id}
						onClick={() => onSwitch(project.id)}
						title={projectDisplayName(project, t)}
						className={cn(
							"grid size-10 place-items-center rounded-lg border text-xs font-medium",
							project.id === activeId
								? "border-ring bg-accent text-accent-foreground"
								: "border-transparent text-muted-foreground hover:bg-accent/50",
						)}
					>
						{project.iconSvg ? (
							<img
								src={`data:image/svg+xml;utf8,${encodeURIComponent(project.iconSvg)}`}
								alt=""
								className="size-7 rounded-md"
								draggable={false}
							/>
						) : (
							<Gamepad2 className="size-5 opacity-50" />
						)}
					</button>
				))}
				<button
					onClick={onCreate}
					title={t("newProject")}
					className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground"
				>
					<Plus className="size-5" />
				</button>
			</div>

			<RailButton icon={Settings2} label={t("settings")} active={view === "settings"} onClick={() => setView("settings")} />
		</nav>
	);
}

function RailButton({
	icon: Icon,
	label,
	active,
	onClick,
}: {
	icon: typeof Compass;
	label: string;
	active?: boolean;
	onClick: () => void;
}) {
	return (
		<button
			onClick={onClick}
			title={label}
			className={cn(
				"grid size-10 place-items-center rounded-lg",
				active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
			)}
		>
			<Icon className="size-5" />
		</button>
	);
}

function lastCellKey(map: Map<number, string>) {
	let latest = -1;
	let id: string | undefined;
	for (const [n, value] of map) {
		if (n > latest) {
			latest = n;
			id = value;
		}
	}
	return id;
}
