// 用无头 Brave(Chromium) + CDP 跑滚动回归：页面里是 harness.html，脚本调用 window.__harness.runAll()。
// 用法：bun scripts/scroll-check.mjs http://127.0.0.1:5199/harness.html
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5199/harness.html";
const BRAVE = process.env.BRAVE ?? "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
const PORT = 9400 + (process.pid % 400);

const profile = mkdtempSync(join(tmpdir(), "vibegame-scroll-"));
const browser = spawn(
	BRAVE,
	[
		"--headless=new",
		`--remote-debugging-port=${PORT}`,
		`--user-data-dir=${profile}`,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-gpu",
		"--hide-scrollbars=false",
		"--window-size=560,820",
		"about:blank",
	],
	{ stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageTarget() {
	for (let i = 0; i < 150; i += 1) {
		try {
			const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
			if (response.ok) {
				const list = await response.json();
				const page = list.find((entry) => entry.type === "page" && entry.webSocketDebuggerUrl);
				if (page) return page;
			}
		} catch {
			// 浏览器还没起来
		}
		await sleep(100);
	}
	throw new Error("Brave CDP 没启动或没有 page target");
}

const page = await pageTarget();

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.onopen = resolve;
	ws.onerror = () => reject(new Error("CDP WebSocket 连接失败"));
});

let nextId = 1;
const pending = new Map();
const consoleLines = [];

ws.onmessage = (event) => {
	const message = JSON.parse(event.data);
	if (message.id) {
		const entry = pending.get(message.id);
		if (!entry) return;
		pending.delete(message.id);
		if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
		else entry.resolve(message.result);
		return;
	}
	if (message.method === "Runtime.exceptionThrown") {
		consoleLines.push(`EXCEPTION ${message.params.exceptionDetails.text} ${message.params.exceptionDetails.exception?.description ?? ""}`);
	}
	if (message.method === "Runtime.consoleAPICalled" && (message.params.type === "error" || message.params.type === "warning")) {
		consoleLines.push(`${message.params.type.toUpperCase()} ${message.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ")}`);
	}
};

function send(method, params = {}) {
	const id = nextId++;
	ws.send(JSON.stringify({ id, method, params }));
	return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}

async function evaluate(expression, awaitPromise = false) {
	const result = await send("Runtime.evaluate", {
		expression,
		awaitPromise,
		returnByValue: true,
		userGesture: true,
	});
	if (result.exceptionDetails) {
		throw new Error(`evaluate 失败: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ""}`);
	}
	return result.result.value;
}

try {
	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 820, deviceScaleFactor: 1, mobile: false });
	await send("Page.navigate", { url });

	let ready = false;
	for (let i = 0; i < 200; i += 1) {
		try {
			ready = Boolean(await evaluate("typeof window.__harness !== 'undefined'"));
		} catch {
			ready = false;
		}
		if (ready) break;
		await sleep(100);
	}
	if (!ready) throw new Error(`harness 没就绪，控制台：\n${consoleLines.join("\n")}`);

	const results = await evaluate("window.__harness.runAll()", true);
	console.log(JSON.stringify(results, null, 2));
	if (consoleLines.length) {
		console.error("--- console ---");
		for (const line of consoleLines) console.error(line);
	}
} finally {
	try {
		ws.close();
	} catch {
		// ignore
	}
	browser.kill("SIGKILL");
	// 无头 Chromium 会留下子进程占着调试端口；按 profile 路径一起清掉。
	spawnSync("pkill", ["-f", profile]);
}
