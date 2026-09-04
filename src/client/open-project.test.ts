import { afterEach, expect, test, vi } from "vitest";
const { platform, openURL } = vi.hoisted(() => ({
  platform: { OS: "web" },
  openURL: vi.fn(async () => {}),
}));
vi.mock("react-native", () => ({ Platform: platform, Linking: { openURL } }));
import { openProjectRepository } from "./open-project.client";
const url = "https://github.com/lyhu/paseo-plugin-tunnel";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  platform.OS = "web";
});

test("desktop uses the local OS opener, never a Paseo browser window", async () => {
  const openUrl = vi.fn(async () => {});
  const open = vi.fn();
  vi.stubGlobal("paseoDesktop", { opener: { openUrl } });
  vi.stubGlobal("window", { open });
  await openProjectRepository();
  expect(openUrl).toHaveBeenCalledWith(url);
  expect(open).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
});
test("normal browsers open a protected external tab", async () => {
  const open = vi.fn();
  vi.stubGlobal("window", { open });
  await openProjectRepository();
  expect(open).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");
});
test("mobile delegates to the device URL handler", async () => {
  platform.OS = "ios";
  await openProjectRepository();
  expect(openURL).toHaveBeenCalledWith(url);
});
