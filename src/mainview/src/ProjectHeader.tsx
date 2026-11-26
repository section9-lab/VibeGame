import { useState, type FormEvent } from "react";
import { Gamepad2, MoreHorizontal, Pencil, Rocket, Trash2 } from "lucide-react";
import type { ProjectRef } from "@/rpc";
import { useI18n } from "@/i18n/I18nProvider";
import { projectDisplayName, projectPendingName } from "@/lib/project-name";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

type Props = {
	project: ProjectRef | null;
	lastProject: boolean;
	onDelete: (id: string) => void;
	onRename: (id: string, name: string) => void;
};

// 项目级操作（发布/重命名/删除）集中在这一条里；左侧 Rail 只负责切换。
export function ProjectHeader({ project, lastProject, onDelete, onRename }: Props) {
	const { t } = useI18n();
	const [confirming, setConfirming] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [value, setValue] = useState("");

	if (!project) return null;

	const name = projectDisplayName(project, t);
	const pending = projectPendingName(project);

	const openRename = () => {
		setValue(pending ? "" : project.name);
		setRenaming(true);
	};

	const submitRename = (event: FormEvent) => {
		event.preventDefault();
		const next = value.trim();
		if (!next) return;
		onRename(project.id, next);
		setRenaming(false);
	};

	return (
		<>
			<div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/70 px-2">
				{project.iconSvg ? (
					<img
						src={`data:image/svg+xml;utf8,${encodeURIComponent(project.iconSvg)}`}
						alt=""
						className="size-5 shrink-0 rounded"
						draggable={false}
					/>
				) : (
					<span className="grid size-5 shrink-0 place-items-center rounded border border-dashed border-border/80">
						<Gamepad2 className="size-3 text-muted-foreground/60" aria-hidden />
					</span>
				)}
				<span
					className={pending ? "truncate text-xs text-muted-foreground" : "truncate text-xs font-medium"}
					title={pending ? t("projectNameHint") : name}
				>
					{name}
				</span>

				<div className="ms-auto flex shrink-0 items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						disabled
						title={t("comingSoonTitle")}
						aria-label={t("publishAria")}
						className="gap-1.5"
					>
						<Rocket className="size-3.5" aria-hidden />
						{t("publish")}
						<span className="rounded bg-muted px-1 py-px text-[10px] font-normal text-muted-foreground">
							{t("comingSoonBadge")}
						</span>
					</Button>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon-sm" title={t("projectActions")} aria-label={t("projectActions")}>
								<MoreHorizontal className="size-4" aria-hidden />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							<DropdownMenuItem onSelect={openRename}>
								<Pencil className="size-4" aria-hidden />
								{t("projectRename")}
							</DropdownMenuItem>
							<DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
								<Trash2 className="size-4" aria-hidden />
								{t("deleteProjectMenu")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<Dialog open={renaming} onOpenChange={setRenaming}>
				<DialogContent>
					<form onSubmit={submitRename} className="grid gap-4">
						<DialogHeader>
							<DialogTitle>{t("projectRenameTitle")}</DialogTitle>
							<DialogDescription>{t("projectRenameHint")}</DialogDescription>
						</DialogHeader>
						<Input
							autoFocus
							value={value}
							maxLength={40}
							placeholder={t("projectUntitled")}
							onChange={(event) => setValue(event.target.value)}
							aria-label={t("projectRenameTitle")}
						/>
						<DialogFooter>
							<Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
								{t("cancel")}
							</Button>
							<Button type="submit" size="sm" disabled={!value.trim()}>
								{t("projectSave")}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>

			<Dialog open={confirming} onOpenChange={setConfirming}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("deleteProjectTitle", { name })}</DialogTitle>
						<DialogDescription>
							{t("deleteProjectHint")}
							{lastProject && t("deleteLastHint")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="ghost" size="sm" autoFocus onClick={() => setConfirming(false)}>
							{t("cancel")}
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={() => {
								onDelete(project.id);
								setConfirming(false);
							}}
						>
							{t("deleteProjectConfirm")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
