// pi 的凭据文件就是一个 JSON。这里做一层最小的文件存储，OAuth 刷新后能写回去。
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Credential = { type: "api_key"; key?: string; env?: Record<string, string> } | { type: "oauth"; access: string; refresh: string; expires: number; [key: string]: unknown };

export type CredentialStore = {
	read(providerId: string, options?: { signal?: AbortSignal }): Promise<Credential | undefined>;
	list(options?: { signal?: AbortSignal }): Promise<{ providerId: string; type: Credential["type"] }[]>;
	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: { signal?: AbortSignal },
	): Promise<Credential | undefined>;
	delete(providerId: string, options?: { signal?: AbortSignal }): Promise<void>;
};

export function piAgentDir(): string {
	return process.env.PI_AGENT_DIR ?? join(process.env.HOME ?? ".", ".pi", "agent");
}

export function fileCredentialStore(path = join(piAgentDir(), "auth.json")): CredentialStore {
	const readAll = (): Record<string, Credential> => {
		if (!existsSync(path)) return {};
		try {
			return JSON.parse(readFileSync(path, "utf8"));
		} catch {
			return {};
		}
	};
	const writeAll = (all: Record<string, Credential>) => {
		writeFileSync(path, JSON.stringify(all, null, 2), { mode: 0o600 });
		try {
			chmodSync(path, 0o600);
		} catch {}
	};

	return {
		async read(providerId) {
			return readAll()[providerId];
		},
		async list() {
			return Object.entries(readAll()).map(([providerId, credential]) => ({ providerId, type: credential.type }));
		},
		async modify(providerId, fn) {
			const all = readAll();
			const next = await fn(all[providerId]);
			if (next === undefined) delete all[providerId];
			else all[providerId] = next;
			writeAll(all);
			return next;
		},
		async delete(providerId) {
			const all = readAll();
			delete all[providerId];
			writeAll(all);
		},
	};
}
