import { CheckIcon, CircleSlashIcon, ClockIcon, Loader2Icon, XIcon } from "lucide-react";
import { CodeBlock, CodeBlockContent } from "@/components/ui/code-block";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@/components/ui/trace";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n";

export type TerminalState = "running" | "waiting" | "done" | "error" | "interrupted";

type Props = {
	title: string;
	code?: string;
	output?: string;
	error?: string | null;
	state?: TerminalState;
	durationMs?: number;
	streaming?: boolean;
	open?: boolean;
};

const STATE_LABEL: Record<TerminalState, MessageKey> = {
	running: "stateRunning",
	waiting: "stateWaiting",
	done: "stateDone",
	error: "stateError",
	interrupted: "stateInterrupted",
};

function formatDuration(ms: number) {
	if (!Number.isFinite(ms) || ms <= 0) return "";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

export function Terminal({ title, code, output, error, state, durationMs, streaming, open = true }: Props) {
	const { t } = useI18n();
	const effective: TerminalState = state ?? (streaming ? "running" : error ? "error" : "done");
	const status = effective === "running" || streaming ? "running" : effective === "error" ? "error" : undefined;
	const icon =
		effective === "running" || streaming ? (
			<Loader2Icon className="animate-spin" />
		) : effective === "waiting" ? (
			<ClockIcon />
		) : effective === "error" ? (
			<XIcon />
		) : effective === "interrupted" ? (
			<CircleSlashIcon />
		) : (
			<CheckIcon />
		);
	return (
		<Trace className="min-w-0">
			<TraceCollapsible defaultOpen={open}>
				<TraceCollapsibleTrigger>
					<TraceLine status={status}>
						<TraceIcon>{icon}</TraceIcon>
						<TraceTitle>{title}</TraceTitle>
						<TraceDescription>
							{streaming && !state ? t("stateStreaming") : t(STATE_LABEL[effective])}
							{durationMs ? ` · ${formatDuration(durationMs)}` : ""}
						</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<div className="grid gap-2 pt-1">
						{code && (
							<CodeBlock size="sm" className="max-w-full">
								<CodeBlockContent wrap lineNumbers className="max-h-72">
									{code}
								</CodeBlockContent>
							</CodeBlock>
						)}
						{output && (
							<pre dir="ltr" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-secondary/50 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
								{output}
							</pre>
						)}
						{error && (
							<pre dir="ltr" className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-destructive/40 bg-destructive/10 p-2.5 font-mono text-[11px] leading-relaxed text-destructive-foreground">
								{error}
							</pre>
						)}
					</div>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}
