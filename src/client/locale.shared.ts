import { messages, type Locale } from "./messages.shared";

// Match Paseo's ordered system-language resolution, including its zh/pt variants.
export function resolveLocale(...languages: string[]): Locale {
  for (const language of languages) {
    if (Object.hasOwn(messages, language)) return language as Locale;
    const normalized = language.toLowerCase().replaceAll("_", "-");
    const base = normalized.split("-")[0];
    if (["ar", "en", "es", "fr", "ja", "ko", "ru"].includes(base))
      return base as Locale;
    if (
      normalized === "zh" ||
      normalized === "zh-cn" ||
      normalized.startsWith("zh-hans")
    )
      return "zh-CN";
    if (normalized === "pt-br" || normalized === "pt") return "pt-BR";
  }
  return "en";
}
