import type { en } from "./locales/en";

export type MessageKey = keyof typeof en;

/** Every locale must provide the exact same keys as English. */
export type Messages = Record<MessageKey, string>;
