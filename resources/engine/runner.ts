// 引擎子进程。由主进程用 app 自带的 bun 拉起，cwd 是项目目录。
// 只做四件事：起 fibona、把格子输出转成事件、提供 game 写入、处理用户消息。
// 依赖只有同目录的 vendor/fibona-agent.js，打包时一起复制。
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Agent, Mind, JSEnv, BOOTSTRAP, INSTRUCTIONS } from "./vendor/fibona-agent.js";
import { AcpSession } from "./acp";
import type { EngineEvent, HostCommand } from "../../src/main/engine/protocol";

const GAME = join(process.cwd(), "src", "game.ts");
const MAX_CODE = 200_000;

const emit = (event: EngineEvent) => {
	try {
		process.stdout.write(JSON.stringify(event) + "\n");
	} catch {
		// 管道断了说明主进程已经退出，子进程随之结束。
		process.exit(0);
	}
};

// ---------- game API ----------

const game = {
	read(): string {
		try {
			return readFileSync(GAME, "utf8");
		} catch {
			return "";
		}
	},
	write(code: unknown): number {
		if (typeof code !== "string") throw new Error("game.write expects a string");
		if (code.length > MAX_CODE) throw new Error(`game.write got ${code.length} chars, limit is ${MAX_CODE}`);
		const tmp = GAME + ".tmp";
		writeFileSync(tmp, code);
		renameSync(tmp, GAME);
		emit({ t: "wrote" });
		return code.length;
	},
};

// ---------- 输入队列 ----------

const messages: string[] = [];
let deliver: ((text: string) => void) | null = null;

function takeInput(): Promise<string> {
	if (messages.length) return Promise.resolve(messages.shift()!);
	return new Promise<string>((resolve) => {
		deliver = resolve;
	});
}

async function readInput(): Promise<string> {
	if (messages.length) return messages.shift()!;
	emit({ t: "waiting" });
	return await takeInput();
}

// ---------- 模型客户端 ----------

function fetchClient(baseUrl: string) {
	const url = baseUrl.replace(/\/+$/, "") + "/responses";
	return {
		responses: {
			async create(body: Record<string, unknown>, options?: { signal?: AbortSignal }) {
				const response = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
					signal: options?.signal,
				});
				const payload: any = await response.json().catch(() => ({}));
				if (!response.ok) {
					const error: any = new Error(payload?.error?.message ?? `HTTP ${response.status}`);
					// fibona 用这两个字段判断“不可修复的供应商错误”，缺了会白试五次。
					error.status = response.status;
					error.headers = response.headers;
					throw error;
				}
				return payload;
			},
		},
	};
}

const COLOR_CELL = `
const palette = [0x4cc9f0, 0xf72585, 0x4ade80, 0xfbbf24, 0xa78bfa];
const color = palette[Math.floor(Math.random() * palette.length)].toString(16).padStart(6, "0");
const current = game.read();
game.write(current.replace(/0x4cc9f0/g, "0x" + color));
print("已把方块颜色改成 #" + color + "，点界面上的“应用更新”看效果。");
const next = await input();
const r = await call_me([...build_context(), { role: "user", content: next }]);
print(r.output_text);
`.trim();

function miniMockClient() {
	let round = 0;
	const helpers = [
		() => {
			const palette = ["f72585", "4ade80", "fbbf24", "a78bfa"];
			const color = palette[Math.floor(Math.random() * palette.length)];
			return {
				command: `sed -i.bak 's/0x4cc9f0/0x${color}/g' src/game.ts && rm -f src/game.ts.bak && echo "已把方块颜色改成 #${color}"`,
				summary: "随机换一个方块颜色",
			};
		},
		() => ({ command: "echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT", summary: "提交这一轮修改" }),
	];
	return {
		responses: {
			async create() {
				round += 1;
				const helper = helpers[Math.min(round - 1, helpers.length - 1)]!();
				const callId = `call_mini_${round}`;
				return {
					id: `mock_mini_${round}`,
					status: "completed",
					model: "mock",
					usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, cost: 0 },
					output: [
						{
							type: "message",
							id: `msg_mini_${round}`,
							role: "assistant",
							content: [{ type: "output_text", text: helper.summary }],
						},
						{
							type: "function_call",
							id: `fc_mini_${round}`,
							call_id: callId,
							name: "bash",
							arguments: JSON.stringify({ command: helper.command }),
							status: "completed",
						},
					],
					output_text: helper.summary,
				};
			},
		},
	};
}

