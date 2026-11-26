// 宿主与引擎子进程之间的唯一协议。两边都 import 这一份。
// 子进程用 `import type`，运行时会被擦除，不会因路径变化而失败。

export type AcpOptionValue = { value: string; name: string; description?: string };
export type AcpConfigOption = {
	id: string;
	name: string;
	currentValue: string;
	values: AcpOptionValue[];
};

export type AcpLaunch = {
	command: string;
	args: string[];
	/** 上次选择的模型，session 建好后恢复 */
	model?: string;
	/** 额外的环境变量，比如 CODEX_PATH 指向桌面端自带的 CLI */
	env?: Record<string, string>;
	/** 展示给用户的名称，只用于错误提示 */
	name: string;
	/** 未登录时给用户的操作提示 */
	loginHint?: string;
};

export type HostCommand =
	| { t: "start"; mock: boolean; model: string; agent: string; gatewayUrl?: string; acp?: AcpLaunch }
	| { t: "message"; text: string }
	| { t: "option"; configId: string; value: string }
	| { t: "stop" }
	| { t: "kill" };

export type EngineEvent =
	| { t: "ready" }
	| { t: "started"; mock: boolean }
	| { t: "waiting" }
	| { t: "cell"; n: number; summary: string; code: string }
	| { t: "out"; s: string; stream: "stdout" | "stderr" }
	| { t: "result"; n: number; error: string | null; quit: boolean }
	| { t: "text"; s: string }
	| { t: "thinking"; s: string }
	| { t: "assistant"; text: string }
	| { t: "notice"; text: string; tone: "info" | "error" }
	| { t: "acpOptions"; options: AcpConfigOption[] }
	| { t: "wrote" }
	| { t: "usage"; input: number; output: number; cost: number | null }
	| { t: "dead"; error: string };
