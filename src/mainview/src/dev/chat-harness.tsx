// 滚动回归脚手架：用真实的 Chat 组件跑脚本化的流式事件，逐帧记录 scrollTop。
// 只用于本地验证，入口是 /harness.html，不会打进正式视图。
//
// 这里的事件处理刻意复刻 App.tsx：delta 累积到尾部 live 行，cell / assistant 落盘时
// 复用 live 行的 key 原地升级。两边共用 lib/chat-items.ts 的 helper。
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "../index.css";
import { Chat, type ChatItem } from "../Chat";
import { appendLiveDelta, dropLive } from "../lib/chat-items";
import { I18nProvider } from "../i18n/I18nProvider";

type Status = "starting" | "waiting" | "working" | "dead";

const LONG = "这是一段用于撑开高度的历史回复，包含步骤说明、命令解释和结果总结。".repeat(6);
const CHUNKS = [
	"我先看一下项目结构，确认入口文件在哪里。",
	"游戏的渲染循环在 src/main.ts 里，",
	"状态更新集中在 src/engine.ts。",
	"接下来我会读取 src/game.ts，",
	"确认玩家、障碍物和分数是怎么组织的。",
	"如果结构清晰，我就直接在这个文件里加一条新的垂直障碍。",
];
const CODE = `const box = new THREE.Mesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee })
);
scene.add(box);`;

let seq = 0;
const key = (prefix: string) => `${prefix}-${seq++}`;

// 历史里放多条 user / assistant / cell，模拟“已经聊过很久”的会话。
// 关键：历史行的 scrollAnchor 从来没被滚动容器标记为 handled，
// 这是复现“行数不变时跳到老消息”的前提。
function seedHistory(turns = 4): ChatItem[] {
	const out: ChatItem[] = [];
	for (let turn = 1; turn <= turns; turn += 1) {
		out.push({ key: key("seed-u"), kind: "user", text: `第 ${turn} 轮：把障碍物加高一点，并调整速度。` });
		out.push({ key: key("seed-a"), kind: "assistant", text: `${LONG}（第 ${turn} 轮总结）` });
		out.push({
			key: key("seed-c"),
			kind: "cell",
			n: turn,
			summary: "写入 src/game.ts",
			code: CODE,
			output: "wrote 412 bytes\nbuild ok",
			error: null,
			state: "done",
			startedAt: 0,
			endedAt: 1200,
			reasoning: "先确认障碍物参数，再改速度和间距。".repeat(8),
			message: "",
		});
	}
	return out;
}

type Frame = {
	t: number;
	top: number;
	height: number;
	client: number;
	rows: number;
	/** 最后一行的 messageId / 是否存在思考卡，用来发现“思考卡被删了又建”。 */
	lastId: string | null;
	lastHasReasoning: boolean;
	lastExpanded: boolean | null;
	lastLabel: string | null;
	/** 被观察的可见行距离视口顶部的距离，用来判断“用户看到的内容”有没有跳动。 */
	watchedTop: number | null;
};

type Mark = Frame & { label: string; index: number };

const frames: Frame[] = [];
const marks: Mark[] = [];
let raf = 0;
let recording = false;
let watchId: string | null = null;

function viewport() {
	return document.querySelector('[data-slot="message-scroller-viewport"]') as HTMLElement | null;
}

function snapshot(): Frame {
	const el = viewport();
	const content = el?.firstElementChild;
	const watched = watchId
		? (document.querySelector(`[data-message-id="${watchId}"]`) as HTMLElement | null)
		: null;
	const rows = content
		? [...content.children].filter((child) => !child.hasAttribute("data-message-scroller-spacer"))
		: [];
	const last = rows[rows.length - 1] as HTMLElement | undefined;
	const trigger = last?.querySelector("[data-slot=collapsible] button");
	return {
		t: performance.now(),
		top: el?.scrollTop ?? 0,
		height: el?.scrollHeight ?? 0,
		client: el?.clientHeight ?? 0,
		rows: rows.length,
		lastId: last?.getAttribute("data-message-id") ?? null,
		lastHasReasoning: Boolean(last?.querySelector("svg.lucide-brain, svg[class*='brain']")),
		lastExpanded: trigger ? trigger.getAttribute("aria-expanded") === "true" : null,
		lastLabel: trigger ? (trigger.textContent ?? "").trim() : null,
		watchedTop: watched ? watched.getBoundingClientRect().top : null,
	};
}

