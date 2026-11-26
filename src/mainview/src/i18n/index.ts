import { ar } from "./locales/ar";
import { de } from "./locales/de";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { hi } from "./locales/hi";
import { ja } from "./locales/ja";
import { pt } from "./locales/pt";
import { ru } from "./locales/ru";
import { zh } from "./locales/zh";
import type { MessageKey, Messages } from "./types";

export type { MessageKey, Messages };

export type Locale = "en" | "zh" | "es" | "hi" | "ar" | "pt" | "ru" | "ja" | "fr" | "de";

export type LocaleInfo = {
	id: Locale;
	/** Native name, shown in the language picker. */
	label: string;
	/** BCP 47 tag used for <html lang> and Intl formatting. */
	tag: string;
	dir: "ltr" | "rtl";
};

export const LOCALES: LocaleInfo[] = [
	{ id: "en", label: "English", tag: "en-US", dir: "ltr" },
	{ id: "zh", label: "简体中文", tag: "zh-CN", dir: "ltr" },
	{ id: "es", label: "Español", tag: "es-ES", dir: "ltr" },
	{ id: "hi", label: "हिन्दी", tag: "hi-IN", dir: "ltr" },
	{ id: "ar", label: "العربية", tag: "ar", dir: "rtl" },
	{ id: "pt", label: "Português", tag: "pt-BR", dir: "ltr" },
	{ id: "ru", label: "Русский", tag: "ru-RU", dir: "ltr" },
	{ id: "ja", label: "日本語", tag: "ja-JP", dir: "ltr" },
	{ id: "fr", label: "Français", tag: "fr-FR", dir: "ltr" },
	{ id: "de", label: "Deutsch", tag: "de-DE", dir: "ltr" },
];

export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, Messages> = { en, zh, es, hi, ar, pt, ru, ja, fr, de };

const BY_ID = new Map<string, Locale>(LOCALES.map((entry) => [entry.id, entry.id]));

/** Maps free-form tags ("zh-Hans-CN", "pt_BR", "EN") and language subtags to a supported locale. */
export function normalizeLocale(value: unknown): Locale | null {
	if (typeof value !== "string") return null;
	const raw = value.trim().toLowerCase().replace(/_/g, "-");
	if (!raw) return null;
	const exact = BY_ID.get(raw);
	if (exact) return exact;
	const base = raw.split("-")[0] ?? "";
	if (base === "zh") return "zh";
	if (base === "pt") return "pt";
	return BY_ID.get(base) ?? null;
}

/** System language, used the first time the app runs. */
export function detectLocale(): Locale {
	try {
		const resolved = Intl.DateTimeFormat().resolvedOptions().locale;
		const match = normalizeLocale(resolved);
		if (match) return match;
	} catch {
		// Ignore environments without Intl and fall through to env vars.
	}
	const env = typeof process !== "undefined" ? (process.env.VIBEGAME_LOCALE ?? process.env.LC_ALL ?? process.env.LANG) : "";
	return normalizeLocale(env) ?? DEFAULT_LOCALE;
}

export function localeInfo(locale: Locale): LocaleInfo {
	return LOCALES.find((entry) => entry.id === locale) ?? LOCALES[0]!;
}

export function localeDir(locale: Locale): "ltr" | "rtl" {
	return localeInfo(locale).dir;
}

export function localeTag(locale: Locale): string {
	return localeInfo(locale).tag;
}

/** Translate with an explicit locale. Pure, safe to call from anywhere. */
export function translate(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
	const dictionary = DICTIONARIES[locale] ?? en;
	let text: string = dictionary[key] ?? en[key];
	if (params) {
		for (const [name, value] of Object.entries(params)) {
			text = text.split(`{${name}}`).join(String(value));
		}
	}
	return text;
}

export type Translator = (key: MessageKey, params?: Record<string, string | number>) => string;

export function createTranslator(locale: Locale): Translator {
	return (key, params) => translate(locale, key, params);
}

// Module-level locale for non-React code (RPC helpers, main process).
let currentLocale: Locale = DEFAULT_LOCALE;

export function setCurrentLocale(locale: Locale): void {
	currentLocale = locale;
}

export function getCurrentLocale(): Locale {
	return currentLocale;
}

/** Translate using the process-wide locale. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
	return translate(currentLocale, key, params);
}