function mockClient() {
	let round = 0;
	return {
		responses: {
			async create() {
				round += 1;
				const base = {
					id: `mock_${round}`,
					status: "completed",
					model: "mock",
					usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
				};
				if (round % 2 === 0) {
					return {
						...base,
						output: [{ type: "message", id: `msg_${round}`, role: "assistant", content: [{ type: "output_text", text: "已提交。" }] }],
						output_text: "已提交。",
					};
				}
				return {
					...base,
					output: [
						{
							type: "function_call",
							id: `fc_${round}`,
							call_id: `call_${round}`,
							name: "set_next_cell",
							arguments: JSON.stringify({ code: COLOR_CELL, summary: "随机换一个方块颜色" }),
							status: "completed",
						},
					],
					output_text: "",
				};
			},
		},
	};
}

// 宿主兜底：cell 结束时没有 schedule 下一格，就等用户消息再唤醒模型。
// 这样生成模型不需要记住“交还控制权”的模板，少一类失败。
class GameEnv extends JSEnv {
	async execute(code: string, options: any = {}) {
		let scheduled = false;
		const original = (globalThis as any).call_me;
		if (typeof original === "function") {
			(globalThis as any).call_me = (...args: any[]) => {
				scheduled = true;
				return original(...args);
			};
		}
		const result = await super.execute(code, options);
		if (scheduled || result.quit || result.error !== null) return result;
		try {
			const next = await readInput();
			const context = (globalThis as any).build_context?.() ?? [];
			const response = await original([...context, { role: "user", content: next }]);
			if (response?.output_text) (this.opts.stdout ?? (() => {}))(String(response.output_text) + "\n");
		} catch (error) {
			result.error = String((error as Error)?.message ?? error);
		}
		return result;
	}
}

// ---------- 内置 mini-swe-agent ----------
// 上游：https://github.com/SWE-agent/mini-swe-agent
// 与 runner 放在同一个文件，避免打包只复制 runner.ts 时缺少模块。

// 内置 mini-swe-agent 循环（TypeScript 移植）。
// 上游：https://github.com/SWE-agent/mini-swe-agent
// 保留它的核心约定：只有一个 bash 工具、线性消息历史、每步一条命令，
// 命令输出首行是 COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT 时提交并结束。
// 和 Python 版的差异只有两处：模型调用走主进程的 Responses 网关；提交判定看输出首行。
// 下面的 SYSTEM_TEMPLATE / FORMAT_ERROR / instanceTemplate 是这个 agent 上游自带的
// 原生提示词，不是 VibeGame 项目规则；项目规则由 agent 自己探索项目文件，不在代码里注入。

type MiniClient = {
	responses: {
		create(body: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<any>;
	};
};

type MiniOptions = {
	task: string;
	cwd: string;
	model: string;
	client: MiniClient;
	signal: AbortSignal;
	emit: (event: any) => void;
	maxSteps?: number;
	timeoutMs?: number;
};

const BASH_TOOL = {
	type: "function",
	name: "bash",
	description: "Execute a bash command",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string", description: "The bash command to execute" },
		},
		required: ["command"],
		additionalProperties: false,
	},
};

const SYSTEM_TEMPLATE = `You are a helpful assistant that can interact with a computer.`;

const FORMAT_ERROR = `Tool call error:

<error>
{{error}}
</error>

Here is general guidance on how to submit correct toolcalls:

Every response needs to use the 'bash' tool at least once to execute commands.

Call the bash tool with your command as the argument:
- Tool: bash
- Arguments: {"command": "your_command_here"}

If you want to end the task, please issue the following command: \`echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\`
without any other command.`;

