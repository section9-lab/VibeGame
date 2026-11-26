// 本机 ACP Agent 的探测。只做两件事：补齐常见安装路径、判断命令能不能跑。
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** nvm 不写全局 PATH，GUI 应用只能自己扫版本目录。只取最新的一个，别把 PATH 撑爆。 */
function nvmBin(): string | null {
	const root = join(homedir(), ".nvm", "versions", "node");
	try {
		const versions = readdirSync(root)
			.filter((name) => /^v\d+/.test(name))
			.sort((a, b) => {
				const pa = a.slice(1).split(".").map(Number);
				const pb = b.slice(1).split(".").map(Number);
				for (let i = 0; i < 3; i += 1) {
					if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
				}
				return 0;
			});
		return versions[0] ? join(root, versions[0], "bin") : null;
	} catch {
		return null;
	}
}

/**
 * 从 Finder 启动的 macOS 应用拿到的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 找不到 Homebrew 或 npm 全局安装的 Agent。这里追加常见目录，只影响本进程和子进程。
 */
export function withAgentPath(current = process.env.PATH ?? ""): string {
	const extras = [
		join(homedir(), ".local", "bin"),
		join(homedir(), ".bun", "bin"),
		join(homedir(), ".npm-global", "bin"),
		join(homedir(), ".volta", "bin"),
		join(homedir(), ".asdf", "shims"),
		nvmBin(),
		"/opt/homebrew/bin",
		"/opt/local/bin",
		"/usr/local/bin",
		"/usr/bin",
		"/bin",
		"/usr/sbin",
		"/sbin",
	].filter((entry): entry is string => Boolean(entry));
	const seen = new Set<string>();
	const parts: string[] = [];
	for (const entry of [...current.split(":"), ...extras]) {
		if (!entry || seen.has(entry)) continue;
		seen.add(entry);
		parts.push(entry);
	}
	return parts.join(":");
}

/** 返回可执行文件的绝对路径；找不到返回 null。绝对/相对路径直接查文件。 */
export function commandPath(command: string): string | null {
	const trimmed = command.trim();
	if (!trimmed) return null;
	if (trimmed.includes("/")) return existsSync(trimmed) ? trimmed : null;
	return Bun.which(trimmed, { PATH: process.env.PATH ?? "" });
}
