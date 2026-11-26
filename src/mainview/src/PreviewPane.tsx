import { useState, type RefObject } from "react";
import { FileCode2, Gamepad2, Loader2, Play, RotateCcw, Square } from "lucide-react";
import type { Client } from "@/rpc";
import { ProjectFiles } from "@/ProjectFiles";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
	client: Client | null;
	projectId: string;
	fileRevision: number;
	iframeRef: RefObject<HTMLIFrameElement | null>;
	previewUrl: string | null;
	backend: "webgpu" | "webgl2" | null;
	version: number;
	applied: number;
	running: boolean;
	buildLog: string | null;
	previewError: string | null;
	building: boolean;
	onRun: () => void;
	onStop: () => void;
	onFixError: (message: string) => void;
};

export function PreviewPane({
	client,
	projectId,
	fileRevision,
	iframeRef,
	previewUrl,
	backend,
	version,
	applied,
	running,
	buildLog,
	previewError,
	building,
	onRun,
	onStop,
	onFixError,
}: Props) {
	const [tab, setTab] = useState<"game" | "files">("game");
	const { t } = useI18n();

	// Play builds current code first, so a previous build is not required.
	const canRun = Boolean(previewUrl) && !building;
	const stale = canRun && applied < version;

	const runLabel = running ? t("runRerun") : stale ? t("runVersion", { version }) : applied > 0 ? t("runAgain") : t("run");

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-card">
			<div className="flex h-10 shrink-0 items-center gap-1 border-b border-border/70 px-2">
				<div className="flex items-center gap-0.5" role="group" aria-label={t("previewTabGroup")}>
					<Button
						variant="ghost"
						size="sm"
						className={cn("gap-1.5", tab === "game" && "bg-accent text-accent-foreground")}
						aria-pressed={tab === "game"}
						onClick={() => setTab("game")}
					>
						<Gamepad2 className="size-3.5" />
						{t("previewTabGame")}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className={cn("gap-1.5", tab === "files" && "bg-accent text-accent-foreground")}
						aria-pressed={tab === "files"}
						onClick={() => setTab("files")}
					>
						<FileCode2 className="size-3.5" />
						{t("previewTabFiles")}
					</Button>
				</div>

				{backend && (
					<span
						className={cn(
							"ms-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
							backend === "webgpu"
								? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
								: "border-amber-500/30 bg-amber-500/10 text-amber-500",
						)}
						title={
							backend === "webgpu"
								? "WebGPU renderer"
								: "WebGPU unavailable — using the WebGL2 fallback"
						}
					>
						{backend === "webgpu" ? "WebGPU" : "WebGL2"}
					</span>
				)}

				<div className="ms-auto flex items-center gap-1.5">
					<Button
						size="sm"
						variant={stale ? "default" : "secondary"}
						className="gap-1.5"
						disabled={!canRun}
						onClick={onRun}
						aria-busy={building}
						title={running ? t("runTooltipRunning") : t("runTooltipIdle")}
					>
						{building ? (
							<Loader2 className="size-3.5 animate-spin" />
						) : running ? (
							<RotateCcw className="size-3.5" />
						) : (
							<Play className="size-3.5" />
						)}
						{building ? t("previewBuilding") : runLabel}
					</Button>
					{running && (
						<Button
							size="icon-sm"
							variant="ghost"
							onClick={onStop}
							title={t("stopGame")}
							aria-label={t("stopGame")}
						>
							<Square className="size-3" />
						</Button>
					)}
				</div>
			</div>

			<div className="relative min-h-0 flex-1 overflow-hidden bg-neutral-950">
				<div className={cn("absolute inset-0", tab !== "game" && "invisible")}>
					<iframe
						ref={iframeRef}
						title={t("previewFrameTitle")}
						className="size-full border-0 bg-neutral-950"
						allow="fullscreen"
					/>
					{!running && (
						<div className="absolute inset-0 grid place-items-center bg-stage">
							<div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
								<span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
									<Gamepad2 className="size-6" />
								</span>
								<div>
									<div className="text-sm font-medium">{version > 0 ? t("previewBuiltTitle") : t("previewPendingTitle")}</div>
									<p className="mt-1 text-xs text-muted-foreground">
										{version > 0 ? t("previewBuiltHint") : t("previewBuildHint")}
									</p>
								</div>
								<Button className="gap-1.5" disabled={!canRun} onClick={onRun} aria-busy={building}>
									{building ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
									{building ? t("previewBuilding") : t("runGame")}
								</Button>
								{version > 0 && (
									<p className="text-[11px] text-muted-foreground">{t("keyboardHint")}</p>
								)}
							</div>
						</div>
					)}
				</div>

				{tab === "files" && (
					<div className="absolute inset-0 bg-stage">
						<ProjectFiles client={client} projectId={projectId} revision={fileRevision} />
					</div>
				)}
			</div>

			{tab === "game" && (buildLog || previewError) && (
				<div className="shrink-0 border-t border-border/70 p-2">
					{buildLog && (
						<pre className="max-h-32 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
							{buildLog}
						</pre>
					)}
					{previewError && (
						<div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2">
							<pre className="max-h-32 flex-1 overflow-auto text-[11px] text-destructive-foreground">
								{previewError.slice(0, 600)}
							</pre>
							<Button
								size="xs"
								variant="outline"
								onClick={() => onFixError(previewError.slice(0, 2000))}
							>
								{t("fixWithEngine")}
							</Button>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
