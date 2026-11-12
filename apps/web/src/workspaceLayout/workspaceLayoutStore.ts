import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { useComposerDraftStore, type DraftId } from "../composerDraftStore";
import { resolveStorage } from "../lib/storage";
import type { RightPanelKind, RightPanelSurface } from "../rightPanelStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import {
  addPane,
  canRemoveGroup as canRemoveGroupInLayout,
  createDefaultLayout,
  findGroup,
  findPane,
  isLayoutValid,
  layoutGroups,
  layoutPanes,
  movePane,
  movePaneToEdge,
  newLayoutId,
  removeGroup,
  removePane,
  resizeSplit,
  retargetFocusedChat,
  setActivePane,
  splitGroup,
  threadRouteTargetKey,
  updatePane,
  type LayoutEdge,
  type SurfacePane,
  type WorkspaceLayout,
} from "./layoutTree";

const STORAGE_KEY = "t3code:workspace-layout:v1";
const MAX_SAVED_LAYOUTS = 50;

interface SavedLayout {
  readonly layout: WorkspaceLayout;
  readonly usedAt: number;
}

interface WorkspaceLayoutStore {
  /** The layout on screen, which belongs to the thread `ownerKey`. */
  layout: WorkspaceLayout;
  /** Route key of the thread whose layout is on screen. */
  ownerKey: string | null;
  /** Other threads' layouts, by route key. */
  saved: Record<string, SavedLayout>;
  /** Route key a focus change navigated to; the focused pane shows its own target until then. */
  pendingRouteKey: string | null;
  /** Group the next surface opened by an action lands in. */
  adoptGroupId: string | null;
  /** Empty pane the next surface of its kind fills. */
  fillPaneId: string | null;

  syncRoute: (target: ThreadRouteTarget) => void;
  focusChatPane: (
    paneId: string,
    currentRoute: ThreadRouteTarget | null,
  ) => ThreadRouteTarget | null;
  activatePane: (paneId: string) => void;
  activateGroup: (groupId: string) => void;
  addChatPane: (groupId: string) => void;
  addSurfacePane: (groupId: string, kind: RightPanelKind) => string;
  setChatPaneTarget: (paneId: string, target: ThreadRouteTarget) => void;
  setPanePinned: (paneId: string, threadKey: string | null) => void;
  retargetSurfacePane: (paneId: string, surface: RightPanelSurface) => void;
  closePane: (paneId: string) => void;
  closeGroup: (groupId: string) => void;
  split: (groupId: string, edge: LayoutEdge) => string;
  movePane: (paneId: string, toGroupId: string, index?: number) => void;
  movePaneToEdge: (paneId: string, groupId: string, edge: LayoutEdge) => void;
  resize: (splitId: string, sizes: ReadonlyArray<number>) => void;
  requestSurfaceIn: (groupId: string | null, fillPaneId: string | null) => void;
  adoptSurface: (input: {
    readonly surface: RightPanelSurface | null;
    readonly hostedPanes: ReadonlyArray<SurfacePane>;
    readonly resolved: ReadonlyMap<string, RightPanelSurface | null>;
  }) => void;
  reset: () => void;
}

function surfaceGroupFor(layout: WorkspaceLayout, preferred: string | null): string {
  if (preferred !== null && findGroup(layout.root, preferred) !== null) return preferred;
  const groups = layoutGroups(layout.root);
  const active = groups.find((group) => group.id === layout.activeGroupId);
  const holdsSurfaces = (group: (typeof groups)[number]) =>
    group.panes.length === 0 || group.panes.some((pane) => pane.kind === "surface");
  if (active && holdsSurfaces(active)) return active.id;
  return groups.findLast(holdsSurfaces)?.id ?? "";
}

/** A single chat in one group: what a thread gets anyway, so not worth saving. */
function isDefaultShape(layout: WorkspaceLayout): boolean {
  return layout.root.type === "group" && layout.root.panes.length <= 1;
}

