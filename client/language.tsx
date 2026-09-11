import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { NativeModules } from "react-native";
import { messages, type Locale, type MessageKey } from "../shared/messages";
import { resolveLocale } from "../shared/locale";
import { webStoredAppSettings, webSystemLanguages } from "./web";

const LanguageContext = createContext<Locale>("en");

function systemLocale(): Locale {
  const webLanguages = webSystemLanguages();
  if (webLanguages) return resolveLocale(...webLanguages);
  const languages: unknown =
    NativeModules.SettingsManager?.settings?.AppleLanguages;
  if (
    Array.isArray(languages) &&
    languages.every((value) => typeof value === "string")
  )
    return resolveLocale(...languages);
  return resolveLocale(
    NativeModules.I18nManager?.localeIdentifier ??
      Intl.DateTimeFormat().resolvedOptions().locale,
  );
}

async function readNativeAppSettings(): Promise<string | null> {
  type Storage = {
    getConstants: () => Record<string, unknown>;
    multiGet: (
      keys: string[],
      callback: (errors: unknown, values: [string, string | null][]) => void,
    ) => void;
  };
  const storage = [
    "PlatformLocalStorage",
    "RNC_AsyncSQLiteDBStorage",
    "RNCAsyncStorage",
    "AsyncSQLiteDBStorage",
    "AsyncLocalStorage",
  ]
    .map((name) => NativeModules[name] as Storage | undefined)
    .find(Boolean);
  if (!storage) return null;
  return new Promise<string | null>((resolve) => {
    storage.multiGet(["@paseo:app-settings"], (errors, values) =>
      resolve(errors ? null : (values?.[0]?.[1] ?? null)),
    );
  });
}

async function readLocale(): Promise<Locale> {
  // COMPAT(paseo-language): SDK 0.8 exposes no locale API. Replace this read-only
  // storage adapter when the host exposes locale; review after 2026-12-01.
  const stored = webStoredAppSettings();
  const raw = stored === undefined ? await readNativeAppSettings() : stored;
  const language: unknown = raw ? JSON.parse(raw).language : null;
  return typeof language === "string" && language !== "system"
    ? resolveLocale(language)
    : systemLocale();
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState(systemLocale);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await readLocale();
        if (active) setLocale(next);
      } catch {
        /* Storage may be unavailable in restricted browser contexts. */
      }
    };
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <LanguageContext.Provider value={locale}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useTranslation() {
  const locale = useContext(LanguageContext);
  return (key: MessageKey, values: Record<string, string | number> = {}) =>
    Object.entries(values).reduce(
      (result, [name, value]) =>
        result.replaceAll(`{{${name}}}`, String(value)),
      messages[locale][key] as string,
    );
}
