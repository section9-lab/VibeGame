// 项目索引和每个项目的目录。不建数据库，事件写 JSONL，切换项目时回放。
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../../mainview/src/i18n";

export type Project = {
	id: string;
	name: string;
	createdAt: number;
	/** 名字还是建项目时自动填的（等模型起名）。手动改名或模型起好名后置为 false。 */
	autoName?: boolean;
	icon?: string;
	iconSvg?: string;
};
export type ProjectIndex = { activeId: string | null; projects: Project[] };

export const projectsRoot = (appDir: string) => join(appDir, "projects");
export const projectDir = (appDir: string, id: string) => join(projectsRoot(appDir), id);

// 引擎文件由应用维护，用户和模型只改 src/game.ts。模板升级时覆盖这些文件；
// 版本号写在 engine.ts 第一行，升级引擎时递增，避免每次启动都复制 vendor。
const ENGINE_VERSION = "5";
const ENGINE_VERSION_MARKER = `// engine-version: ${ENGINE_VERSION}`;
const ENGINE_FILES = ["src/engine.ts", "src/main.ts", "index.html", "AGENTS.md"] as const;

export function syncProjectTemplate(appDir: string, templateDir: string, id: string): boolean {
	const dir = projectDir(appDir, id);
	if (!existsSync(join(dir, "src", "game.ts"))) return false;

	// 旧模板会生成 CLAUDE.md；现在统一只保留 AGENTS.md。
	try {
		rmSync(join(dir, "CLAUDE.md"), { force: true });
	} catch {}

	let current = "";
	try {
		current = readFileSync(join(dir, "src", "engine.ts"), "utf8");
	} catch {}
	if (
		current.includes(ENGINE_VERSION_MARKER) &&
		existsSync(join(dir, "vendor", "three.webgpu.js")) &&
		existsSync(join(dir, "AGENTS.md"))
	) {
		return false;
	}

	for (const rel of ENGINE_FILES) {
		const src = join(templateDir, rel);
		if (existsSync(src)) cpSync(src, join(dir, rel));
	}

	const vendorSrc = join(templateDir, "vendor");
	if (existsSync(vendorSrc)) {
		rmSync(join(dir, "vendor"), { recursive: true, force: true });
		cpSync(vendorSrc, join(dir, "vendor"), { recursive: true });
	}

	return true;
}

export function loadIndex(appDir: string): ProjectIndex {
	const path = join(appDir, "projects.json");
	if (!existsSync(path)) return { activeId: null, projects: [] };
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return { activeId: null, projects: [] };
	}
}

export function saveIndex(appDir: string, index: ProjectIndex): void {
	mkdirSync(appDir, { recursive: true });
	writeFileSync(join(appDir, "projects.json"), JSON.stringify(index, null, 2));
}

export function createProject(appDir: string, templateDir: string, name: string): Project {
	const id = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
	const project: Project = { id, name: name.trim() || t("projectUntitled"), createdAt: Date.now(), autoName: true };
	const dir = projectDir(appDir, id);
	mkdirSync(dir, { recursive: true });
	cpSync(templateDir, dir, { recursive: true });
	const index = loadIndex(appDir);
	index.projects.push(project);
	index.activeId = id;
	saveIndex(appDir, index);
	return project;
}

export function deleteProject(appDir: string, id: string): ProjectIndex {
	const index = loadIndex(appDir);
	index.projects = index.projects.filter((project) => project.id !== id);
	if (index.activeId === id) index.activeId = index.projects[0]?.id ?? null;
	saveIndex(appDir, index);
	try {
		rmSync(projectDir(appDir, id), { recursive: true, force: true });
	} catch {}
	return index;
}

export function appendEvent(appDir: string, id: string, event: unknown): void {
	try {
		const dir = projectDir(appDir, id);
		mkdirSync(dir, { recursive: true });
		appendFileSync(join(dir, "events.jsonl"), JSON.stringify(event) + "\n");
	} catch {}
}

export function readEvents(appDir: string, id: string): any[] {
	const path = join(projectDir(appDir, id), "events.jsonl");
	if (!existsSync(path)) return [];
	const events: any[] = [];
	for (const line of readFileSync(path, "utf8").split("\n")) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
		} catch {}
	}
	return events;
}

export function ensureProject(appDir: string, templateDir: string, index: ProjectIndex): { index: ProjectIndex; project: Project } {
	if (!index.projects.length) {
		const project = createProject(appDir, templateDir, t("projectFirst"));
		return { index: loadIndex(appDir), project };
	}
	const project = index.projects.find((entry) => entry.id === index.activeId) ?? index.projects[0]!;
	if (index.activeId !== project.id) {
		index.activeId = project.id;
		saveIndex(appDir, index);
	}
	const dir = projectDir(appDir, project.id);
	if (!existsSync(join(dir, "src", "game.ts"))) cpSync(templateDir, dir, { recursive: true });
	return { index, project };
}
