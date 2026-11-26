import type { Translator } from "@/i18n";
import type { ProjectRef } from "@/rpc";

// 建项目时写入的是机器名（"游戏 10"），autoName 还没被模型或用户改掉之前，界面一律显示“未命名”，
// 避免把占位内容当成项目真名。
export function projectDisplayName(project: Pick<ProjectRef, "name" | "autoName">, t: Translator): string {
	const name = project.name.trim();
	if (project.autoName === true || !name) return t("projectUntitled");
	return name;
}

/** 还没起好名 / 还没生成图标，用来给出“自动生成中”的提示。 */
export function projectPendingName(project: Pick<ProjectRef, "autoName">): boolean {
	return project.autoName === true;
}
