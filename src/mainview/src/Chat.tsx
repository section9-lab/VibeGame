import { useMemo, useRef, useState } from "react";
import { ArrowUp, Plus, Square } from "lucide-react";
import type { AgentInfo, ModelRef, Status } from "@/rpc";
import { cn } from "@/lib/utils";
import { gameSuggestions } from "@/lib/game-suggestions";
import { useI18n } from "@/i18n/I18nProvider";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Message, MessageContent, MessageGroup } from "@/components/ui/message";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from "@/components/ui/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Terminal, type TerminalState } from "@/components/ai-elements/terminal";
import { Reasoning } from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

export type ChatItem =
	| { key: string; kind: "user"; text: string }
	// reasoning 只在“刚刚流式下来、原地升级”的回合里存在；历史回放的行没有它。
	| { key: string; kind: "assistant"; text: string; reasoning?: string }
	| { key: string; kind: "notice"; text: string; tone: "info" | "error" }
	// 正在流式生成、还没有落盘的回合。App 会在 cell / assistant 事件到达时
	// 用同一个 key 把它原地升级成 cell / assistant 行，避免行增删导致滚动跳变。
	| { key: string; kind: "live"; reasoning: string; message: string; streaming: boolean }
	| {
			key: string;
			kind: "cell";
			n: number;
			summary: string;
			code: string;
			output: string;
			error: string | null;
			state: TerminalState;
			startedAt: number;
			endedAt?: number;
			reasoning?: string;
			message?: string;
	  };

type Props = {
	items: ChatItem[];
	status: Status;
	nowMs: number;
	agent: string;
	agents: AgentInfo[];
	model: string;
	models: ModelRef[];
	onSend: (text: string) => void;
	onStop: () => void;
	onAgent: (id: string) => void;
	onModel: (value: string) => void;
	/** 当前 ACP Agent 提供的模型列表（为空时显示加载中） */
	acpModel: { current: string; values: { value: string; name: string }[] } | null;
	onAcpModel: (value: string) => void;
	/** 打开设置页的“本机 ACP Agent”区域 */
	onAddAcpAgent: () => void;
};

// Select 的值必须是字符串；用保留值把“添加 Agent”当成一个菜单项。
const ADD_ACP = "__add-acp-agent__";

// 输入区里的两个下拉只当文字菜单用：去掉边框和底色，和附件/发送圆按钮同一套视觉。
const MENU_TRIGGER =
	"max-w-[40%] border-0 bg-transparent text-xs shadow-none hover:bg-background dark:bg-transparent dark:hover:bg-background/10";

