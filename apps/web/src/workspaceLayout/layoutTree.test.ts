import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { RightPanelSurface } from "../rightPanelStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  addPane,
  canRemoveGroup,
  canRemovePane,
  createDefaultLayout,
  hostedSurfacePanes,
  layoutGroups,
  layoutPanes,
  movePane,
  movePaneToEdge,
  removeGroup,
  removePane,
  resolvePaneSurfaces,
  retargetFocusedChat,
  splitGroup,
  type LayoutSplit,
  type SurfacePane,
  type WorkspaceLayout,
} from "./layoutTree";

const serverTarget = (threadId: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make(threadId) },
});

const surfacePane = (id: string, overrides: Partial<SurfacePane> = {}): SurfacePane => ({
  id,
  kind: "surface",
  surfaceKind: "terminal",
  surfaceId: null,
  pinnedThreadKey: null,
  ...overrides,
});

const terminal = (id: string): RightPanelSurface => ({
  id: `terminal:${id}`,
  kind: "terminal",
  resourceId: id,
  terminalIds: [id],
  activeTerminalId: id,
});

function twoChatColumns(): { layout: WorkspaceLayout; leftChat: string; rightChat: string } {
  const initial = createDefaultLayout(serverTarget("a"));
  const leftChat = initial.focusedChatPaneId;
  const split = splitGroup(initial, initial.activeGroupId, "right", [
    { id: "chat-b", kind: "chat", target: serverTarget("b") },
  ]);
  return { layout: split.layout, leftChat, rightChat: "chat-b" };
}

describe("splitGroup", () => {
  it("reuses a parent split of the same direction and halves the split group's size", () => {
    const initial = createDefaultLayout(serverTarget("a"));
    const first = splitGroup(initial, initial.activeGroupId, "right");
    const second = splitGroup(first.layout, first.groupId, "right");
    const root = second.layout.root as LayoutSplit;
    expect(root.type).toBe("split");
    expect(root.children).toHaveLength(3);
    expect(root.sizes).toEqual([1, 0.5, 0.5]);
  });

  it("nests a split of the other direction", () => {
    const initial = createDefaultLayout(serverTarget("a"));
    const right = splitGroup(initial, initial.activeGroupId, "right");
    const below = splitGroup(right.layout, right.groupId, "bottom");
    const root = below.layout.root as LayoutSplit;
    expect(root.direction).toBe("row");
    const nested = root.children[1] as LayoutSplit;
    expect(nested.direction).toBe("column");
    expect(layoutGroups(nested).map((group) => group.id)).toEqual([right.groupId, below.groupId]);
  });
});

describe("removing panes and groups", () => {
  it("keeps the last chat pane with a thread", () => {
    const layout = createDefaultLayout(serverTarget("a"));
    expect(canRemovePane(layout, layout.focusedChatPaneId)).toBe(false);
    expect(removePane(layout, layout.focusedChatPaneId)).toBe(layout);
  });

  it("collapses the split and moves focus when the focused chat closes", () => {
    const { layout, leftChat, rightChat } = twoChatColumns();
    const next = removePane(layout, leftChat);
    expect(next.root.type).toBe("group");
    expect(next.focusedChatPaneId).toBe(rightChat);
  });

  it("refuses to close a group that holds every chat", () => {
    const initial = createDefaultLayout(serverTarget("a"));
    const split = splitGroup(initial, initial.activeGroupId, "right", [surfacePane("t")]);
    expect(canRemoveGroup(split.layout, initial.activeGroupId)).toBe(false);
    expect(canRemoveGroup(split.layout, split.groupId)).toBe(true);
    expect(removeGroup(split.layout, split.groupId).root.type).toBe("group");
  });
});

