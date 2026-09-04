import { Linking, Platform } from "react-native";

const PROJECT_URL = "https://github.com/lyhu/paseo-plugin-tunnel";

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
    window.open(PROJECT_URL, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(PROJECT_URL);
}
