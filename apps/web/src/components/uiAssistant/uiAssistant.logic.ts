import type { UiAssistantCommand, UiAssistantSplitDirection } from "@t3tools/contracts";

import type { ThreadRightPanelState } from "../../rightPanelStore";
import type { selectThreadTerminalUiState } from "../../terminalUiStateStore";

type TerminalUiState = ReturnType<typeof selectThreadTerminalUiState>;

/** One thread's layout before a plan ran, so Undo can put it back. Undefined: no entry yet. */
export interface UiAssistantLayoutSnapshot {
  readonly rightPanel: ThreadRightPanelState | undefined;
  readonly terminal: TerminalUiState | undefined;
}

export interface UiAssistantCapabilities {
  readonly browserAvailable: boolean;
  readonly diffAvailable: boolean;
  readonly pullRequestsAvailable: boolean;
  readonly terminalAvailable: boolean;
}

const SURFACE_LABELS: Record<ThreadRightPanelState["surfaces"][number]["kind"], string> = {
  diff: "diff",
  files: "files",
  file: "file",
  preview: "browser",
  device: "device",
  terminal: "terminal",
  "pull-request": "pull request",
  "pull-requests": "pull requests",
  "side-chat": "side chat",
};

/** Plain text for the model: what is open now and what this thread can open. */
export function describeUiAssistantLayout(
  snapshot: UiAssistantLayoutSnapshot,
  capabilities: UiAssistantCapabilities,
): string {
  const panel = snapshot.rightPanel;
  const tabs =
    panel?.surfaces.map((surface) => {
      const label =
        surface.kind === "terminal" && surface.terminalIds.length > 1
          ? `terminal (${surface.terminalIds.length} split ${surface.splitDirection === "vertical" ? "down" : "right"})`
          : SURFACE_LABELS[surface.kind];
      return surface.id === panel.activeSurfaceId ? `${label} (active)` : label;
    }) ?? [];
  const terminal = snapshot.terminal;
  const drawerTerminals = terminal?.terminalIds.length ?? 0;
  const unavailable = [
    capabilities.browserAvailable ? null : "browser",
    capabilities.diffAvailable ? null : "diff",
    capabilities.pullRequestsAvailable ? null : "pull requests",
    capabilities.terminalAvailable ? null : "terminals",
  ].filter((entry) => entry !== null);
  return [
    `Right panel: ${panel?.isOpen ? "shown" : "hidden"}${panel?.maximized ? ", maximized" : ""}. Tabs: ${tabs.length > 0 ? tabs.join(", ") : "none"}.`,
    `Terminal drawer: ${terminal?.terminalOpen ? "shown" : "hidden"}, ${terminal?.terminalHeight ?? "default"} px tall, ${drawerTerminals} terminal${drawerTerminals === 1 ? "" : "s"} in ${terminal?.terminalGroups.length ?? 0} group${terminal?.terminalGroups.length === 1 ? "" : "s"}.`,
    unavailable.length > 0 ? `Not available in this thread: ${unavailable.join(", ")}.` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function terminalIdsOf(snapshot: UiAssistantLayoutSnapshot): Set<string> {
  return new Set([
    ...(snapshot.terminal?.terminalIds ?? []),
    ...(snapshot.rightPanel?.surfaces.flatMap((surface) =>
      surface.kind === "terminal" ? surface.terminalIds : [],
    ) ?? []),
  ]);
}

function browserTabIdsOf(snapshot: UiAssistantLayoutSnapshot): Set<string> {
  return new Set(
    snapshot.rightPanel?.surfaces.flatMap((surface) =>
      surface.kind === "preview" && surface.resourceId ? [surface.resourceId] : [],
    ) ?? [],
  );
}

/** Terminals and browser tabs a plan started, which Undo has to end, not only hide. */
export function addedUiAssistantResources(
  before: UiAssistantLayoutSnapshot,
  after: UiAssistantLayoutSnapshot,
): { readonly terminalIds: string[]; readonly browserTabIds: string[] } {
  const terminalsBefore = terminalIdsOf(before);
  const browsersBefore = browserTabIdsOf(before);
  return {
    terminalIds: [...terminalIdsOf(after)].filter((id) => !terminalsBefore.has(id)),
    browserTabIds: [...browserTabIdsOf(after)].filter((id) => !browsersBefore.has(id)),
  };
}

export function withThreadEntry<T>(
  record: Record<string, T>,
  key: string,
  value: T | undefined,
): Record<string, T> {
  if (value !== undefined) return { ...record, [key]: value };
  const { [key]: _removed, ...rest } = record;
  return rest;
}

/** Models write "localhost:5173"; the browser needs a scheme. */
export function uiAssistantBrowserUrl(url: string): string {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Drawer and panel splits call side-by-side "horizontal" and stacked "vertical". */
export function terminalSplitDirection(
  direction: UiAssistantSplitDirection,
): "horizontal" | "vertical" {
  return direction === "right" ? "horizontal" : "vertical";
}

const PANEL_LABELS = { diff: "Diff", files: "Files", "pull-requests": "Pull requests" } as const;

export function describeUiAssistantCommand(command: UiAssistantCommand): string {
  switch (command.command) {
    case "browser.open":
      return command.url ? `Browser at ${command.url}` : "Browser tab";
    case "rightPanel.open":
      return PANEL_LABELS[command.kind];
    case "rightPanel.hide":
      return "Right panel hidden";
    case "rightPanel.maximize":
      return command.maximized ? "Right panel maximized" : "Right panel restored";
    case "terminal.show":
      return "Terminal drawer";
    case "terminal.hide":
      return "Terminal drawer hidden";
    case "terminal.new":
      return command.place === "panel" ? "Terminal tab" : "New terminal";
    case "terminal.split":
      return `Terminal split ${command.direction}`;
    case "terminal.resize":
      return `Terminal drawer ${Math.round(command.height)} px`;
  }
}
