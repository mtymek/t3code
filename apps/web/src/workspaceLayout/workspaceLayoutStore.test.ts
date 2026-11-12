import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import { layoutGroups, layoutPanes } from "./layoutTree";
import { useWorkspaceLayoutStore } from "./workspaceLayoutStore";

const environmentId = EnvironmentId.make("env");
const thread = (id: string): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId, threadId: ThreadId.make(id) },
});
const draft = (id: string): ThreadRouteTarget => ({ kind: "draft", draftId: id as DraftId });

function setup(first: ThreadRouteTarget) {
  useWorkspaceLayoutStore.setState(useWorkspaceLayoutStore.getInitialState(), true);
  const store = () => useWorkspaceLayoutStore.getState();
  store().syncRoute(first);
  return store;
}

function shape(store: () => ReturnType<typeof useWorkspaceLayoutStore.getState>) {
  return layoutGroups(store().layout.root).map((group) =>
    group.panes.map((pane) => (pane.kind === "chat" ? "chat" : pane.surfaceKind)),
  );
}

function focusedTarget(store: () => ReturnType<typeof useWorkspaceLayoutStore.getState>) {
  const pane = layoutPanes(store().layout.root).find(
    (entry) => entry.id === store().layout.focusedChatPaneId,
  );
  return pane?.kind === "chat" ? pane.target : null;
}

describe("per-thread layouts", () => {
  it("gives each thread opened from outside its own layout and restores it on return", () => {
    const store = setup(thread("a"));
    const groupId = store().layout.activeGroupId;
    store().addSurfacePane(store().split(groupId, "right"), "diff");
    expect(shape(store)).toEqual([["chat"], ["diff"]]);

    store().syncRoute(thread("b"));
    expect(shape(store)).toEqual([["chat"]]);
    expect(focusedTarget(store)).toEqual(thread("b"));

    store().syncRoute(thread("a"));
    expect(shape(store)).toEqual([["chat"], ["diff"]]);
    expect(focusedTarget(store)).toEqual(thread("a"));
    expect(Object.keys(store().saved)).toEqual([]);
  });

  it("keeps the layout when one of its chat panes takes focus", () => {
    const store = setup(thread("a"));
    const right = store().split(store().layout.activeGroupId, "right");
    store().addChatPane(right);
    const chat = layoutGroups(store().layout.root)[1]!.panes[0]!;
    store().setChatPaneTarget(chat.id, thread("b"));

    expect(store().focusChatPane(chat.id, thread("a"))).toEqual(thread("b"));
    store().syncRoute(thread("b"));
    expect(shape(store)).toEqual([["chat"], ["chat"]]);
    expect(store().ownerKey).toBe("server:env:a");

    // A reload lands on the focused pane's thread and keeps the layout too.
    store().syncRoute(thread("b"));
    expect(shape(store)).toEqual([["chat"], ["chat"]]);
  });

  it("does not save a thread's single-chat layout", () => {
    const store = setup(thread("a"));
    store().syncRoute(thread("b"));
    expect(store().saved).toEqual({});
  });

  it("moves a draft's layout to the thread the draft became", () => {
    const store = setup(draft("d1"));
    store().addSurfacePane(store().split(store().layout.activeGroupId, "right"), "terminal");
    useComposerDraftStore.setState({
      promotedDraftRedirects: { d1: { environmentId, threadId: ThreadId.make("t1") } },
    });

    store().syncRoute(thread("t1"));
    expect(shape(store)).toEqual([["chat"], ["terminal"]]);
    expect(focusedTarget(store)).toEqual(thread("t1"));
    expect(store().ownerKey).toBe("server:env:t1");
  });
});