function instanceTemplate(task: string, cwd: string) {
	const darwin = process.platform === "darwin";
	return `Please solve this issue: ${task}

You can execute bash commands and edit files to implement the necessary changes.

The working directory is ${cwd}.

## Recommended Workflow

This workflow should be done step-by-step so that you can iterate on your changes and any possible problems.

1. Analyze the project by finding and reading relevant files
2. Edit the source code to resolve the issue
3. Verify your change is syntactically valid
4. Submit your changes and finish your work by issuing the following command: \`echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\`.
   Do not combine it with any other command. <important>After this command, you cannot continue working on this task.</important>

## Command Execution Rules

You are operating in an environment where

1. You issue at least one command
2. The system executes the command(s) in a subshell
3. You see the result(s)
4. You write your next command(s)

Each response should include:

1. **Reasoning text** where you explain your analysis and plan
2. At least one tool call with your command

**CRITICAL REQUIREMENTS:**

- Your response SHOULD include reasoning text explaining what you're doing
- Your response MUST include AT LEAST ONE bash tool call
- Directory or environment variable changes are not persistent. Every action is executed in a new subshell.
- However, you can prefix any action with \`MY_ENV_VAR=MY_VALUE cd /path/to/working/dir && ...\` or write/load environment variables from files
- Submit your changes and finish your work by issuing the following command: \`echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT\`.
  Do not combine it with any other command. <important>After this command, you cannot continue working on this task.</important>

Example of a CORRECT response:
<example_response>
I need to understand the structure of the repository first. Let me check what files are in the current directory to get a better understanding of the codebase.

[Makes bash tool call with {"command": "ls -la"} as arguments]
</example_response>

<system_information>
${process.platform} ${process.arch} node ${process.version}
</system_information>

## Useful command examples

### Create a new file:

\`\`\`bash
cat <<'EOF' > newfile.js
const hello = "world";
console.log(hello);
EOF
\`\`\`

### Edit files with sed:

${
	darwin
		? `<important>
You are on MacOS. For all the below examples, you need to use \`sed -i ''\` instead of \`sed -i\`.
</important>`
		: ""
}

\`\`\`bash
# Replace all occurrences
sed -i 's/old_string/new_string/g' filename.js

# View specific lines with numbers
nl -ba src/game.ts | sed -n '10,40p'
\`\`\`

### Any other command you want to run

\`\`\`bash
anything
\`\`\`
`;
}

function observation(output: { output: string; returncode: number; exception_info?: string }) {
	const base = {
		returncode: output.returncode,
		...(output.exception_info ? { exception_info: output.exception_info } : {}),
	};
	if (output.output.length < 10_000) {
		return JSON.stringify({ ...base, output: output.output }, null, 2);
	}
	return JSON.stringify(
		{
			...base,
			output_head: output.output.slice(0, 5000),
			output_tail: output.output.slice(-5000),
			elided_chars: output.output.length - 10_000,
			warning: "Output too long.",
		},
		null,
		2,
	);
}

function formatError(error: string) {
	return FORMAT_ERROR.replace("{{error}}", error);
}

function textOf(response: any): string {
	if (typeof response?.output_text === "string") return response.output_text;
	return (response?.output ?? [])
		.filter((item: any) => item?.type === "message")
		.flatMap((item: any) => item.content ?? [])
		.filter((part: any) => part?.type === "output_text")
		.map((part: any) => part.text)
		.join("");
}

function toolCallsOf(response: any): any[] {
	return (response?.output ?? []).filter((item: any) => item?.type === "function_call");
}

/** 只保留 Responses API 能吃的输出项，避免把网关不认识的字段带进下一轮。 */
function assistantItems(response: any): any[] {
	return (response?.output ?? []).filter(
		(item: any) => item?.type === "message" || item?.type === "function_call",
	);
}

