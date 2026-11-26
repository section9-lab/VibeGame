import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AuthEvent, AuthPrompt, Client } from "@/rpc";
import { useI18n } from "@/i18n/I18nProvider";

type Props = {
	open: boolean;
	providerId: string | null;
	providerName: string;
	prompt: AuthPrompt | null;
	event: AuthEvent | null;
	error: string | null;
	done: boolean;
	client: Client | null;
	onClose: () => void;
};

export function LoginDialog({ open, providerId, providerName, prompt, event, error, done, client, onClose }: Props) {
	const { t } = useI18n();
	const [value, setValue] = useState("");

	useEffect(() => {
		setValue("");
	}, [prompt, providerId]);

	const submit = (answer: string) => {
		if (!providerId) return;
		client?.send("authAnswer", { providerId, value: answer });
		setValue("");
	};

	const link = event?.url ?? event?.verificationUri;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("loginTitle", { provider: providerName })}</DialogTitle>
					<DialogDescription>
						{error ? t("loginFailed") : done ? t("loginSuccess") : t("loginHint")}
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">
						{error}
					</p>
				)}

				{event?.type === "auth_url" && (
					<div className="space-y-2 text-xs text-muted-foreground">
						<p>{t("loginOpenedBrowser")}</p>
						{link && (
							<button
								className="text-primary underline underline-offset-2"
								onClick={() => navigator.clipboard?.writeText(link)}
							>
								{link}
							</button>
						)}
					</div>
				)}

				{event?.type === "device_code" && (
					<div className="space-y-2 text-xs">
						<p className="text-muted-foreground">{t("loginEnterCode")}</p>
						<div className="flex items-center gap-2">
							<code dir="ltr" className="rounded-md border border-border bg-secondary px-3 py-1.5 text-sm tracking-widest">
								{event.userCode}
							</code>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => navigator.clipboard?.writeText(event.userCode ?? "")}
							>
								{t("copy")}
							</Button>
						</div>
						{event.verificationUri && <p className="text-muted-foreground">{event.verificationUri}</p>}
					</div>
				)}

				{event?.type === "progress" && <p className="text-xs text-muted-foreground">{event.message}</p>}

				{prompt?.type === "select" && (
					<div className="grid gap-1.5">
						<p className="text-xs text-muted-foreground">{prompt.message}</p>
						{prompt.options?.map((option) => (
							<Button
								key={option.id}
								variant="secondary"
								className="justify-start"
								onClick={() => submit(option.id)}
							>
								{option.label}
							</Button>
						))}
					</div>
				)}

				{prompt && prompt.type !== "select" && (
					<form
						className="grid gap-2"
						onSubmit={(e) => {
							e.preventDefault();
							submit(value);
						}}
					>
						<p className="text-xs text-muted-foreground">{prompt.message}</p>
						<Input
							autoFocus
							type={prompt.type === "secret" ? "password" : "text"}
							placeholder={prompt.placeholder}
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
						<Button type="submit" disabled={!value.trim()}>
							{t("continue")}
						</Button>
					</form>
				)}

				{!prompt && !event && !error && !done && (
					<p className="text-xs text-muted-foreground">{t("loginPreparing")}</p>
				)}

				<div className="flex justify-end gap-2 pt-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							client?.send("cancelLogin", {});
							onClose();
						}}
					>
						{done ? t("close") : t("cancel")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