function rememberLayout(
  saved: Record<string, SavedLayout>,
  key: string,
  layout: WorkspaceLayout,
): Record<string, SavedLayout> {
  const { [key]: _previous, ...rest } = saved;
  if (isDefaultShape(layout)) return rest;
  const entries = Object.entries({ ...rest, [key]: { layout, usedAt: Date.now() } });
  if (entries.length <= MAX_SAVED_LAYOUTS) return Object.fromEntries(entries);
  entries.sort((a, b) => b[1].usedAt - a[1].usedAt);
  return Object.fromEntries(entries.slice(0, MAX_SAVED_LAYOUTS));
}

/** Focuses the chat pane already showing `target`, or points the focused chat at it. */
function showTarget(layout: WorkspaceLayout, target: ThreadRouteTarget): WorkspaceLayout {
  const key = threadRouteTargetKey(target);
  const showing = layoutPanes(layout.root).find(
    (pane) => pane.kind === "chat" && threadRouteTargetKey(pane.target) === key,
  );
  return showing ? setActivePane(layout, showing.id) : retargetFocusedChat(layout, target);
}

function retargetChats(
  layout: WorkspaceLayout,
  fromKey: string,
  target: ThreadRouteTarget,
): WorkspaceLayout {
  return layoutPanes(layout.root).reduce(
    (next, pane) =>
      pane.kind === "chat" && threadRouteTargetKey(pane.target) === fromKey
        ? updatePane(next, pane.id, () => ({ ...pane, target }))
        : next,
    layout,
  );
}