const MAX_STREAM_CHARS = 2_000_000;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
	const decoder = new TextDecoder();
	let text = "";
	let truncated = false;
	for await (const chunk of stream as any) {
		if (text.length < MAX_STREAM_CHARS) {
			text += decoder.decode(chunk, { stream: true });
			if (text.length > MAX_STREAM_CHARS) {
				text = `${text.slice(0, MAX_STREAM_CHARS)}\n[输出超过 ${MAX_STREAM_CHARS} 字符，已截断]`;
				truncated = true;
			}
		} else {
			truncated = true;
		}
	}
	if (!truncated) text += decoder.decode();
	return text;
}

type CommandResult = { output: string; returncode: number; exception_info?: string };

async function runCommand(command: string, cwd: string, signal: AbortSignal, timeoutMs: number): Promise<CommandResult> {
	const proc = Bun.spawn({
		cmd: ["bash", "-lc", command],
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			TERM: "dumb",
			PAGER: "cat",
			MANPAGER: "cat",
			LESS: "-R",
			PIP_PROGRESS_BAR: "off",
			TQDM_DISABLE: "1",
		},
	});

	let timedOut = false;
	const kill = () => {
		try {
			proc.kill("SIGKILL");
		} catch {}
	};
	const timer = setTimeout(() => {
		timedOut = true;
		kill();
	}, timeoutMs);
	const onAbort = () => kill();
	signal.addEventListener("abort", onAbort, { once: true });

	try {
		const [stdout, stderr, code] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr), proc.exited]);
		const exception = timedOut ? `Command timed out after ${Math.round(timeoutMs / 1000)}s` : undefined;
		return {
			output: stdout + stderr,
			returncode: timedOut ? -1 : code,
			exception_info: exception,
		};
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", onAbort);
	}
}

function gameHash(cwd: string): string {
	try {
		return readFileSync(join(cwd, "src", "game.ts"), "utf8");
	} catch {
		return "";
	}
}