function tick() {
	if (!recording) return;
	frames.push(snapshot());
	raf = requestAnimationFrame(tick);
}

function startRecording() {
	frames.length = 0;
	marks.length = 0;
	phases.length = 0;
	watchId = null;
	setPhase("start");
	recording = true;
	cancelAnimationFrame(raf);
	raf = requestAnimationFrame(tick);
}

function stopRecording() {
	recording = false;
	cancelAnimationFrame(raf);
}

function waitFrame() {
	return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitFrames(count: number) {
	for (let i = 0; i < count; i += 1) await waitFrame();
}

function wait(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

type Phase = { t: number; label: string };
const phases: Phase[] = [];

/** 每个动作/标记都把当前标签记到时间线上，用于把回跳归因到具体阶段。 */
function setPhase(label: string) {
	phases.push({ t: performance.now(), label });
}

function phaseAt(t: number) {
	let label = phases[0]?.label ?? "init";
	for (const entry of phases) {
		if (entry.t > t) break;
		label = entry.label;
	}
	return label;
}

async function mark(label: string) {
	await waitFrames(3);
	setPhase(`mark:${label}`);
	marks.push({ ...snapshot(), label, index: frames.length });
}

function summarize() {
	const t0 = frames[0]?.t ?? performance.now();
	const backJumps: { at: number; drop: number; heightDelta: number; rows: number; phase: string }[] = [];
	const forwardJumps: { at: number; grow: number }[] = [];
	for (let i = 1; i < frames.length; i += 1) {
		const delta = frames[i].top - frames[i - 1].top;
		if (delta < -12) {
			backJumps.push({
				at: Math.round(frames[i].t - t0),
				drop: Math.round(-delta),
				heightDelta: frames[i].height - frames[i - 1].height,
				rows: frames[i].rows,
				phase: phaseAt(frames[i].t),
			});
		}
		if (delta > 12) forwardJumps.push({ at: Math.round(frames[i].t - t0), grow: Math.round(delta) });
	}
	const deltas = marks.slice(1).map((entry, i) => ({
		label: entry.label,
		at: Math.round(entry.t - t0),
		top: Math.round(entry.top),
		height: entry.height,
		client: entry.client,
		rows: entry.rows,
		lastLabel: entry.lastLabel,
		lastExpanded: entry.lastExpanded,
		deltaTop: Math.round(entry.top - marks[i].top),
	}));
	const watchedTops = frames.map((frame) => frame.watchedTop).filter((value): value is number => value !== null);
	const liveIds = [...new Set(frames.map((frame) => frame.lastId).filter(Boolean))];
	const rowDrops = frames.filter((frame, i) => i > 0 && frame.rows < frames[i - 1].rows).length;
	return {
		marks: deltas,
		liveIdChanges: liveIds.length,
		rowDrops,
		watched: watchId,
		watchedShift: watchedTops.length ? Math.round(Math.max(...watchedTops) - Math.min(...watchedTops)) : null,
		maxBackJump: Math.round(Math.max(0, ...backJumps.map((entry) => entry.drop))),
		backJumps: backJumps.length,
		maxForwardJump: Math.round(Math.max(0, ...forwardJumps.map((entry) => entry.grow))),
		forwardJumps: forwardJumps.length,
		firstBackJumps: backJumps.slice(0, 6),
		topRange: [
			Math.round(Math.min(...frames.map((f) => f.top))),
			Math.round(Math.max(...frames.map((f) => f.top))),
		] as [number, number],
	};
}

const noop = () => {};

type HarnessApi = {
	user: (text: string) => void;
	reasoningDelta: (text: string) => void;
	assistantDelta: (text: string) => void;
	cell: (n: number, summary: string, code: string, reasoning?: string) => void;
	out: (text: string) => void;
	result: (error: string | null) => void;
	assistant: (text: string) => void;
	streamReset: () => void;
	reset: () => Promise<void>;
	reloadHistory: (turns: number) => Promise<void>;
	status: (value: Status) => void;
	prepareLive: () => Promise<void>;
	prepareCell: () => Promise<void>;
	runAll: () => Promise<{ scenario: string; summary: ReturnType<typeof summarize> }[]>;
};

function Harness() {
	const [runId, setRunId] = useState(0);
	const [items, setItems] = useState<ChatItem[]>(() => seedHistory());
	const [status, setStatus] = useState<Status>("waiting");
	const [now, setNow] = useState(Date.now());
	const liveKeyRef = useRef<string | null>(null);

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		const api: HarnessApi = {
			user(text) {
				setPhase("user");
				const hadLive = liveKeyRef.current !== null;
				liveKeyRef.current = null;
				if (hadLive) flushSync(() => setItems(dropLive));
				setItems((prev) => [...prev, { key: key("u"), kind: "user", text }]);
			},
			reasoningDelta(text) {
				setPhase("delta:reasoning");
				liveKeyRef.current ??= key("l");
				setItems((prev) => appendLiveDelta(prev, liveKeyRef.current!, "reasoning", text));
			},
			assistantDelta(text) {
				setPhase("delta:reply");
				liveKeyRef.current ??= key("l");
				setItems((prev) => appendLiveDelta(prev, liveKeyRef.current!, "message", text));
			},
			cell(n, summary, cellCode, reasoningOverride) {
				setPhase(`cell:${n}`);
				const id = liveKeyRef.current ?? key("c");
				liveKeyRef.current = null;
				setItems((prev) => {
					const last = prev[prev.length - 1];
					const live = last?.kind === "live" ? last : null;
					const row: ChatItem = {
						key: id,
						kind: "cell",
						n,
						summary,
						code: cellCode,
						output: "",
						error: null,
						state: "running",
						startedAt: Date.now(),
						// 和主进程一致：cell 事件会带上已经流式出来的思考与说明文字。
						reasoning: reasoningOverride ?? live?.reasoning ?? "",
						message: live?.message ?? "",
					};
					return live ? [...prev.slice(0, -1), row] : [...prev, row];
				});
			},
			out(text) {
				setItems((prev) => {
					const index = prev.findLastIndex((entry) => entry.kind === "cell");
					if (index < 0) return prev;
					const next = prev.slice();
					const cell = next[index];
					if (cell.kind !== "cell") return prev;
					next[index] = { ...cell, output: cell.output + text };
					return next;
				});
			},
			result(error) {
				setItems((prev) => {
					const index = prev.findLastIndex((entry) => entry.kind === "cell");
					if (index < 0) return prev;
					const next = prev.slice();
					const cell = next[index];
					if (cell.kind !== "cell") return prev;
					next[index] = { ...cell, error, state: error ? "error" : "done", endedAt: Date.now() };
					return next;
				});
			},
			assistant(text) {
				setPhase("assistant");
				liveKeyRef.current = null;
				setItems((prev) => {
					const last = prev[prev.length - 1];
					if (last?.kind === "live") {
						const row: ChatItem = {
							key: last.key,
							kind: "assistant",
							text,
							reasoning: last.reasoning,
						};
						return [...prev.slice(0, -1), row];
					}
					return [...prev, { key: key("a"), kind: "assistant", text }];
				});
			},
			streamReset() {
				// 和 App 一致：只清主进程缓冲，不删界面上正在显示的 live 行。
			},
			status(value) {
				setStatus(value);
				if (value === "waiting" || value === "dead") {
					// 和 App 一致：回合结束时停止 live 行的“生成中”状态。
					setItems((prev) =>
						prev.map((item, index) =>
							index === prev.length - 1 && item.kind === "live" && item.streaming
								? { ...item, streaming: false }
								: item,
						),
					);
				}
			},
			// 复刻 Fibona 的一次真实调用：多段模型调用（各自 reset）→ 代码流 → 最后一个 cell。
			// cell 只携带最后一段思考，这正是日志里 reasoning 2173/1660 chars 的来源。
			async prepareLive() {
				liveKeyRef.current = null;
				flushSync(() => setItems(seedHistory(1)));
				setRunId((v) => v + 1);
				await waitFrames(6);
				api.user("继续");
				const seg = "The tool keeps returning scheduled. I need to check the current cell and then plan the next write carefully. ";
				for (let round = 1; round <= 5; round += 1) {
					for (let i = 0; i < 6; i += 1) {
						api.reasoningDelta(`第 ${round} 段思考：${seg}`);
						await wait(16);
					}
					api.streamReset();
				}
				await waitFrames(16);
			},
			async prepareCell() {
				// 修复后主进程不再逐次 reset，cell 带的就是界面上累积的全部思考。
				api.cell(201, "读取 src/game.ts", "const text = await game.read();\nprint(text.length);");
				api.out("// src/game.ts\nconst scene = new THREE.Scene();\n");
				api.result(null);
				await waitFrames(16);
			},
			async reloadHistory(turns: number) {
				// 模拟同一项目里重发 history（不是切项目，所以 Chat 不重挂）：
				// App 里是 flushSync 清空 + 逐条回放。
				flushSync(() => setItems([]));
				setItems(seedHistory(turns));
				await waitFrames(8);
			},
			async reset() {
				liveKeyRef.current = null;
				setStatus("waiting");
				setItems(seedHistory());
				setRunId((value) => value + 1);
				await waitFrames(6);
				const el = viewport();
				if (el) el.scrollTop = el.scrollHeight;
				await waitFrames(4);
			},
			async runAll() {
				const results: { scenario: string; summary: ReturnType<typeof summarize> }[] = [];

				const scenarios: { name: string; steps: () => Promise<void>; tailShot?: boolean }[] = [
					{
						name: "reasoning→cell（读者在底部）",
						steps: async () => {
							for (const chunk of CHUNKS) {
								api.reasoningDelta(chunk);
								await wait(40);
							}
							await mark("思考流式结束");
							api.cell(101, "写入 src/game.ts", CODE);
							api.out("wrote 412 bytes\n");
							api.result(null);
							await mark("cell 落盘");
							await wait(400);
							await mark("cell 后 400ms");
							await wait(1200);
							await mark("cell 后 1.6s（思考卡自动收起）");
						},
					},
					{
						name: "reply→cell（读者在底部）",
						steps: async () => {
							for (const chunk of CHUNKS) {
								api.assistantDelta(chunk);
								await wait(40);
							}
							await mark("回复流式结束");
							api.cell(102, "读取 src/game.ts", "cat src/game.ts");
							await mark("cell 落盘");
							await wait(400);
							await mark("cell 后 400ms");
						},
					},
					{
						name: "reasoning→cell（读者已上滚 320px）",
						steps: async () => {
							for (const chunk of CHUNKS) {
								api.reasoningDelta(chunk);
								await wait(40);
							}
							const el = viewport();
							// 模拟真实滚轮：库用 wheel/touch/key 判定“用户主动离开底部”。
							el?.dispatchEvent(new WheelEvent("wheel", { deltaY: -320, bubbles: true, cancelable: true }));
							if (el) el.scrollTop = Math.max(0, el.scrollTop - 320);
							await waitFrames(8);
							// 锁定视口左上角那条消息：后面无论思考卡收起还是 cell 落盘，
							// 用户正在读的这一行都不该移动。
							const box = el?.getBoundingClientRect();
							const rows = [...document.querySelectorAll("[data-message-id]")] as HTMLElement[];
							const hit = box
								? rows.find((row) => {
									const rect = row.getBoundingClientRect();
									return rect.bottom > box.top + 1 && rect.top < box.bottom;
								})
								: null;
							watchId = hit?.getAttribute("data-message-id") ?? null;
							await mark("上滚后");
							api.cell(103, "写入 src/game.ts", CODE);
							await mark("cell 落盘");
							await wait(400);
							await mark("cell 后 400ms");
							await wait(1200);
							await mark("cell 后 1.6s（思考卡仍展开）");
						},
					},
					{
						name: "同一项目历史重放（2 轮）",
						steps: async () => {
							await mark("重放前");
							await api.reloadHistory(2);
							await mark("重放后");
							await wait(300);
							await mark("重放后 300ms");
						},
					},
					{
						name: "回合结束但只有思考（停止转圈、卡片不消失）",
						steps: async () => {
							for (const chunk of CHUNKS) {
								api.reasoningDelta(chunk);
								await wait(40);
							}
							await mark("思考流式结束");
							api.status("waiting");
							await mark("status waiting");
							await wait(400);
							await mark("waiting 后 400ms");
							await wait(1200);
							await mark("waiting 后 1.6s（仍保持展开）");
						},
					},
					{
						name: "连续多次模型调用（每次 streamReset）",
						steps: async () => {
							for (let round = 1; round <= 3; round += 1) {
								for (const chunk of CHUNKS.slice(0, 2)) {
									api.reasoningDelta(chunk);
									await wait(40);
								}
								await mark(`第${round}轮思考`);
								api.streamReset();
								await mark(`第${round}轮 reset 后`);
							}
						},
					},
					{
						name: "思考中直接发下一条（streamReset→user）",
						steps: async () => {
							for (const chunk of CHUNKS.slice(0, 3)) {
								api.reasoningDelta(chunk);
								await wait(40);
							}
							await mark("思考中");
							api.streamReset();
							// 同一 tick 里又来了一个旧回合的 delta，尾部仍有 live 行（最坏情况）。
							api.reasoningDelta("（旧回合的流式尾巴）");
							api.user("再改一下背景颜色。");
							await mark("发送新消息");
							await wait(300);
							await mark("新消息后 300ms");
						},
					},
					{
						name: "尾部思考→assistant（不能塌高度）",
						steps: async () => {
							for (const chunk of CHUNKS) {
								api.reasoningDelta(chunk);
								await wait(40);
							}
							await mark("思考流式结束");
							api.assistant("完成：已把障碍物加高并调整速度。");
							await mark("assistant 落盘");
							await wait(400);
							await mark("assistant 后 400ms");
							await wait(1200);
							await mark("assistant 后 1.6s（思考卡收起）");
						},
					},
					{
						name: "完整一轮：思考→cell→结果→回复→assistant",
						steps: async () => {
							api.status("working");
							for (const chunk of CHUNKS) {
								api.reasoningDelta(chunk);
								await wait(30);
							}
							api.cell(104, "写入 src/game.ts", CODE);
							await mark("cell 落盘");
							api.out("build ok\n");
							api.result(null);
							for (const chunk of CHUNKS.slice(0, 3)) {
								api.reasoningDelta(chunk);
								api.assistantDelta(chunk);
								await wait(40);
							}
							await mark("第二段流式");
							api.cell(105, "再次写入 src/game.ts", CODE);
							await mark("第二个 cell");
							api.reasoningDelta("最后再检查一遍碰撞体积。");
							await wait(40);
							await mark("尾部思考");
							api.assistant("完成：已把障碍物加高并调整速度。");
							api.status("waiting");
							await mark("assistant 落盘");
							await wait(600);
							await mark("assistant 后 600ms");
						},
					},
				];

				for (const scenario of scenarios) {
					await api.reset();
					startRecording();
					await mark("开始");
					await scenario.steps();
					stopRecording();
					results.push({ scenario: scenario.name, summary: summarize() });
				}
				await api.reset();
				return results;
			},
		};

		(window as unknown as { __harness: HarnessApi }).__harness = api;
	}, []);

	return (
		<div style={{ height: 640, width: 460, padding: 12 }}>
			<I18nProvider locale="zh">
				<Chat
					key={runId}
					items={items}
					status={status}
					nowMs={now}
					agent="fibona"
					agents={[
						{
							id: "fibona",
							name: "Fibona",
							description: "",
							kind: "builtin",
							enabled: true,
							available: true,
							launcher: "installed",
							command: "",
							args: [],
						},
					]}
					model="openai/gpt-5"
					models={[]}
					onSend={noop}
					onStop={noop}
					onAgent={noop}
					onModel={noop}
					acpModel={null}
					onAcpModel={noop}
					onAddAcpAgent={noop}
				/>
			</I18nProvider>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<Harness />);
