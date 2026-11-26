import type { ChatItem } from "@/Chat";

export type LiveItem = Extract<ChatItem, { kind: "live" }>;
export type LiveField = keyof Pick<LiveItem, "reasoning" | "message">;

// 主进程在 cell 落盘时会把 reasoning / message 截到 20k 字符（index.ts）。
// 界面按同样上限截断，落盘瞬间文本才不会变短。
const MAX_FIELD = 20_000;

/**
 * 在尾部 live 行上累积流式文本；没有 live 行时新建一条。
 *
 * 整个回合只保留一条“正在生成”的行：思考、回复、代码都在这一行里增长，
 * 不再各自占一行。落盘时 App 复用同一个 key 把它原地升级成 cell，
 * 行数不变、DOM 节点不变，滚动容器不会把它当成新行重新定位。
 */
export function appendLiveDelta(items: ChatItem[], liveKey: string, field: LiveField, text: string): ChatItem[] {
	const last = items[items.length - 1];
	if (last?.kind === "live") {
		const next = items.slice();
		next[next.length - 1] = { ...last, streaming: true, [field]: (last[field] + text).slice(0, MAX_FIELD) };
		return next;
	}
	const live: LiveItem = { key: liveKey, kind: "live", reasoning: "", message: "", streaming: true };
	live[field] = (live[field] + text).slice(0, MAX_FIELD);
	return [...items, live];
}

/** 丢弃还没落盘的尾部 live 行（用户打断、切换项目、流重置）。 */
export function dropLive(items: ChatItem[]): ChatItem[] {
	return items[items.length - 1]?.kind === "live" ? items.slice(0, -1) : items;
}
