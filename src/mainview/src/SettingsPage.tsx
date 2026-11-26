import { useEffect, useState, type KeyboardEvent } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { AgentInfo, ModelRef, ProviderInfo } from "@/rpc";
import { LOCALES, localeInfo, normalizeLocale, type Locale, type MessageKey } from "@/i18n";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
	theme: "dark" | "light";
	locale: Locale;
	providers: ProviderInfo[];
	agent: string;
	agents: AgentInfo[];
	acpAgents: AgentInfo[];
	acpModel: { current: string; values: { value: string; name: string }[] } | null;
	onAcpModel: (value: string) => void;
	intent: { nonce: number; tab: "agent" | "providers"; anchor?: string } | null;
	onIntentHandled: () => void;
	provider: string;
	model: string;
	models: ModelRef[];
	onTheme: (theme: "dark" | "light") => void;
	onLocale: (locale: Locale) => void;
	onAgent: (agent: string) => void;
	onAcp: (id: string, patch: { enabled?: boolean; command?: string }) => void;
	onLogin: (providerId: string) => void;
	onLogout: (providerId: string) => void;
	onModel: (provider: string, model: string) => void;
};

const SECTIONS = [
	{ id: "general", labelKey: "settingsSectionGeneral" },
	{ id: "agents", labelKey: "settingsSectionAgentsProviders" },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

const AGENT_TABS = [
	{ id: "providers", labelKey: "settingsTabProviders" },
	{ id: "agent", labelKey: "settingsTabAgent" },
] as const satisfies readonly { id: string; labelKey: MessageKey }[];

const THEMES = [
	{ value: "light", labelKey: "themeLight", hintKey: "themeLightHint", icon: Sun },
	{ value: "dark", labelKey: "themeDark", hintKey: "themeDarkHint", icon: Moon },
] as const satisfies readonly { value: "light" | "dark"; labelKey: MessageKey; hintKey: MessageKey; icon: typeof Sun }[];

export function SettingsPage({
	theme,
	locale,
	providers,
	agent,
	agents,
	acpAgents,
	acpModel,
	onAcpModel,
	intent,
	onIntentHandled,
	provider,
	model,
	models,
	onTheme,
	onLocale,
	onAgent,
	onAcp,
	onLogin,
	onLogout,
	onModel,
}: Props) {
	const { t } = useI18n();
	const [section, setSection] = useState<(typeof SECTIONS)[number]["id"]>("general");
	const [agentTab, setAgentTab] = useState<(typeof AGENT_TABS)[number]["id"]>("providers");

	const subscriptions = providers.filter((p) => p.subscription);
	const apiKeys = providers.filter((p) => !p.subscription);
	// 只有启用过的 ACP Agent 才会进入 Agent 选择器。
	const selectableAgents = agents.filter((entry) => entry.kind === "builtin" || entry.enabled);
	const acpSelected = agents.find((entry) => entry.id === agent)?.kind === "acp";

	// 从聊天里的“添加 ACP Agent”跳过来时，直接展开并聚焦对应区域。
	useEffect(() => {
		if (!intent) return;
		setSection("agents");
		setAgentTab(intent.tab);
		if (!intent.anchor) {
			onIntentHandled();
			return;
		}
		// 先等切换 tab 的那一帧渲染完，否则目标面板还在 hidden 状态，滚动和聚焦都会失效。
		let inner = 0;
		const outer = requestAnimationFrame(() => {
			inner = requestAnimationFrame(() => {
				const node = document.getElementById(intent.anchor!);
				node?.scrollIntoView({ block: "center" });
				node?.focus({ preventScroll: true });
				// 滚完再清空，避免父组件重渲染导致这里被取消。
				onIntentHandled();
			});
		});
		return () => {
			cancelAnimationFrame(outer);
			cancelAnimationFrame(inner);
		};
	}, [intent, onIntentHandled]);

	// Vertical roving focus for the sub-tabs: Up/Down cycle, Home/End jump.
	const onAgentTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
		event.preventDefault();
		const index = AGENT_TABS.findIndex((entry) => entry.id === agentTab);
		const nextIndex =
			event.key === "Home"
				? 0
				: event.key === "End"
					? AGENT_TABS.length - 1
					: event.key === "ArrowDown"
						? (index + 1) % AGENT_TABS.length
						: (index - 1 + AGENT_TABS.length) % AGENT_TABS.length;
		const next = AGENT_TABS[nextIndex]!;
		setAgentTab(next.id);
		document.getElementById(`settings-agents-tab-${next.id}`)?.focus();
	};

	return (
		<div className="grid h-full min-h-0 grid-cols-[200px_1fr]">
			<nav className="border-e border-border/70 bg-secondary/20 p-2">
				{SECTIONS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						onClick={() => setSection(entry.id)}
						aria-current={section === entry.id ? "true" : undefined}
						className={cn(
							"w-full rounded-md px-3 py-1.5 text-start text-sm",
							section === entry.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/50",
						)}
					>
						{t(entry.labelKey)}
					</button>
				))}
			</nav>

			<div className="min-h-0 overflow-y-auto p-8">
				<div className="mx-auto max-w-2xl">
					{section === "general" ? (
						<>
							<h2 className="text-base font-semibold">{t("generalTitle")}</h2>

							<section className="mt-6">
								<h3 className="text-sm font-medium">{t("appearanceTitle")}</h3>
								<p className="mt-1 text-xs text-muted-foreground">{t("appearanceHint")}</p>

								<div role="radiogroup" aria-label={t("themeGroup")} className="mt-4 grid gap-3 sm:grid-cols-2">
									{THEMES.map(({ value, labelKey, hintKey, icon: Icon }) => {
										const checked = theme === value;
										return (
											<label
												key={value}
												className={cn(
													"group relative flex cursor-pointer flex-col gap-3 rounded-xl border p-3 transition",
													"focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
													checked
														? "border-primary bg-primary/5 ring-1 ring-primary"
														: "border-border hover:border-ring/60 hover:bg-accent/30",
												)}
											>
												<input
													type="radio"
													name="theme"
													value={value}
													checked={checked}
													onChange={() => onTheme(value)}
													className="sr-only"
												/>
												<ThemePreview tone={value} />
												<div className="flex items-center gap-2">
													<Icon className="size-3.5 text-muted-foreground" aria-hidden />
													<div className="min-w-0 flex-1">
														<div className="text-sm font-medium">{t(labelKey)}</div>
														<div className="text-[11px] text-muted-foreground">{t(hintKey)}</div>
													</div>
													<span
														className={cn(
															"grid size-4 shrink-0 place-items-center rounded-full border",
															checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
														)}
													>
														{checked && <Check className="size-3" />}
													</span>
												</div>
											</label>
										);
									})}
								</div>

								<p className="mt-3 text-[11px] text-muted-foreground">{t("appearanceKeyboardHint")}</p>
							</section>

							<section className="mt-8">
								<h3 className="text-sm font-medium">{t("languageTitle")}</h3>
								<p className="mt-1 text-xs text-muted-foreground">{t("languageHint")}</p>

								<div className="mt-4 rounded-lg border border-border p-4">
									<select
										value={locale}
										onChange={(event) => {
											const next = normalizeLocale(event.target.value);
											if (next) onLocale(next);
										}}
										aria-label={t("languageSelectLabel")}
										className="h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs"
									>
										{LOCALES.map((entry) => (
											<option key={entry.id} value={entry.id}>
												{entry.label}
											</option>
										))}
									</select>
									<p className="mt-2 text-[11px] text-muted-foreground" lang={localeInfo(locale).tag}>
										{localeInfo(locale).label} · {localeInfo(locale).tag}
									</p>
								</div>
							</section>
						</>
					) : (
						<>
							<h2 className="text-base font-semibold">{t("settingsSectionAgentsProviders")}</h2>

							<div className="mt-6 grid gap-6 sm:grid-cols-[148px_1fr]">
								<div
									role="tablist"
									aria-orientation="vertical"
									aria-label={t("settingsSubnavLabel")}
									onKeyDown={onAgentTabKeyDown}
									className="flex flex-col gap-1"
								>
									{AGENT_TABS.map((entry) => {
										const active = agentTab === entry.id;
										return (
											<button
												key={entry.id}
												id={`settings-agents-tab-${entry.id}`}
												type="button"
												role="tab"
												aria-selected={active}
												aria-controls={`settings-agents-panel-${entry.id}`}
												tabIndex={active ? 0 : -1}
												onClick={() => setAgentTab(entry.id)}
												className={cn(
													"rounded-md px-3 py-1.5 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
													active
														? "bg-accent text-accent-foreground"
														: "text-muted-foreground hover:bg-accent/50",
												)}
											>
												{t(entry.labelKey)}
											</button>
										);
									})}
								</div>

								<div
									role="tabpanel"
									id="settings-agents-panel-providers"
									aria-labelledby="settings-agents-tab-providers"
									hidden={agentTab !== "providers"}
									tabIndex={0}
									className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<p className="text-xs text-muted-foreground">{t("agentsHint")}</p>

									<ProviderGroup
										title={t("providersSubscriptions")}
										hint={t("providersSubscriptionsHint")}
										providers={subscriptions}
										onLogin={onLogin}
										onLogout={onLogout}
									/>
									<ProviderGroup
										title={t("providersApiKeys")}
										hint={t("providersApiKeysHint")}
										providers={apiKeys}
										onLogin={onLogin}
										onLogout={onLogout}
									/>
								</div>

								<div
									role="tabpanel"
									id="settings-agents-panel-agent"
									aria-labelledby="settings-agents-tab-agent"
									hidden={agentTab !== "agent"}
									tabIndex={0}
									className="min-w-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<p className="text-xs text-muted-foreground">{t("generalHint")}</p>

									<div className="mt-4 rounded-lg border border-border p-4">
										<div className="text-sm font-medium">{t("agentLabel")}</div>
										<select
											value={agent}
											onChange={(event) => onAgent(event.target.value)}
											aria-label={t("agentLabel")}
											className="mt-2 h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs"
										>
											{selectableAgents.map((entry) => (
												<option key={entry.id} value={entry.id}>
													{entry.name}
												</option>
											))}
										</select>
										{agent === "mini-swe-agent" && (
											<p className="mt-2 text-[11px] text-muted-foreground">{t("miniSweHint")}</p>
										)}
									</div>

									<div
										id="settings-acp-agents"
										tabIndex={-1}
										className="mt-4 scroll-mt-6 rounded-lg border border-border p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<div className="flex items-baseline justify-between gap-2">
											<div className="text-sm font-medium">{t("acpTitle")}</div>
											<span className="text-[11px] text-muted-foreground">
												{acpAgents.filter((entry) => entry.enabled).length}/{acpAgents.length}
											</span>
										</div>
										<p className="mt-1 text-[11px] text-muted-foreground">{t("acpHint")}</p>

										<div className="mt-3 flex flex-col gap-2">
											{acpAgents.map((entry) => (
												<div
													key={entry.id}
													className={cn(
														"rounded-md border p-3",
														entry.enabled ? "border-primary/50 bg-primary/5" : "border-border",
													)}
												>
													<div className="flex items-start gap-3">
														<span
															aria-hidden
															className={cn(
																"mt-1.5 size-2 shrink-0 rounded-full",
																entry.available ? "bg-emerald-400" : "bg-muted-foreground/40",
															)}
														/>
														<div className="min-w-0 flex-1">
															<div id={`acp-name-${entry.id}`} className="text-sm">
																{entry.name}
															</div>
															<div className="text-[11px] text-muted-foreground">{entry.description}</div>
															<div className="mt-1 text-[11px] text-muted-foreground">
																{entry.launcher === "auto"
																	? t("acpAutoLauncher")
																	: entry.available
																		? t("acpInstalled")
																		: t("acpNotInstalled")}
															</div>
														</div>
														<Switch
															checked={entry.enabled}
															onCheckedChange={(enabled) => onAcp(entry.id, { enabled })}
															aria-labelledby={`acp-name-${entry.id}`}
														/>
													</div>

													{entry.enabled && (
														<div className="mt-3 grid gap-1.5">
															<label
																htmlFor={`acp-command-${entry.id}`}
																className="text-[11px] font-medium"
															>
																{t("acpCommand")}
															</label>
															<input
																id={`acp-command-${entry.id}`}
																key={`${entry.id}:${entry.command}`}
																defaultValue={entry.command}
																placeholder={entry.defaultCommand ?? ""}
																spellCheck={false}
																autoComplete="off"
																className="h-8 w-full rounded-md border border-border bg-secondary px-2 font-mono text-xs"
																onKeyDown={(event) => {
																	if (event.key === "Enter") event.currentTarget.blur();
																}}
																onBlur={(event) => {
																	const value = event.currentTarget.value.trim();
																	if (value !== entry.command) onAcp(entry.id, { command: value });
																}}
															/>
															<p className="text-[11px] text-muted-foreground">{t("acpCommandHint")}</p>
															{entry.launcher === "missing" && (
																<p className="text-[11px] text-muted-foreground">
																	{t("acpInstall", { command: entry.installCommand ?? "" })}
																</p>
															)}
														</div>
													)}
												</div>
											))}
										</div>
									</div>

									<div className="mt-4 rounded-lg border border-border p-4">
										<div className="text-sm font-medium">{t("defaultModel")}</div>
										{acpSelected ? (
											<select
												value={acpModel?.current ?? ""}
												disabled={!acpModel || acpModel.values.length === 0}
												onChange={(e) => onAcpModel(e.target.value)}
												className="mt-2 h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs disabled:opacity-50"
											>
												{(!acpModel || acpModel.values.length === 0) && (
													<option value="">{t("loading")}</option>
												)}
												{acpModel?.values.map((entry) => (
													<option key={entry.value} value={entry.value}>
														{entry.name}
													</option>
												))}
											</select>
										) : (
											<select
												value={`${provider}/${model}`}
												onChange={(e) => {
													const [nextProvider, ...rest] = e.target.value.split("/");
													onModel(nextProvider!, rest.join("/"));
												}}
												className="mt-2 h-8 w-full rounded-md border border-border bg-secondary px-2 text-xs"
											>
												{models.map((entry) => (
													<option key={`${entry.provider}/${entry.id}`} value={`${entry.provider}/${entry.id}`}>
														{entry.provider} / {entry.name}
													</option>
												))}
											</select>
										)}
										{acpSelected && (
											<p className="mt-2 text-[11px] text-muted-foreground">{t("acpModelHint")}</p>
										)}
									</div>
								</div>
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function ThemePreview({ tone }: { tone: "light" | "dark" }) {
	const light = tone === "light";
	return (
		<div
			aria-hidden
			className={cn(
				"flex h-24 overflow-hidden rounded-lg border",
				light ? "border-neutral-200 bg-white" : "border-white/10 bg-neutral-900",
			)}
		>
			<div className={cn("flex w-9 flex-col gap-1.5 p-2", light ? "bg-neutral-100" : "bg-neutral-800")}>
				<span className={cn("size-4 rounded-md", light ? "bg-neutral-300" : "bg-neutral-600")} />
				<span className={cn("h-1 w-full rounded-full", light ? "bg-neutral-200" : "bg-neutral-700")} />
				<span className={cn("h-1 w-3/4 rounded-full", light ? "bg-neutral-200" : "bg-neutral-700")} />
				<span className={cn("h-1 w-4/5 rounded-full", light ? "bg-neutral-200" : "bg-neutral-700")} />
			</div>
			<div className="flex flex-1 flex-col gap-1.5 p-2">
				<span className={cn("h-1.5 w-2/3 rounded-full", light ? "bg-neutral-300" : "bg-neutral-600")} />
				<span className={cn("h-1 w-full rounded-full", light ? "bg-neutral-200" : "bg-neutral-700")} />
				<span className={cn("h-1 w-5/6 rounded-full", light ? "bg-neutral-200" : "bg-neutral-700")} />
				<div
					className={cn(
						"mt-auto h-8 rounded-md border",
						light ? "border-neutral-200 bg-neutral-50" : "border-neutral-700 bg-neutral-800",
					)}
				/>
			</div>
		</div>
	);
}

function ProviderGroup({
	title,
	hint,
	providers,
	onLogin,
	onLogout,
}: {
	title: string;
	hint: string;
	providers: ProviderInfo[];
	onLogin: (id: string) => void;
	onLogout: (id: string) => void;
}) {
	const { t } = useI18n();
	if (!providers.length) return null;
	return (
		<section className="mt-6">
			<div className="flex items-baseline justify-between">
				<h3 className="text-sm font-medium">{title}</h3>
				<span className="text-[11px] text-muted-foreground">{hint}</span>
			</div>
			<div className="mt-2 overflow-hidden rounded-lg border border-border">
				{providers.map((entry, index) => (
					<div key={entry.id} className={cn("flex items-center gap-3 p-3", index > 0 && "border-t border-border")}>
						<span
							className={cn("size-2 rounded-full", entry.configured ? "bg-emerald-400" : "bg-muted-foreground/40")}
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">{entry.name}</div>
							<div className="text-[11px] text-muted-foreground">
								{entry.subscription ? t("providerSubscriptionKind") : t("providerApiKeyKind")} ·{" "}
								{entry.configured ? t("providerLoggedIn") : t("providerLoggedOut")}
								{!entry.configured && !entry.canLogin ? ` · ${t("providerNoInteractive")}` : ""}
							</div>
						</div>
						{entry.configured ? (
							<Button variant="ghost" size="sm" onClick={() => onLogout(entry.id)}>
								{t("providerLogout")}
							</Button>
						) : entry.canLogin ? (
							<Button variant="secondary" size="sm" onClick={() => onLogin(entry.id)}>
								{t("providerLogin")}
							</Button>
						) : (
							<span className="px-2 text-[11px] text-muted-foreground">{t("providerUseEnv")}</span>
						)}
					</div>
				))}
			</div>
		</section>
	);
}
