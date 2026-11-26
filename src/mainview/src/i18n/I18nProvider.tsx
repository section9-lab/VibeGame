import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createTranslator, localeDir, localeTag, setCurrentLocale, type Locale, type Translator } from "./index";

type I18nContextValue = {
	locale: Locale;
	dir: "ltr" | "rtl";
	t: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
	const value = useMemo<I18nContextValue>(
		() => ({ locale, dir: localeDir(locale), t: createTranslator(locale) }),
		[locale],
	);

	useEffect(() => {
		setCurrentLocale(locale);
		document.documentElement.lang = localeTag(locale);
		document.documentElement.dir = localeDir(locale);
	}, [locale]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const value = useContext(I18nContext);
	if (!value) throw new Error("useI18n must be used inside <I18nProvider>");
	return value;
}
