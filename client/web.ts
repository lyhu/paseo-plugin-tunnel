import { Linking, Platform } from "react-native";

const PROJECT_URL = "https://github.com/lyhu/paseo-plugin-tunnel";
const APP_SETTINGS_KEY = "@paseo:app-settings";

// Paseo's plugin compiler omits the DOM lib, so this module declares the minimal
// browser shapes it touches. Every export is gated on Platform.OS === "web";
// native runtimes take the alternative path instead.
type BrowserWindow = {
  open(url: string, target?: string, features?: string): unknown;
};
type BrowserNavigator = {
  language?: string;
  languages?: readonly string[];
};
type BrowserStorage = {
  getItem(key: string): string | null;
};

function browserWindow(): BrowserWindow | null {
  if (Platform.OS !== "web") return null;
  return (globalThis as { window?: BrowserWindow }).window ?? null;
}

/** System language preferences, or null when the client is not a browser. */
export function webSystemLanguages(): readonly string[] | null {
  if (Platform.OS !== "web") return null;
  const navigator = (globalThis as { navigator?: BrowserNavigator }).navigator;
  if (!navigator) return null;
  const languages = navigator.languages;
  if (languages && languages.length > 0) return languages;
  return navigator.language ? [navigator.language] : null;
}

/**
 * Raw stored app settings, `null` when the browser has no stored value, and
 * `undefined` when the client is not a browser at all.
 */
export function webStoredAppSettings(): string | null | undefined {
  if (Platform.OS !== "web") return undefined;
  const storage = (globalThis as { localStorage?: BrowserStorage })
    .localStorage;
  return storage?.getItem(APP_SETTINGS_KEY) ?? null;
}

export async function openProjectRepository(): Promise<void> {
  if (Platform.OS === "web") {
    // Paseo's Electron preload delegates to shell.openExternal on this device.
    const desktop = (
      globalThis as typeof globalThis & {
        paseoDesktop?: {
          opener?: { openUrl?: (url: string) => Promise<void> };
        };
      }
    ).paseoDesktop;
    if (desktop?.opener?.openUrl) {
      await desktop.opener.openUrl(PROJECT_URL);
      return;
    }
    browserWindow()?.open(PROJECT_URL, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(PROJECT_URL);
}
