import { expect, test, vi } from "vitest";

// The surface pulls in react-native and the host SDK; the wiring under test is the
// contribution contract, so stub the component and assert what Paseo validates.
vi.mock("./client/tunnel-view", () => ({ TunnelView: () => null }));

import contribute from "./index.client";
import type { PluginClientContext } from "@getpaseo/plugin/client";

// Paseo's own rule for contribution ids (packages/app/src/plugins/evaluate.ts).
const CONTRIBUTION_ID = /^[a-z][a-z0-9-]*$/;

interface Contribution {
  id: string;
  title: string;
  icon: string;
  surface: string;
}

function createClient() {
  const sidebarItems: Contribution[] = [];
  const surfaces: string[] = [];
  const context = {
    addSidebarItem(contribution: Contribution) {
      sidebarItems.push(contribution);
      return () => {
        const index = sidebarItems.indexOf(contribution);
        if (index !== -1) sidebarItems.splice(index, 1);
      };
    },
    addSurface(id: string, _Component: unknown) {
      surfaces.push(id);
      return () => {
        const index = surfaces.indexOf(id);
        if (index !== -1) surfaces.splice(index, 1);
      };
    },
  };
  return {
    context: context as unknown as PluginClientContext,
    sidebarItems,
    surfaces,
  };
}

test("contributes a sidebar item whose surface is registered", () => {
  const { context, sidebarItems, surfaces } = createClient();
  contribute(context);

  expect(sidebarItems).toHaveLength(1);
  expect(surfaces).toHaveLength(1);
  const [item] = sidebarItems;
  expect(item.id).toBe("tunnel");
  expect(item.title).toBe("HTTP Tunnel");
  expect(item.icon).toBe("Network");
  // Paseo throws "references missing surface" when these drift apart, and that silently
  // drops every contribution the plugin made.
  expect(surfaces).toContain(item.surface);
});

test("contribution ids and icon satisfy Paseo's validation", () => {
  const { context, sidebarItems } = createClient();
  contribute(context);

  for (const item of sidebarItems) {
    expect(item.id).toMatch(CONTRIBUTION_ID);
    expect(item.surface).toMatch(CONTRIBUTION_ID);
    expect(item.title.trim()).not.toBe("");
    // Icons resolve against lucide-react-native by PascalCase export name.
    expect(item.icon).toMatch(/^[A-Z][A-Za-z0-9]*$/);
  }
});

test("returns a cleanup function that unregisters both contributions", () => {
  const { context, sidebarItems, surfaces } = createClient();
  const cleanup = contribute(context);
  expect(typeof cleanup).toBe("function");

  cleanup();
  expect(sidebarItems).toHaveLength(0);
  expect(surfaces).toHaveLength(0);
});