export const useWorkspaceLayoutStore = create<WorkspaceLayoutStore>()(
  persist(
    (set, get) => ({
      layout: createDefaultLayout(null),
      ownerKey: null,
      saved: {},
      pendingRouteKey: null,
      adoptGroupId: null,
      fillPaneId: null,

      syncRoute: (target) =>
        set((state) => {
          const key = threadRouteTargetKey(target)!;
          const cleared = { pendingRouteKey: null };
          if (state.ownerKey === null) {
            return { ...cleared, ownerKey: key, layout: showTarget(state.layout, target) };
          }
          const focused = findPane(state.layout.root, state.layout.focusedChatPaneId);
          const focusedKey = focused?.kind === "chat" ? threadRouteTargetKey(focused.target) : null;
          // The layout's own route changes (focusing a chat pane, a reload) keep it.
          if (key === state.pendingRouteKey || key === focusedKey) return cleared;
          // A sent draft becomes its thread and keeps its layout.
          if (state.ownerKey.startsWith("draft:") && target.kind === "server") {
            const promoted = useComposerDraftStore
              .getState()
              .getPromotedDraftRedirect(state.ownerKey.slice("draft:".length) as DraftId);
            if (promoted && threadRouteTargetKey({ kind: "server", threadRef: promoted }) === key) {
              return {
                ...cleared,
                ownerKey: key,
                layout: showTarget(retargetChats(state.layout, state.ownerKey, target), target),
              };
            }
          }
          // A thread opened from outside the layout brings up its own layout.
          const remembered = rememberLayout(state.saved, state.ownerKey, state.layout);
          const { [key]: own, ...saved } = remembered;
          return {
            ...cleared,
            ownerKey: key,
            saved,
            layout: showTarget(own?.layout ?? createDefaultLayout(target), target),
          };
        }),

      focusChatPane: (paneId, currentRoute) => {
        const { layout } = get();
        const pane = findPane(layout.root, paneId);
        if (pane === null || pane.kind !== "chat" || pane.target === null) return null;
        if (paneId === layout.focusedChatPaneId) {
          set({ layout: setActivePane(layout, paneId) });
          return null;
        }
        // The pane losing focus keeps the thread the route showed in it.
        const kept =
          currentRoute === null
            ? layout
            : updatePane(layout, layout.focusedChatPaneId, (entry) =>
                entry.kind === "chat" ? { ...entry, target: currentRoute } : entry,
              );
        const routeKey = threadRouteTargetKey(currentRoute);
        const targetKey = threadRouteTargetKey(pane.target);
        set({
          layout: setActivePane(kept, paneId),
          pendingRouteKey: targetKey === routeKey ? null : targetKey,
        });
        return targetKey === routeKey ? null : pane.target;
      },

      activatePane: (paneId) =>
        set((state) => ({ layout: setActivePane(state.layout, paneId, false) })),

      activateGroup: (groupId) =>
        set((state) =>
          state.layout.activeGroupId === groupId || findGroup(state.layout.root, groupId) === null
            ? {}
            : { layout: { ...state.layout, activeGroupId: groupId } },
        ),

      addChatPane: (groupId) =>
        set((state) => ({
          layout: addPane(state.layout, groupId, {
            id: newLayoutId("chat"),
            kind: "chat",
            target: null,
          }),
        })),

      addSurfacePane: (groupId, kind) => {
        const id = newLayoutId("surface");
        set((state) => ({
          layout: addPane(state.layout, groupId, {
            id,
            kind: "surface",
            surfaceKind: kind,
            surfaceId: null,
            pinnedThreadKey: null,
          }),
        }));
        return id;
      },

      setChatPaneTarget: (paneId, target) =>
        set((state) => ({
          layout: updatePane(state.layout, paneId, (pane) =>
            pane.kind === "chat" ? { ...pane, target } : pane,
          ),
        })),

      setPanePinned: (paneId, threadKey) =>
        set((state) => ({
          layout: updatePane(state.layout, paneId, (pane) =>
            pane.kind === "surface" ? { ...pane, pinnedThreadKey: threadKey } : pane,
          ),
        })),

      retargetSurfacePane: (paneId, surface) =>
        set((state) => ({
          layout: updatePane(state.layout, paneId, (pane) =>
            pane.kind === "surface"
              ? { ...pane, surfaceKind: surface.kind, surfaceId: surface.id }
              : pane,
          ),
        })),

      closePane: (paneId) => set((state) => ({ layout: removePane(state.layout, paneId) })),
      closeGroup: (groupId) => set((state) => ({ layout: removeGroup(state.layout, groupId) })),

      split: (groupId, edge) => {
        const result = splitGroup(get().layout, groupId, edge);
        set({ layout: { ...result.layout, activeGroupId: result.groupId } });
        return result.groupId;
      },

      movePane: (paneId, toGroupId, index) =>
        set((state) => ({ layout: movePane(state.layout, paneId, toGroupId, index) })),
      movePaneToEdge: (paneId, groupId, edge) =>
        set((state) => ({ layout: movePaneToEdge(state.layout, paneId, groupId, edge) })),
      resize: (splitId, sizes) =>
        set((state) => ({ layout: resizeSplit(state.layout, splitId, sizes) })),

      requestSurfaceIn: (groupId, fillPaneId) => set({ adoptGroupId: groupId, fillPaneId }),

      adoptSurface: ({ surface, hostedPanes, resolved }) =>
        set((state) => {
          let layout = state.layout;
          const reset = { adoptGroupId: null, fillPaneId: null };
          if (surface === null) {
            // The panel toggle with nothing to show: offer an empty group to add panes to.
            if (layoutGroups(layout.root).some((group) => group.panes.length === 0)) return reset;
            const groupId = surfaceGroupFor(layout, state.adoptGroupId);
            if (groupId !== "") return { ...reset, layout: { ...layout, activeGroupId: groupId } };
            const result = splitGroup(layout, layout.activeGroupId, "right");
            return { ...reset, layout: { ...result.layout, activeGroupId: result.groupId } };
          }
          const showing = hostedPanes.find((pane) => resolved.get(pane.id)?.id === surface.id);
          if (showing) return { ...reset, layout: setActivePane(layout, showing.id) };
          const fill = hostedPanes.find(
            (pane) =>
              pane.id === state.fillPaneId &&
              pane.surfaceKind === surface.kind &&
              resolved.get(pane.id) == null,
          );
          if (fill) {
            layout = updatePane(layout, fill.id, (pane) =>
              pane.kind === "surface" ? { ...pane, surfaceId: surface.id } : pane,
            );
            return { ...reset, layout: setActivePane(layout, fill.id) };
          }
          const pane: SurfacePane = {
            id: newLayoutId("surface"),
            kind: "surface",
            surfaceKind: surface.kind,
            surfaceId: surface.id,
            pinnedThreadKey: null,
          };
          let groupId = surfaceGroupFor(layout, state.adoptGroupId);
          if (groupId === "") {
            const focusedGroup = layoutGroups(layout.root).find((group) =>
              group.panes.some((entry) => entry.id === layout.focusedChatPaneId),
            );
            const result = splitGroup(layout, focusedGroup?.id ?? layout.activeGroupId, "right");
            layout = result.layout;
            groupId = result.groupId;
          }
          return { ...reset, layout: addPane(layout, groupId, pane) };
        }),

      reset: () =>
        set((state) => {
          const focused = findPane(state.layout.root, state.layout.focusedChatPaneId);
          return {
            layout: createDefaultLayout(focused?.kind === "chat" ? focused.target : null),
            saved: {},
            pendingRouteKey: null,
          };
        }),
    }),
    {
      name: STORAGE_KEY,
      version: 2,
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      partialize: (state) => ({
        layout: state.layout,
        ownerKey: state.ownerKey,
        saved: state.saved,
      }),
      // Version 1 kept one layout for every thread; it becomes the next opened thread's.
      migrate: (persisted) => ({ ...(persisted as object), ownerKey: null, saved: {} }),
      merge: (persisted, current) => {
        const stored = persisted as
          | { layout?: unknown; ownerKey?: unknown; saved?: Record<string, SavedLayout> }
          | undefined;
        if (!isLayoutValid(stored?.layout)) return current;
        const saved = Object.fromEntries(
          Object.entries(stored.saved ?? {}).filter(
            ([, entry]) => isLayoutValid(entry?.layout) && typeof entry.usedAt === "number",
          ),
        );
        return {
          ...current,
          layout: stored.layout,
          ownerKey: typeof stored.ownerKey === "string" ? stored.ownerKey : null,
          saved,
        };
      },
    },
  ),
);