describe("moving panes", () => {
  it("moves a tab into another group and drops the emptied group", () => {
    const initial = createDefaultLayout(serverTarget("a"));
    const split = splitGroup(initial, initial.activeGroupId, "right", [surfacePane("t")]);
    const moved = movePane(split.layout, "t", initial.activeGroupId);
    expect(moved.root.type).toBe("group");
    expect(layoutPanes(moved.root).map((pane) => pane.id)).toEqual([
      initial.focusedChatPaneId,
      "t",
    ]);
  });

  it("reorders within a group, counting the index before the move", () => {
    let layout = createDefaultLayout(serverTarget("a"));
    layout = addPane(layout, layout.activeGroupId, surfacePane("t1"));
    layout = addPane(layout, layout.activeGroupId, surfacePane("t2"));
    const moved = movePane(layout, layout.focusedChatPaneId, layout.activeGroupId, 3);
    expect(layoutPanes(moved.root).map((pane) => pane.id)).toEqual([
      "t1",
      "t2",
      layout.focusedChatPaneId,
    ]);
  });

  it("splits a tab out to an edge of its own group", () => {
    let layout = createDefaultLayout(serverTarget("a"));
    layout = addPane(layout, layout.activeGroupId, surfacePane("t"));
    const moved = movePaneToEdge(layout, "t", layout.activeGroupId, "bottom");
    const root = moved.root as LayoutSplit;
    expect(root.direction).toBe("column");
    expect(layoutGroups(root).map((group) => group.panes.map((pane) => pane.id))).toEqual([
      [layout.focusedChatPaneId],
      ["t"],
    ]);
  });

  it("does nothing when a group's only tab drops on its own edge", () => {
    const layout = createDefaultLayout(serverTarget("a"));
    expect(movePaneToEdge(layout, layout.focusedChatPaneId, layout.activeGroupId, "left")).toBe(
      layout,
    );
  });
});

describe("retargetFocusedChat", () => {
  it("changes only the focused chat pane", () => {
    const { layout, leftChat, rightChat } = twoChatColumns();
    const next = retargetFocusedChat(layout, serverTarget("c"));
    const chats = layoutPanes(next.root).filter((pane) => pane.kind === "chat");
    expect(chats.find((pane) => pane.id === leftChat)).toMatchObject({ target: serverTarget("c") });
    expect(chats.find((pane) => pane.id === rightChat)).toMatchObject({
      target: serverTarget("b"),
    });
  });
});

describe("resolvePaneSurfaces", () => {
  it("gives two terminal panes different terminals, and keeps a pane's own terminal first", () => {
    const panes = [surfacePane("p1"), surfacePane("p2", { surfaceId: "terminal:one" })];
    const resolved = resolvePaneSurfaces(panes, [terminal("one"), terminal("two")]);
    expect(resolved.get("p1")?.id).toBe("terminal:two");
    expect(resolved.get("p2")?.id).toBe("terminal:one");
  });

  it("leaves a terminal pane empty when the thread has no free terminal", () => {
    const resolved = resolvePaneSurfaces([surfacePane("p1")], []);
    expect(resolved.get("p1")).toBeNull();
  });

  it("resolves diff and file panes in a thread that never opened them", () => {
    const resolved = resolvePaneSurfaces(
      [
        surfacePane("d", { surfaceKind: "diff" }),
        surfacePane("f", { surfaceKind: "file", surfaceId: "file:src/a.ts" }),
      ],
      [],
    );
    expect(resolved.get("d")).toMatchObject({ id: "diff", kind: "diff" });
    expect(resolved.get("f")).toMatchObject({ kind: "file", relativePath: "src/a.ts" });
  });
});

describe("hostedSurfacePanes", () => {
  it("hosts following panes in the focused chat and pinned panes in their thread's chat", () => {
    const { layout, leftChat, rightChat } = twoChatColumns();
    let next = addPane(layout, layout.activeGroupId, surfacePane("follow"));
    next = addPane(next, next.activeGroupId, surfacePane("pinned", { pinnedThreadKey: "env:b" }));
    expect(hostedSurfacePanes(next, leftChat, "env:a").map((pane) => pane.id)).toEqual(["follow"]);
    expect(hostedSurfacePanes(next, rightChat, "env:b").map((pane) => pane.id)).toEqual(["pinned"]);
  });

  it("hosts a pinned pane once when two chat panes show its thread", () => {
    const { layout, leftChat, rightChat } = twoChatColumns();
    let next = retargetFocusedChat(layout, serverTarget("b"));
    next = addPane(next, next.activeGroupId, surfacePane("pinned", { pinnedThreadKey: "env:b" }));
    expect(hostedSurfacePanes(next, leftChat, "env:b").map((pane) => pane.id)).toEqual(["pinned"]);
    expect(hostedSurfacePanes(next, rightChat, "env:b")).toEqual([]);
  });
});
