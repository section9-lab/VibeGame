// 思考过程展示。结构对齐 shadcn AI Elements 的 Reasoning。
// 流式时展开并自动滚到最新文字；结束后保持展开，由用户手动收起（自动收起会让思考“消失”）。
import { useEffect, useRef, useState } from "react";
import { BrainIcon, ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/utils";

type Props = {
	text: string;
	streaming?: boolean;
	defaultOpen?: boolean;
	className?: string;
};

export function Reasoning({ text, streaming = false, defaultOpen, className }: Props) {
	const { t } = useI18n();
	const [open, setOpen] = useState(defaultOpen ?? streaming);
	const bodyRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (streaming) setOpen(true);
	}, [streaming]);

	// 思考文字会一直变长；滚动条要跟着新文字走，否则最新内容永远在框外（看起来像“断字”）。
	useEffect(() => {
		if (!streaming) return;
		const el = bodyRef.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [text, streaming]);

	return (
		<Collapsible open={open} onOpenChange={setOpen} className={cn("min-w-0", className)}>
			<CollapsibleTrigger className="flex w-full items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
				<BrainIcon className="size-3.5 shrink-0" aria-hidden />
				<span>{streaming ? t("reasoningStreaming") : t("reasoningDone")}</span>
				<ChevronDownIcon
					className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
					aria-hidden
				/>
			</CollapsibleTrigger>
			{/* 只做收起动画：新挂载/流式增长时不要从 0 高度开始，否则会先把下方内容拽一下。 */}
			<CollapsibleContent className="overflow-hidden duration-200 data-closed:animate-collapsible-up">
				<div
					ref={bodyRef}
					className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap wrap-break-word border-l-2 border-border/70 pl-3 text-xs leading-relaxed text-muted-foreground"
				>
					{text}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
