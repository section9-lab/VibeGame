// 每个项目都是 projectsRoot/<projectId> 下的独立目录。这里只读它，不跨项目。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { t } from "../../mainview/src/i18n";

export type ProjectFileNode =
	| { type: "folder"; name: string; path: string; children: ProjectFileNode[] }
	| { type: "file"; name: string; path: string; size: number };

export type ProjectFileContent = {
	path: string;
	name: string;
	content: string;
	language: string;
	size: number;
	binary: boolean;
};

const IGNORED = new Set([".preview", "node_modules", ".git", "dist", "events.jsonl"]);
const MAX_ENTRIES = 600;
const MAX_DEPTH = 8;
const MAX_FILE_SIZE = 2 * 1024 * 1024;

// File names are sorted the same way regardless of the interface language.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const LANGUAGES: Record<string, string> = {
	".html": "html",
	".htm": "html",
	".css": "css",
	".js": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".jsx": "jsx",
	".ts": "typescript",
	".tsx": "tsx",
	".json": "json",
	".md": "markdown",
	".py": "python",
	".sql": "sql",
	".sh": "bash",
	".yml": "yaml",
	".yaml": "yaml",
};

export function listProjectFiles(root: string): { dir: string; files: ProjectFileNode[] } {
	let count = 0;

	const walk = (dir: string, prefix: string, depth: number): ProjectFileNode[] => {
		if (depth > MAX_DEPTH || count >= MAX_ENTRIES) return [];

		const folders: ProjectFileNode[] = [];
		const files: ProjectFileNode[] = [];
		let entries: import("node:fs").Dirent<string>[];
		try {
			entries = readdirSync(dir, { withFileTypes: true, encoding: "utf8" });
		} catch {
			return [];
		}

		for (const entry of entries) {
			if (count >= MAX_ENTRIES) break;
			if (entry.name.startsWith(".") || IGNORED.has(entry.name)) continue;
			// 不跟随符号链接，避免把项目目录之外的东西带进来。
			if (entry.isSymbolicLink()) continue;

			const path = prefix ? `${prefix}/${entry.name}` : entry.name;
			const full = join(dir, entry.name);

			if (entry.isDirectory()) {
				count += 1;
				folders.push({ type: "folder", name: entry.name, path, children: walk(full, path, depth + 1) });
				continue;
			}

			if (!entry.isFile()) continue;
			count += 1;
			let size = 0;
			try {
				size = statSync(full).size;
			} catch {}
			files.push({ type: "file", name: entry.name, path, size });
		}

		folders.sort((a, b) => collator.compare(a.name, b.name));
		files.sort((a, b) => collator.compare(a.name, b.name));
		return [...folders, ...files];
	};

	return { dir: root, files: walk(root, "", 0) };
}

export function readProjectFile(root: string, path: string): ProjectFileContent {
	const normalized = path.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized || normalized.includes("\0")) throw new Error(t("errorInvalidPath"));

	const full = resolve(root, normalized);
	const inside = relative(root, full);
	if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
		throw new Error(t("errorOutsideProject"));
	}

	const stat = statSync(full);
	if (!stat.isFile()) throw new Error(t("errorNotAFile"));
	if (stat.size > MAX_FILE_SIZE) throw new Error(t("errorFileTooLarge"));

	const buffer = readFileSync(full);
	const binary = buffer.includes(0);
	const language = LANGUAGES[extname(full).toLowerCase()] ?? "text";

	return {
		path: inside.split(sep).join("/"),
		name: basename(full),
		content: binary ? "" : buffer.toString("utf8"),
		language,
		size: stat.size,
		binary,
	};
}
