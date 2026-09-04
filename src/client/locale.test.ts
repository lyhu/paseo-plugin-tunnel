import { expect, test } from "vitest";
import { messages } from "./messages.shared";
import { resolveLocale } from "./locale.shared";

test("all nine locales have identical keys and interpolation variables", () => {
  const keys = Object.keys(messages.en).sort();
  expect(Object.keys(messages)).toHaveLength(9);
  for (const locale of Object.values(messages)) {
    expect(Object.keys(locale).sort()).toEqual(keys);
    for (const key of keys as (keyof typeof messages.en)[]) {
      expect(locale[key].length).toBeGreaterThan(0);
      expect(locale[key].match(/{{\w+}}/g) ?? []).toEqual(
        messages.en[key].match(/{{\w+}}/g) ?? [],
      );
    }
  }
});
test("matches Paseo supported system language mapping", () => {
  for (const [input, expected] of [
    ["zh-TW", "en"],
    ["zh-Hans-SG", "zh-CN"],
    ["fr-CA", "fr"],
    ["pt", "pt-BR"],
    ["pt-BR", "pt-BR"],
    ["pt-PT", "en"],
    ["de", "en"],
    ["ar-SA", "ar"],
    ["constructor", "en"],
  ]) {
    expect(resolveLocale(input)).toBe(expected);
  }
});

test("uses the first supported system language", () => {
  expect(resolveLocale("de-DE", "zh-TW", "fr-CA", "en")).toBe("fr");
});