function firstLine(text: string, limit = 180) {
	const line = text.trim().split("\n").find((entry) => entry.trim()) ?? "";
	return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

function clipForUi(text: string, limit = 20_000) {
	if (text.length <= limit) return text;
	const half = Math.floor(limit / 2);
	return `${text.slice(0, half)}\n… [省略 ${text.length - limit} 字符] …\n${text.slice(-half)}`;
}

/**
 * 跑一轮任务。返回后由宿主重新等待用户消息；下一轮只带新任务和项目文件，不重复上一轮的 bash 历史。
 */
async function runMiniSweAgent(options: MiniOptions) {
	const { task, cwd, model, client, signal, emit } = options;
	const maxSteps = options.maxSteps ?? 0;
	const timeoutMs = options.timeoutMs ?? 120_000;

	const messages: any[] = [{ role: "user", content: instanceTemplate(task, cwd) }];
	let latestGame = gameHash(cwd);
	let step = 0;
	let formatErrors = 0;

	const submit = (submission: string) => {
		if (submission.trim()) emit({ t: "out", s: `\n[提交]\n${submission}\n`, stream: "stdout" });
		return { submitted: true, submission };
	};

	while (!signal.aborted) {
		if (maxSteps > 0 && step >= maxSteps) {
			emit({ t: "out", s: `\n[mini-swe-agent] 达到 ${maxSteps} 步上限，暂停。\n`, stream: "stdout" });
			return { submitted: false, submission: "" };
		}

		let response: any;
		try {
			response = await client.responses.create(
				{
					model,
					instructions: SYSTEM_TEMPLATE,
					input: messages,
					tools: [BASH_TOOL],
					tool_choice: "auto",
					parallel_tool_calls: false,
					reasoning: { effort: "medium" },
					store: false,
				},
				{ signal },
			);
		} catch (error) {
			if (signal.aborted) return { submitted: false, submission: "" };
			throw error;
		}
		if (signal.aborted) return { submitted: false, submission: "" };

		const usage = response?.usage;
		emit({
			t: "usage",
			input: usage?.input_tokens ?? 0,
			output: usage?.output_tokens ?? 0,
			cost: typeof usage?.cost === "number" ? usage.cost : null,
		});

		const text = textOf(response).trim();
		const calls = toolCallsOf(response);
		messages.push(...assistantItems(response));

		if (!calls.length) {
			formatErrors += 1;
			const error = text
				? `No tool calls found in the response. Every response MUST include at least one tool call.`
				: "The response contained no text and no tool call.";
			if (formatErrors >= 3) {
				emit({ t: "out", s: `\n[mini-swe-agent] 连续 3 次没有工具调用，暂停。\n`, stream: "stdout" });
				return { submitted: false, submission: "" };
			}
			messages.push({ role: "user", content: formatError(error) });
			continue;
		}
		formatErrors = 0;

		let submitted: { submitted: boolean; submission: string } | null = null;

		for (const call of calls) {
			if (signal.aborted) return { submitted: false, submission: "" };
			step += 1;

			let parsed: any = {};
			let parseError = "";
			try {
				parsed = JSON.parse(call.arguments ?? "{}");
			} catch (error) {
				parseError = `Error parsing tool call arguments: ${String((error as Error)?.message ?? error)}.`;
			}
			if (call.name !== "bash") parseError += ` Unknown tool '${call.name}'.`;
			if (typeof parsed?.command !== "string") parseError += " Missing 'command' argument in bash tool call.";

			if (parseError) {
				const n = step;
				emit({ t: "cell", n, summary: "工具调用格式错误", code: "" });
				emit({ t: "out", s: formatError(parseError.trim()), stream: "stderr" });
				emit({ t: "result", n, error: parseError.trim() });
				messages.push({ type: "function_call_output", call_id: call.call_id, output: observation({ output: parseError, returncode: -1 }) });
				formatErrors += 1;
				if (formatErrors >= 3) {
					emit({ t: "out", s: `\n[mini-swe-agent] 连续 3 次工具调用格式错误，暂停。\n`, stream: "stdout" });
					return { submitted: false, submission: "" };
				}
				continue;
			}

			const command: string = parsed.command;
			emit({ t: "cell", n: step, summary: firstLine(text) || firstLine(command), code: command });

			const result = await runCommand(command, cwd, signal, timeoutMs);
			if (signal.aborted) {
				emit({ t: "result", n: step, error: "已停止" });
				return { submitted: false, submission: "" };
			}

			if (result.output) emit({ t: "out", s: clipForUi(result.output), stream: "stdout" });
			emit({ t: "result", n: step, error: result.exception_info ?? null });

			const current = gameHash(cwd);
			if (current !== latestGame) {
				latestGame = current;
				emit({ t: "wrote" });
			}

			messages.push({
				type: "function_call_output",
				call_id: call.call_id,
				output: observation(result),
			});

			const first = result.output.replace(/^\s+/, "").split("\n")[0]?.trim();
			if (result.returncode === 0 && first === "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT") {
				const rest = result.output.replace(/^\s+/, "").split("\n").slice(1).join("\n");
				submitted = submit(rest);
				break;
			}
		}

		if (submitted) return submitted;
	}

	return { submitted: false, submission: "" };
}

// ---------- 会话 ----------

let controller: AbortController | null = null;
let miniController: AbortController | null = null;
let acpSession: AcpSession | null = null;
let running = false;

// ---------- 本机 ACP Agent ----------
// Claude Code / Codex 由本机 CLI 自己执行工具并写文件；这里只转发事件、等用户消息。
async function startAcp(cmd: Extract<HostCommand, { t: "start" }>) {
	if (!cmd.acp) {
		emit({ t: "dead", error: "没有配置 ACP 启动命令" });
		return;
	}
	const session = new AcpSession({ cwd: process.cwd(), emit });
	acpSession = session;
	try {
		await session.start(cmd.acp);
	} catch (error) {
		session.close();
		if (acpSession === session) acpSession = null;
		emit({ t: "started", mock: cmd.mock });
		emit({ t: "dead", error: String((error as Error)?.message ?? error) });
		return;
	}
	emit({ t: "started", mock: cmd.mock });

	while (true) {
		emit({ t: "waiting" });
		const task = await takeInput();
		try {
			await session.prompt(task);
		} catch (error) {
			if (session.cancelling) {
				emit({ t: "out", s: "\n[acp] 已停止\n", stream: "stderr" });
			} else {
				const message = String((error as Error)?.message ?? error);
				// 没有 cell 时宿主的 out 会被丢掉，用 notice 保证报错一定可见。
				emit({ t: "notice", text: message, tone: "error" });
			}
		}
	}
}

async function startMini(cmd: Extract<HostCommand, { t: "start" }>) {
	const client = cmd.mock ? miniMockClient() : fetchClient(cmd.gatewayUrl ?? "http://127.0.0.1:1");
	emit({ t: "started", mock: cmd.mock });

	while (true) {
		emit({ t: "waiting" });
		const task = await takeInput();
		const abort = new AbortController();
		miniController = abort;
		try {
			await runMiniSweAgent({
				task,
				cwd: process.cwd(),
				model: cmd.model,
				client,
				signal: abort.signal,
				emit,
			});
		} catch (error) {
			// 单轮失败不结束会话；用户下一条消息会重新开始一轮。
			if (!abort.signal.aborted) {
				const message = String((error as Error)?.message ?? error);
				emit({ t: "out", s: `\n[mini-swe-agent] ${message}\n`, stream: "stderr" });
			}
		} finally {
			if (miniController === abort) miniController = null;
		}
	}
}

async function start(cmd: Extract<HostCommand, { t: "start" }>) {
	if (running) return;
	running = true;

	if (cmd.agent.startsWith("acp-")) {
		await startAcp(cmd);
		return;
	}

	if (cmd.agent !== "fibona") {
		await startMini(cmd);
		return;
	}

	controller = new AbortController();
	const client = cmd.mock ? mockClient() : fetchClient(cmd.gatewayUrl ?? "http://127.0.0.1:1");

	const env = new GameEnv({
		stdout: (s: string) => emit({ t: "out", s, stream: "stdout" }),
		stderr: (s: string) => emit({ t: "out", s, stream: "stderr" }),
		readInput,
	});
	// 不在代码里注入项目规则；agent 自己探索项目文件。
	env.bind({ instructions: "", game });

	const mind = new Mind(client, cmd.model, INSTRUCTIONS);
	const agent = new Agent(mind, {
		log: (record: any) => {
			const usage = record?.response?.usage;
			if (record?.event === "model_response" && usage) {
				emit({
					t: "usage",
					input: usage.input_tokens ?? 0,
					output: usage.output_tokens ?? 0,
					cost: typeof usage.cost === "number" ? usage.cost : null,
				});
			}
		},
	});

	emit({ t: "started", mock: cmd.mock });

	agent
		.run(BOOTSTRAP, {
			env,
			signal: controller.signal,
			onCell: (n: number, summary: string, code: string) => emit({ t: "cell", n, summary, code }),
			onResult: (n: number, result: any) =>
				emit({ t: "result", n, error: result.error ?? null, quit: Boolean(result.quit) }),
		})
		.then(() => emit({ t: "dead", error: "会话已结束" }))
		.catch((error: any) => emit({ t: "dead", error: String(error?.message ?? error) }));
}

// ---------- 主循环：读 stdin ----------

emit({ t: "ready" });

// 主进程杀掉引擎时，别把 ACP 子进程留成孤儿。
const shutdown = () => {
	acpSession?.close();
	process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGHUP", shutdown);

const stdin = console as unknown as AsyncIterable<string>;
for await (const line of stdin) {
	const text = line.trim();
	if (!text) continue;
	let command: HostCommand;
	try {
		command = JSON.parse(text);
	} catch {
		continue;
	}
	if (command.t === "start") void start(command);
	else if (command.t === "message") {
		if (deliver) {
			const resolve = deliver;
			deliver = null;
			resolve(command.text);
		} else {
			messages.push(command.text);
		}
	} else if (command.t === "option") {
		void acpSession?.setConfigOption(command.configId, command.value).catch((error) => {
			emit({ t: "notice", text: String((error as Error)?.message ?? error), tone: "error" });
		});
	} else if (command.t === "stop") {
		(globalThis as any).stop?.();
		miniController?.abort();
		acpSession?.cancel();
	} else if (command.t === "kill") {
		acpSession?.close();
		process.exit(0);
	}
}