// 结构对齐 shadcn AI Elements 的 Chat：线程 = Message Scroller + Message + Bubble，输入区 = Input Group。
export function Chat({
	items,
	status,
	nowMs,
	agent,
	agents,
	model,
	models,
	onSend,
	onStop,
	onAgent,
	onModel,
	acpModel,
	onAcpModel,
	onAddAcpAgent,
}: Props) {
	const { t } = useI18n();
	const [draft, setDraft] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	// 输入法（拼音/日文等）正在选词时，回车只是确认候选，不能当成发送。
	const composingRef = useRef(false);

	const grouped = useMemo(() => {
		const map = new Map<string, ModelRef[]>();
		for (const entry of models) {
			const list = map.get(entry.provider) ?? [];
			list.push(entry);
			map.set(entry.provider, list);
		}
		return [...map];
	}, [models]);

	const agentInfo = agents.find((entry) => entry.id === agent);
	const agentName = agentInfo?.name ?? agent;
	const acpAgent = agentInfo?.kind === "acp";
	const working = status === "working";
	const empty = items.length === 0;

	return (
		// 隐式 grid 轨道是 auto，会被建议按钮一行的 min-content 撑宽，导致窄分栏时输入框被裁掉。
		// 显式 minmax(0,1fr) 让轨道可以收缩，超出的按钮改为横向滚动。
		<section className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] grid-rows-[1fr_auto] overflow-hidden bg-card">
			<MessageScrollerProvider autoScroll>
				<MessageScroller>
					<MessageScrollerViewport>
						<MessageScrollerContent className="gap-4 p-4">
							{items.map((item) => {
								if (item.kind === "user") {
									return (
										<MessageScrollerItem key={item.key} messageId={item.key} scrollAnchor>
											<Message align="end">
												<MessageContent>
													<Bubble align="end" variant="muted">
														<BubbleContent>{item.text}</BubbleContent>
													</Bubble>
												</MessageContent>
											</Message>
										</MessageScrollerItem>
									);
								}
								if (item.kind === "assistant") {
									return (
										<MessageScrollerItem key={item.key} messageId={item.key}>
											<MessageGroup>
												{item.reasoning ? <Reasoning key="reasoning" text={item.reasoning} /> : null}
												<Message key="message">
													<MessageContent>
														<Bubble variant="muted">
															<BubbleContent className="whitespace-pre-wrap text-sm leading-relaxed">
																{item.text}
															</BubbleContent>
														</Bubble>
													</MessageContent>
												</Message>
											</MessageGroup>
										</MessageScrollerItem>
									);
								}
								if (item.kind === "notice") {
									return (
										<MessageScrollerItem key={item.key} messageId={item.key}>
											<Message>
												<MessageContent>
													<Bubble variant={item.tone === "error" ? "destructive" : "outline"}>
														<BubbleContent className="whitespace-pre-wrap text-xs">{item.text}</BubbleContent>
													</Bubble>
												</MessageContent>
											</Message>
										</MessageScrollerItem>
									);
								}
								return (
									<MessageScrollerItem key={item.key} messageId={item.key}>
										<MessageGroup>
											{item.reasoning ? (
												<Reasoning key="reasoning" text={item.reasoning} streaming={item.kind === "live" && item.streaming} />
											) : null}
											{item.message ? (
												<Message key="message">
													<MessageContent>
														<p className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</p>
													</MessageContent>
												</Message>
											) : null}
											{/* 流式阶段不画“终端预览”：工具调用参数不是最终命令，cell 落盘时再一次性替换会闪。 */}
											{item.kind === "cell" ? (
												<Terminal
													key="terminal"
													title={cellLabel(item.summary, item.code, t("cellFallback"))}
													code={item.code}
													output={item.output}
													error={item.error}
													state={item.state}
													durationMs={item.state === "waiting" ? 0 : (item.endedAt ?? nowMs) - item.startedAt}
												/>
											) : null}
										</MessageGroup>
									</MessageScrollerItem>
								);
							})}

							{/* 空态不能放进 Content：它会被滚动容器当成一条消息行，
							   历史回放时行数对不上，导致回放后停在半路而不是底部。 */}
						</MessageScrollerContent>
					</MessageScrollerViewport>
					{empty && (
						<div className="pointer-events-none absolute inset-x-0 top-10 flex justify-center">
							<p className="text-xs text-muted-foreground">{t("chatEmpty")}</p>
						</div>
					)}
					<MessageScrollerButton />
				</MessageScroller>
			</MessageScrollerProvider>

			<div className="p-3">
				{empty && (
					<Suggestions className="mb-2" role="group" aria-label={t("chatEmptyTitle")}>
						{gameSuggestions(t).map((entry) => {
							const Icon = entry.icon;
							return (
								<Suggestion
									key={entry.id}
									suggestion={entry.prompt}
									onClick={onSend}
									className="gap-1.5"
								>
									<Icon className="size-3.5 text-muted-foreground" />
									{entry.title}
								</Suggestion>
							);
						})}
					</Suggestions>
				)}
				<form
					onSubmit={(event) => {
						event.preventDefault();
						// 工作中只能先停止，避免输入区和按钮状态对不上。
						if (working || composingRef.current) return;
						const text = draft.trim();
						if (!text) return;
						setDraft("");
						onSend(text);
					}}
				>
					<InputGroup className="rounded-2xl bg-card has-disabled:bg-card has-disabled:opacity-100 dark:bg-input/20 dark:has-disabled:bg-input/20">
						<InputGroupTextarea
							ref={textareaRef}
							value={draft}
							onChange={(event) => setDraft(event.target.value)}
							onCompositionStart={() => {
								composingRef.current = true;
							}}
							onCompositionEnd={() => {
								composingRef.current = false;
							}}
							onKeyDown={(event) => {
								// 选词状态下按 Enter 只确认候选词；keyCode 229 是旧 WebKit 的兜底信号。
								if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
								if (event.key === "Enter" && !event.shiftKey) {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit();
								}
							}}
							placeholder={working ? t("chatPlaceholderBusy") : t("chatPlaceholderIdle")}
							className="p-3"
						/>
						<InputGroupAddon align="block-end">
							<InputGroupButton
								type="button"
								size="icon-sm"
								variant="outline"
								className="rounded-full"
								title={t("attachmentTooltip")}
								aria-label={t("attachmentTooltip")}
							>
								<Plus className="size-4" />
							</InputGroupButton>
							<Select
								value={agent}
								onValueChange={(value) => {
									if (value === ADD_ACP) onAddAcpAgent();
									else onAgent(value);
								}}
							>
								<SelectTrigger
									size="sm"
									className={cn(MENU_TRIGGER, "ms-auto")}
									title={t("currentAgentTooltip", { name: agentName })}
									aria-label={t("switchAgent")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper" side="top" sideOffset={6} align="end">
									{agents.map((entry) => (
										<SelectItem key={entry.id} value={entry.id}>
											{entry.name}
										</SelectItem>
									))}
									<SelectSeparator />
									<SelectItem value={ADD_ACP}>
										<Plus className="size-3.5 text-muted-foreground" />
										{t("acpAdd")}
									</SelectItem>
								</SelectContent>
							</Select>
							{acpAgent ? (
								<Select
									value={acpModel?.current ?? ""}
									onValueChange={onAcpModel}
									disabled={!acpModel || acpModel.values.length === 0}
								>
									<SelectTrigger
										size="sm"
										className={MENU_TRIGGER}
										aria-label={t("modelPlaceholder")}
										title={t("acpModelHint")}
									>
										<SelectValue placeholder={t("loading")} />
									</SelectTrigger>
									<SelectContent position="popper" side="top" sideOffset={6} align="end">
										{(acpModel?.values ?? []).map((entry) => (
											<SelectItem key={entry.value} value={entry.value}>
												{entry.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<Select value={model} onValueChange={onModel}>
									<SelectTrigger size="sm" className={MENU_TRIGGER} aria-label={t("modelPlaceholder")}>
										<SelectValue placeholder={t("modelPlaceholder")} />
									</SelectTrigger>
									<SelectContent position="popper" side="top" sideOffset={6} align="end">
										{grouped.map(([provider, list]) => (
											<SelectGroup key={provider}>
												<SelectLabel>{provider}</SelectLabel>
												{list.map((entry) => (
													<SelectItem key={`${entry.provider}/${entry.id}`} value={`${entry.provider}/${entry.id}`}>
														{entry.name}
													</SelectItem>
												))}
											</SelectGroup>
										))}
									</SelectContent>
								</Select>
							)}
							{working ? (
								<InputGroupButton
									size="icon-sm"
									variant="outline"
									className="size-9 rounded-full"
									onClick={onStop}
									aria-label={t("stop")}
									title={t("stop")}
								>
									<Square className="size-3.5" />
								</InputGroupButton>
							) : (
								<InputGroupButton
									type="submit"
									size="icon-sm"
									variant="brand"
									className="size-9 rounded-full"
									disabled={status === "dead"}
									onClick={(event) => {
										// 没内容时点发送：只把焦点交给输入框，不提交。
										if (!draft.trim()) {
											event.preventDefault();
											textareaRef.current?.focus();
										}
									}}
									aria-label={t("send")}
								>
									<ArrowUp className="size-4" />
								</InputGroupButton>
							)}
						</InputGroupAddon>
					</InputGroup>
				</form>
			</div>
		</section>
	);
}

function cellLabel(summary: string, code: string, fallback: string) {
	return summary.trim() || code.trim().split("\n").find((line) => line.trim()) || fallback;
}
