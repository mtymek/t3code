import { describe, expect, it } from "vite-plus/test";

import type { ThreadRightPanelState } from "../../rightPanelStore";
import {
  addedUiAssistantResources,
  terminalSplitDirection,
  uiAssistantBrowserUrl,
  type UiAssistantLayoutSnapshot,
} from "./uiAssistant.logic";

const panel = (surfaces: ThreadRightPanelState["surfaces"]): ThreadRightPanelState => ({
  isOpen: true,
  activeSurfaceId: surfaces[0]?.id ?? null,
  surfaces,
});

const drawer = (terminalIds: string[]): UiAssistantLayoutSnapshot["terminal"] => ({
  terminalOpen: true,
  terminalHeight: 280,
  terminalIds,
  activeTerminalId: terminalIds[0] ?? "default",
  terminalGroups: [{ id: "group-1", terminalIds }],
  activeTerminalGroupId: "group-1",
});

describe("addedUiAssistantResources", () => {
  it("lists only the terminals and browser tabs the plan started", () => {
    const before: UiAssistantLayoutSnapshot = {
      rightPanel: panel([
        { id: "browser:old", kind: "preview", resourceId: "old" },
        { id: "diff", kind: "diff" },
      ]),
      terminal: drawer(["default"]),
    };
    const after: UiAssistantLayoutSnapshot = {
      rightPanel: panel([
        { id: "browser:old", kind: "preview", resourceId: "old" },
        { id: "browser:new", kind: "preview", resourceId: null },
        { id: "browser:tab-2", kind: "preview", resourceId: "tab-2" },
        {
          id: "terminal:panel-1",
          kind: "terminal",
          resourceId: "panel-1",
          terminalIds: ["panel-1", "panel-2"],
          activeTerminalId: "panel-2",
        },
      ]),
      terminal: drawer(["default", "drawer-2"]),
    };
    expect(addedUiAssistantResources(before, after)).toEqual({
      terminalIds: ["drawer-2", "panel-1", "panel-2"],
      browserTabIds: ["tab-2"],
    });
  });

  it("treats a thread with no saved layout as empty", () => {
    expect(
      addedUiAssistantResources(
        { rightPanel: undefined, terminal: undefined },
        { rightPanel: undefined, terminal: drawer(["term-1"]) },
      ),
    ).toEqual({ terminalIds: ["term-1"], browserTabIds: [] });
  });
});

it("adds a scheme to bare hosts and keeps explicit ones", () => {
  expect(uiAssistantBrowserUrl(" localhost:5173/login ")).toBe("http://localhost:5173/login");
  expect(uiAssistantBrowserUrl("https://example.com")).toBe("https://example.com");
});

it("maps right to side-by-side and down to stacked terminals", () => {
  expect(terminalSplitDirection("right")).toBe("horizontal");
  expect(terminalSplitDirection("down")).toBe("vertical");
});
