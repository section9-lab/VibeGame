// 一格一快照。粒度是格，不是轮次，因为一轮会有很多格。
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const gameFile = (projectDir: string) => join(projectDir, "src", "game.ts");
const snapshotDir = (projectDir: string) => join(projectDir, ".snapshots");

export function takeSnapshot(projectDir: string, cell: number): void {
	const source = gameFile(projectDir);
	if (!existsSync(source)) return;
	mkdirSync(snapshotDir(projectDir), { recursive: true });
	const name = `${String(cell).padStart(4, "0")}-${Date.now()}.ts`;
	copyFileSync(source, join(snapshotDir(projectDir), name));
}

export function listSnapshots(projectDir: string): string[] {
	const dir = snapshotDir(projectDir);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".ts"))
		.sort();
}

export function restoreSnapshot(projectDir: string, name: string): boolean {
	const source = join(snapshotDir(projectDir), name);
	if (!existsSync(source)) return false;
	copyFileSync(source, gameFile(projectDir));
	return true;
}
