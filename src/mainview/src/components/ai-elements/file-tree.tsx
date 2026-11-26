// 基于 shadcn/ui 的 Collapsible + Button 实现，结构对齐 AI Elements 的 File Tree。
import { ChevronRight, File, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type FileTreeNode =
	| { type: "file"; name: string; path: string; size?: number }
	| { type: "folder"; name: string; path: string; children: FileTreeNode[] };

type FileTreeProps = {
	nodes: FileTreeNode[];
	selected: string;
	onSelect: (path: string) => void;
	className?: string;
};

export function FileTree({ nodes, selected, onSelect, className }: FileTreeProps) {
	return (
		<div className={cn("flex w-full flex-col gap-0.5 text-xs", className)}>
			{nodes.map((node) => (
				<FileTreeNode key={node.path} node={node} selected={selected} onSelect={onSelect} depth={0} />
			))}
		</div>
	);
}

function FileTreeNode({
	node,
	selected,
	onSelect,
	depth,
}: {
	node: FileTreeNode;
	selected: string;
	onSelect: (path: string) => void;
	depth: number;
}) {
	if (node.type === "folder") {
		return (
			<Collapsible defaultOpen>
				<CollapsibleTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						className="w-full justify-start gap-1.5 px-2 font-normal text-muted-foreground [&[data-state=open]>svg:first-child]:rotate-90"
						style={{ paddingInlineStart: `${8 + depth * 12}px` }}
					>
						<ChevronRight className="size-3.5 shrink-0 transition-transform" aria-hidden />
						<Folder className="size-3.5 shrink-0" aria-hidden />
						<span className="truncate">{node.name}</span>
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent>
					<div className="flex flex-col gap-0.5">
						{node.children.map((child) => (
							<FileTreeNode
								key={child.path}
								node={child}
								selected={selected}
								onSelect={onSelect}
								depth={depth + 1}
							/>
						))}
					</div>
				</CollapsibleContent>
			</Collapsible>
		);
	}

	const active = selected === node.path;
	return (
		<Button
			variant="ghost"
			size="sm"
			className={cn(
				"w-full justify-start gap-1.5 px-2 font-normal",
				active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
			)}
			style={{ paddingInlineStart: `${8 + depth * 12}px` }}
			aria-current={active ? "true" : undefined}
			title={node.path}
			onClick={() => onSelect(node.path)}
		>
			<File className="size-3.5 shrink-0" aria-hidden />
			<span className="truncate">{node.name}</span>
		</Button>
	);
}
