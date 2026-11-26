// 引擎子进程的看门人。只做三件事：拉起、转发事件、发命令。
import { t } from "../../mainview/src/i18n";
import type { AcpLaunch, EngineEvent, HostCommand } from "./protocol";

export type SupervisorHooks = {
	onEvent: (event: EngineEvent) => void;
	onLog: (line: string) => void;
};

export class EngineSupervisor {
	private proc: any = null;
	private hooks: SupervisorHooks;
	private runnerPath: string;
	private cwd: string;
	private stopped = false;

	constructor(runnerPath: string, cwd: string, hooks: SupervisorHooks) {
		this.runnerPath = runnerPath;
		this.cwd = cwd;
		this.hooks = hooks;
	}

	get alive() {
		return this.proc !== null && !this.stopped;
	}

	spawn() {
		if (this.proc) return;
		this.stopped = false;
		const proc = Bun.spawn({
			cmd: [process.execPath, this.runnerPath],
			cwd: this.cwd,
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			// 传完整环境：ACP Agent 需要 HOME/USER 读本机登录态，也可能读自己的环境变量。
			env: { ...process.env, PATH: process.env.PATH ?? "" },
		});
		this.proc = proc;

		void this.pump(proc.stdout, (line) => {
			let event: EngineEvent;
			try {
				event = JSON.parse(line);
			} catch {
				this.hooks.onLog(`[engine:raw] ${line}`);
				return;
			}
			this.hooks.onEvent(event);
		});

		void this.pump(proc.stderr, (line) => this.hooks.onLog(`[engine:err] ${line}`));

		void proc.exited.then((code: number) => {
			const wasStopped = this.stopped;
			this.proc = null;
			if (!wasStopped) this.hooks.onEvent({ t: "dead", error: t("engineExited", { code }) });
		});
	}

	start(options: { mock: boolean; model: string; agent: string; gatewayUrl?: string; acp?: AcpLaunch }) {
		this.send({ t: "start", ...options });
	}

	sendMessage(text: string) {
		this.send({ t: "message", text });
	}

	interrupt() {
		this.send({ t: "stop" });
	}

	setAcpOption(configId: string, value: string) {
		this.send({ t: "option", configId, value });
	}

	kill() {
		this.stopped = true;
		try {
			this.proc?.kill();
		} catch {}
		this.proc = null;
	}

	private send(command: HostCommand) {
		if (!this.proc) return;
		try {
			this.proc.stdin.write(JSON.stringify(command) + "\n");
			void this.proc.stdin.flush();
		} catch (error) {
			this.hooks.onLog(`[engine:write-failed] ${String(error)}`);
		}
	}

	private async pump(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of stream as any) {
			buffer += decoder.decode(chunk, { stream: true });
			for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
				onLine(buffer.slice(0, index));
				buffer = buffer.slice(index + 1);
			}
		}
		if (buffer.trim()) onLine(buffer);
	}
}
