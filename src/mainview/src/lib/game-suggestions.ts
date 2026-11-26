import { Coins, Crosshair, Footprints, Orbit, Swords, type LucideIcon } from "lucide-react";
import type { Translator } from "@/i18n";

export const SUGGESTION_TONES = [
	"from-amber-500/20",
	"from-sky-500/20",
	"from-rose-500/20",
	"from-emerald-500/20",
	"from-fuchsia-500/20",
] as const;

export type GameSuggestion = {
	id: string;
	title: string;
	prompt: string;
	tone: (typeof SUGGESTION_TONES)[number];
	icon: LucideIcon;
};

/**
 * 新建项目、还没有任何对话时展示的起点。
 * title 只用于按钮/卡片，prompt 才是真正发给引擎的消息。
 */
export function gameSuggestions(t: Translator): GameSuggestion[] {
	return [
		{
			id: "auto-chess",
			title: t("suggestAutoChessTitle"),
			prompt: t("suggestAutoChessPrompt"),
			tone: SUGGESTION_TONES[0],
			icon: Swords,
		},
		{
			id: "parkour",
			title: t("suggestParkourTitle"),
			prompt: t("suggestParkourPrompt"),
			tone: SUGGESTION_TONES[1],
			icon: Footprints,
		},
		{
			id: "shooter",
			title: t("suggestShooterTitle"),
			prompt: t("suggestShooterPrompt"),
			tone: SUGGESTION_TONES[2],
			icon: Crosshair,
		},
		{
			id: "collect",
			title: t("suggestCollectTitle"),
			prompt: t("suggestCollectPrompt"),
			tone: SUGGESTION_TONES[3],
			icon: Coins,
		},
		{
			id: "bounce",
			title: t("suggestBounceTitle"),
			prompt: t("suggestBouncePrompt"),
			tone: SUGGESTION_TONES[4],
			icon: Orbit,
		},
	];
}
