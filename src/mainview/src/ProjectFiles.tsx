import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import type { Client, ProjectFileContent, ProjectFileNode } from "@/rpc";
import { FileTree, type FileTreeNode } from "@/components/ai-elements/file-tree";
import { Button } from "@/components/ui/button";
import { useHighlightedCode } from "@/hooks/use-highlighted-code";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
	client: Client | null;
	projectId: string;
	/** 每次构建后 +1，用来刷新文件列表和当前文件内容。 */
	revision: number;
};

const DEFAULT_FILE = "src/game.ts";
const MAX_RENDERED_LINES = 5000;

export function ProjectFiles({ client, projectId, revision }: Props) {
	const { t } = useI18n();
	const [dir, setDir] = useState("");
	const [nodes, setNodes] = useState<ProjectFileNode[]>([]);
	const [selected, setSelected] = useState("");
	const [file, setFile] = useState<ProjectFileContent | null>(null);
	const [loadingList, setLoadingList] = useState(false);
	const [loadingFile, setLoadingFile] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [reload, setReload] = useState(0);

	// 切项目时先清掉旧项目的内容，避免闪一下上一个项目的文件。
	useEffect(() => {
		setNodes([]);
		setSelected("");
		setFile(null);
		setError(null);
	}, [projectId]);

	useEffect(() => {
		if (!client) return;
		let cancelled = false;
		setLoadingList(true);
		setError(null);
		client
			.listFiles()
			.then((result) => {
				if (cancelled) return;
				if (!result.ok) {
					setError(result.error);
					return;
				}
				setDir(result.dir);
				setNodes(result.files);
				setSelected((prev) => {
					if (prev && hasFile(result.files, prev)) return prev;
					return defaultFile(result.files);
				});
			})
			.catch((cause) => {
				if (!cancelled) setError(String((cause as Error)?.message ?? cause));
			})
			.finally(() => {
				if (!cancelled) setLoadingList(false);
			});
		return () => {
			cancelled = true;
		};
	}, [client, projectId, revision, reload]);

	useEffect(() => {
		if (!client || !selected) return;
		let cancelled = false;
		setLoadingFile(true);
		setError(null);
		client
			.readFile(selected)
			.then((result) => {
				if (cancelled) return;
				if (!result.ok) {
					setFile(null);
					setError(result.error);
					return;
				}
				setFile(result.file);
			})
			.catch((cause) => {
				if (!cancelled) setError(String((cause as Error)?.message ?? cause));
			})
			.finally(() => {
				if (!cancelled) setLoadingFile(false);
			});
		return () => {
			cancelled = true;
		};
	}, [client, selected, revision, reload]);

	const tree = useMemo(() => toTreeNodes(nodes), [nodes]);

	return (
		<div className="flex h-full min-h-0">
			<aside className="flex w-52 shrink-0 flex-col border-e border-border/70 bg-secondary/10">
				<div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-2 py-1.5">
					<span className="text-xs font-medium">{t("filesTitle")}</span>
					<Button
						variant="ghost"
						size="icon-xs"
						className="ms-auto"
						onClick={() => setReload((value) => value + 1)}
						title={t("filesRefresh")}
						aria-label={t("filesRefresh")}
					>
						<RefreshCw className={cn("size-3.5", loadingList && "animate-spin")} />
					</Button>
				</div>

				<div className="min-h-0 flex-1 overflow-auto p-1.5">
					{loadingList && !nodes.length ? (
						<div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
							<Loader2 className="size-3.5 animate-spin" /> {t("filesLoading")}
						</div>
					) : tree.length ? (
						<FileTree nodes={tree} selected={selected} onSelect={setSelected} />
					) : (
						<div className="px-2 py-3 text-xs text-muted-foreground">{t("filesEmpty")}</div>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1 border-t border-border/70 px-2 py-1.5">
					<div className="min-w-0 flex-1">
						<div className="text-[10px] text-muted-foreground">{t("filesDirLabel")}</div>
						<div className="truncate font-mono text-[10px]" title={dir || undefined}>
							{dir ? shortDir(dir) : t("filesDirFallback")}
						</div>
					</div>
					{dir && <CopyButton value={dir} label={t("filesCopyDir")} />}
				</div>
			</aside>

			<section className="flex min-w-0 flex-1 flex-col">
				<header className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3 text-xs text-muted-foreground">
					<span className="min-w-0 truncate font-mono text-foreground" title={file?.path}>
						{selected || t("filesPickFile")}
					</span>
					{file && (
						<span className="shrink-0">
							{file.language} · {formatSize(file.size)}
						</span>
					)}
					{file && <CopyButton value={file.content} label={t("filesCopyContent")} />}
				</header>

				<div className="relative min-h-0 flex-1 overflow-auto">
					{loadingFile && (
						<div className="absolute inset-0 z-10 grid place-items-center bg-background/70 text-xs text-muted-foreground backdrop-blur-[1px]">
							<span className="flex items-center gap-2">
								<Loader2 className="size-3.5 animate-spin" /> {t("filesReading")}
							</span>
						</div>
					)}
					{error ? (
						<div className="p-3 text-xs text-destructive-foreground">
							<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">{error}</div>
						</div>
					) : file?.binary ? (
						<div className="p-4 text-xs text-muted-foreground">{t("filesBinary")}</div>
					) : file ? (
						<CodeView code={file.content} language={file.language} />
					) : (
						<div className="p-4 text-xs text-muted-foreground">{t("filesPickHint")}</div>
					)}
				</div>
			</section>
		</div>
	);
}

function CodeView({ code, language }: { code: string; language: string }) {
	const { t } = useI18n();
	// 大文件不交给 Shiki 全量分词，否则像 three.webgpu.js 这种 1MB+ 文件会卡住界面。
	const { clipped, content, highlightLanguage } = useMemo(() => {
		const all = code.split("\n");
		const sliced = all.slice(0, MAX_RENDERED_LINES).join("\n");
		return {
			content: sliced,
			clipped: all.length > MAX_RENDERED_LINES,
			highlightLanguage: code.length > 300_000 ? "text" : language,
		};
	}, [code, language]);
	const shown = useHighlightedCode(content, highlightLanguage);

	return (
		<div className="min-w-max">
			<pre
				dir="ltr"
				tabIndex={0}
				className="min-h-full px-0 py-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
			>
				<code className="grid">
					{shown.map((line, index) => (
						<span key={index} className="grid grid-cols-[3.5rem_1fr] hover:bg-accent/40">
							<span className="select-none pe-3 text-end text-muted-foreground/60">{index + 1}</span>
							<span className="whitespace-pre pe-4">{line}</span>
						</span>
					))}
				</code>
			</pre>
			{clipped && (
				<div className="sticky bottom-0 border-t border-border bg-stage p-2 text-[11px] text-muted-foreground">
					{t("filesTruncated", { max: MAX_RENDERED_LINES })}
				</div>
			)}
		</div>
	);
}

function CopyButton({ value, label }: { value: string; label: string }) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);

	const copy = useCallback(() => {
		navigator.clipboard
			?.writeText(value)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1500);
			})
			.catch(() => {});
	}, [value]);

	return (
		<button
			type="button"
			onClick={copy}
			className="ms-auto flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent"
			title={label}
			aria-label={label}
		>
			{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
			{copied ? t("copied") : t("copy")}
		</button>
	);
}

function toTreeNodes(nodes: ProjectFileNode[]): FileTreeNode[] {
	return nodes.map((node) =>
		node.type === "folder"
			? { type: "folder", name: node.name, path: node.path, children: toTreeNodes(node.children) }
			: { type: "file", name: node.name, path: node.path, size: node.size },
	);
}

function hasFile(nodes: ProjectFileNode[], path: string): boolean {
	for (const node of nodes) {
		if (node.type === "file" && node.path === path) return true;
		if (node.type === "folder" && hasFile(node.children, path)) return true;
	}
	return false;
}

function defaultFile(nodes: ProjectFileNode[]): string {
	if (hasFile(nodes, DEFAULT_FILE)) return DEFAULT_FILE;
	return firstFile(nodes) ?? "";
}

function firstFile(nodes: ProjectFileNode[]): string | null {
	for (const node of nodes) {
		if (node.type === "file") return node.path;
		const nested = firstFile(node.children);
		if (nested) return nested;
	}
	return null;
}

function shortDir(dir: string): string {
	const parts = dir.split("/").filter(Boolean);
	return `…/${parts.slice(-2).join("/")}`;
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