/** Actions only the focused ChatView can run, such as launching a terminal for its thread. */
export interface FocusedChatActions {
  readonly addTerminal: () => void;
  readonly addBrowser: () => void;
  readonly openSurface: (kind: "diff" | "files" | "pull-requests") => void;
  /** Null where the thread cannot have side chats at all. */
  readonly addSideChat: (() => void) | null;
  readonly sideChatDisabledReason: string | null;
}

export const useFocusedChatActionsStore = create<{
  actions: FocusedChatActions | null;
  setActions: (actions: FocusedChatActions | null) => void;
}>()((set) => ({
  actions: null,
  setActions: (actions) => set({ actions }),
}));

/**
 * Close handlers the hosting ChatView registers for surface panes, so closing a tab releases its
 * terminal or browser session the way closing a right panel tab does. Not persisted.
 */
export const usePaneCloseStore = create<{
  handlers: Record<string, () => void>;
  setHandlers: (owner: string, handlers: Record<string, () => void>) => void;
  owners: Record<string, ReadonlyArray<string>>;
}>()((set) => ({
  handlers: {},
  owners: {},
  setHandlers: (owner, next) =>
    set((state) => {
      const handlers = { ...state.handlers };
      for (const paneId of state.owners[owner] ?? []) delete handlers[paneId];
      Object.assign(handlers, next);
      return { handlers, owners: { ...state.owners, [owner]: Object.keys(next) } };
    }),
}));

/**
 * Closes a pane. A pane showing a surface closes that surface the way the right panel does,
 * confirmation included, and its host removes the pane once the surface is gone.
 */
export function closeLayoutPane(paneId: string): void {
  const handler = usePaneCloseStore.getState().handlers[paneId];
  if (handler) handler();
  else useWorkspaceLayoutStore.getState().closePane(paneId);
}

export function closeLayoutGroup(groupId: string): void {
  const store = useWorkspaceLayoutStore.getState();
  const group = findGroup(store.layout.root, groupId);
  if (!group) return;
  if (!canRemoveGroupInLayout(store.layout, groupId)) return;
  if (group.panes.length === 0) {
    store.closeGroup(groupId);
    return;
  }
  // Each pane closes on its own path, so a cancelled terminal confirmation keeps its pane;
  // the group goes once it is empty.
  for (const pane of group.panes) closeLayoutPane(pane.id);
}
