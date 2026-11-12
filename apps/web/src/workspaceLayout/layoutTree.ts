import { scopedThreadKey } from "@t3tools/client-runtime/environment";

import type { RightPanelKind, RightPanelSurface } from "../rightPanelStore";
import type { ThreadRouteTarget } from "../threadRoutes";

export type LayoutDirection = "row" | "column";
export type LayoutEdge = "left" | "right" | "top" | "bottom";

export interface ChatPane {
  readonly id: string;
  readonly kind: "chat";
  /** Null until the user picks a thread for a new chat pane. */
  readonly target: ThreadRouteTarget | null;
}

export interface SurfacePane {
  readonly id: string;
  readonly kind: "surface";
  readonly surfaceKind: RightPanelKind;
  /** The right panel surface this pane last showed; null lets the pane pick one of its kind. */
  readonly surfaceId: string | null;
  /** Scoped thread key the pane is pinned to; null follows the focused chat. */
  readonly pinnedThreadKey: string | null;
}

export type LayoutPane = ChatPane | SurfacePane;

export interface LayoutGroup {
  readonly type: "group";
  readonly id: string;
  readonly panes: ReadonlyArray<LayoutPane>;
  readonly activePaneId: string | null;
}

export interface LayoutSplit {
  readonly type: "split";
  readonly id: string;
  readonly direction: LayoutDirection;
  readonly children: ReadonlyArray<LayoutNode>;
  /** Flex weights, one per child. */
  readonly sizes: ReadonlyArray<number>;
}

export type LayoutNode = LayoutGroup | LayoutSplit;

export interface WorkspaceLayout {
  readonly root: LayoutNode;
  readonly focusedChatPaneId: string;
  readonly activeGroupId: string;
}

export function newLayoutId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function threadRouteTargetKey(target: ThreadRouteTarget | null): string | null {
  if (target === null) return null;
  return target.kind === "server"
    ? `server:${target.threadRef.environmentId}:${target.threadRef.threadId}`
    : `draft:${target.draftId}`;
}

export function createDefaultLayout(target: ThreadRouteTarget | null): WorkspaceLayout {
  const pane: ChatPane = { id: newLayoutId("chat"), kind: "chat", target };
  const group: LayoutGroup = {
    type: "group",
    id: newLayoutId("group"),
    panes: [pane],
    activePaneId: pane.id,
  };
  return { root: group, focusedChatPaneId: pane.id, activeGroupId: group.id };
}

export function layoutGroups(node: LayoutNode): LayoutGroup[] {
  return node.type === "group" ? [node] : node.children.flatMap(layoutGroups);
}

export function layoutPanes(node: LayoutNode): LayoutPane[] {
  return layoutGroups(node).flatMap((group) => group.panes);
}

export function findGroup(node: LayoutNode, groupId: string): LayoutGroup | null {
  return layoutGroups(node).find((group) => group.id === groupId) ?? null;
}

export function findPaneGroup(node: LayoutNode, paneId: string): LayoutGroup | null {
  return layoutGroups(node).find((group) => group.panes.some((pane) => pane.id === paneId)) ?? null;
}

export function findPane(node: LayoutNode, paneId: string): LayoutPane | null {
  return layoutPanes(node).find((pane) => pane.id === paneId) ?? null;
}

function mapGroups(node: LayoutNode, map: (group: LayoutGroup) => LayoutNode): LayoutNode {
  if (node.type === "group") return map(node);
  return { ...node, children: node.children.map((child) => mapGroups(child, map)) };
}

function emptyGroupsRemoved(node: LayoutNode): LayoutNode | null {
  if (node.type === "group") return node.panes.length > 0 ? node : null;
  const kept: { child: LayoutNode; size: number }[] = [];
  node.children.forEach((child, index) => {
    const next = emptyGroupsRemoved(child);
    if (next !== null) kept.push({ child: next, size: node.sizes[index] ?? 1 });
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]!.child;
  return {
    ...node,
    children: kept.map((entry) => entry.child),
    sizes: kept.map((entry) => entry.size),
  };
}

/** Removes empty groups and collapses splits left with one child; an empty tree keeps one group. */
function normalizeLayoutNode(node: LayoutNode, fallbackGroupId: string): LayoutNode {
  return (
    emptyGroupsRemoved(node) ?? {
      type: "group",
      id: fallbackGroupId,
      panes: [],
      activePaneId: null,
    }
  );
}

/** `focusChat` false leaves chat focus, and so the route, alone. */
export function setActivePane(
  layout: WorkspaceLayout,
  paneId: string,
  focusChat = true,
): WorkspaceLayout {
  const group = findPaneGroup(layout.root, paneId);
  if (group === null) return layout;
  const pane = group.panes.find((entry) => entry.id === paneId)!;
  return {
    root: mapGroups(layout.root, (entry) =>
      entry.id === group.id ? { ...entry, activePaneId: paneId } : entry,
    ),
    activeGroupId: group.id,
    focusedChatPaneId:
      focusChat && pane.kind === "chat" && pane.target !== null
        ? pane.id
        : layout.focusedChatPaneId,
  };
}

export function addPane(
  layout: WorkspaceLayout,
  groupId: string,
  pane: LayoutPane,
  index?: number,
): WorkspaceLayout {
  if (findGroup(layout.root, groupId) === null) return layout;
  const root = mapGroups(layout.root, (group) => {
    if (group.id !== groupId) return group;
    const panes = [...group.panes];
    panes.splice(index ?? panes.length, 0, pane);
    return { ...group, panes, activePaneId: pane.id };
  });
  return { ...layout, root, activeGroupId: groupId };
}

export function updatePane(
  layout: WorkspaceLayout,
  paneId: string,
  update: (pane: LayoutPane) => LayoutPane,
): WorkspaceLayout {
  return {
    ...layout,
    root: mapGroups(layout.root, (group) =>
      group.panes.some((pane) => pane.id === paneId)
        ? { ...group, panes: group.panes.map((pane) => (pane.id === paneId ? update(pane) : pane)) }
        : group,
    ),
  };
}

function chatPanesWithTarget(node: LayoutNode): ChatPane[] {
  return layoutPanes(node).filter(
    (pane): pane is ChatPane => pane.kind === "chat" && pane.target !== null,
  );
}

/** The last chat pane with a thread stays, so the route always has a pane to show it. */
export function canRemovePane(layout: WorkspaceLayout, paneId: string): boolean {
  const pane = findPane(layout.root, paneId);
  if (pane === null) return false;
  if (pane.kind !== "chat" || pane.target === null) return true;
  return chatPanesWithTarget(layout.root).length > 1;
}

function withoutPane(node: LayoutNode, paneId: string): LayoutNode {
  return mapGroups(node, (group) => {
    const index = group.panes.findIndex((pane) => pane.id === paneId);
    if (index < 0) return group;
    const panes = group.panes.filter((pane) => pane.id !== paneId);
    const activePaneId =
      group.activePaneId === paneId
        ? (panes[Math.min(index, panes.length - 1)]?.id ?? null)
        : group.activePaneId;
    return { ...group, panes, activePaneId };
  });
}

/** Group and focus fixups after panes moved or closed. */
function settle(layout: WorkspaceLayout, preferredGroupId: string): WorkspaceLayout {
  const root = normalizeLayoutNode(layout.root, newLayoutId("group"));
  const groups = layoutGroups(root);
  const activeGroupId =
    groups.find((group) => group.id === preferredGroupId)?.id ??
    groups.find((group) => group.id === layout.activeGroupId)?.id ??
    groups[0]!.id;
  const chats = chatPanesWithTarget(root);
  const focusedChatPaneId = chats.some((pane) => pane.id === layout.focusedChatPaneId)
    ? layout.focusedChatPaneId
    : (chats[0]?.id ?? layout.focusedChatPaneId);
  return { root, activeGroupId, focusedChatPaneId };
}

export function removePane(layout: WorkspaceLayout, paneId: string): WorkspaceLayout {
  if (!canRemovePane(layout, paneId)) return layout;
  const group = findPaneGroup(layout.root, paneId);
  return settle({ ...layout, root: withoutPane(layout.root, paneId) }, group?.id ?? "");
}

export function canRemoveGroup(layout: WorkspaceLayout, groupId: string): boolean {
  const group = findGroup(layout.root, groupId);
  if (group === null) return false;
  if (layoutGroups(layout.root).length === 1 && group.panes.length === 0) return false;
  const remainingChats = chatPanesWithTarget(layout.root).filter(
    (pane) => !group.panes.some((entry) => entry.id === pane.id),
  );
  return remainingChats.length > 0;
}

export function removeGroup(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  if (!canRemoveGroup(layout, groupId)) return layout;
  const root = mapGroups(layout.root, (group) =>
    group.id === groupId ? { ...group, panes: [], activePaneId: null } : group,
  );
  return settle({ ...layout, root }, layout.activeGroupId);
}

function edgeDirection(edge: LayoutEdge): LayoutDirection {
  return edge === "left" || edge === "right" ? "row" : "column";
}

function edgeIsBefore(edge: LayoutEdge): boolean {
  return edge === "left" || edge === "top";
}

/** Puts `inserted` beside the target group, reusing a parent split of the same direction. */
function insertBesideGroup(
  node: LayoutNode,
  targetGroupId: string,
  inserted: LayoutGroup,
  edge: LayoutEdge,
): LayoutNode {
  const direction = edgeDirection(edge);
  const before = edgeIsBefore(edge);
  if (node.type === "group") {
    if (node.id !== targetGroupId) return node;
    return {
      type: "split",
      id: newLayoutId("split"),
      direction,
      children: before ? [inserted, node] : [node, inserted],
      sizes: [1, 1],
    };
  }
  const index = node.children.findIndex(
    (child) => child.type === "group" && child.id === targetGroupId,
  );
  if (index >= 0 && node.direction === direction) {
    const size = node.sizes[index] ?? 1;
    const children = [...node.children];
    const sizes = [...node.sizes];
    const at = before ? index : index + 1;
    children.splice(at, 0, inserted);
    sizes.splice(index, 1, size / 2);
    sizes.splice(at, 0, size / 2);
    return { ...node, children, sizes };
  }
  return {
    ...node,
    children: node.children.map((child) => insertBesideGroup(child, targetGroupId, inserted, edge)),
  };
}

/** Splits a group and returns the new, empty group's id with the layout. */
export function splitGroup(
  layout: WorkspaceLayout,
  groupId: string,
  edge: LayoutEdge,
  panes: ReadonlyArray<LayoutPane> = [],
): { layout: WorkspaceLayout; groupId: string } {
  if (findGroup(layout.root, groupId) === null) return { layout, groupId };
  const inserted: LayoutGroup = {
    type: "group",
    id: newLayoutId("group"),
    panes,
    activePaneId: panes[0]?.id ?? null,
  };
  return {
    layout: { ...layout, root: insertBesideGroup(layout.root, groupId, inserted, edge) },
    groupId: inserted.id,
  };
}

export function movePane(
  layout: WorkspaceLayout,
  paneId: string,
  toGroupId: string,
  index?: number,
): WorkspaceLayout {
  const pane = findPane(layout.root, paneId);
  if (pane === null || findGroup(layout.root, toGroupId) === null) return layout;
  const fromGroup = findPaneGroup(layout.root, paneId)!;
  let insertAt = index;
  if (fromGroup.id === toGroupId && insertAt !== undefined) {
    const fromIndex = fromGroup.panes.findIndex((entry) => entry.id === paneId);
    if (fromIndex < insertAt) insertAt -= 1;
  }
  const moved = addPane(
    { ...layout, root: withoutPane(layout.root, paneId) },
    toGroupId,
    pane,
    insertAt,
  );
  return settle(setActivePane(moved, paneId), toGroupId);
}

/** Moves a pane into a new group on one edge of the target group. */
export function movePaneToEdge(
  layout: WorkspaceLayout,
  paneId: string,
  targetGroupId: string,
  edge: LayoutEdge,
): WorkspaceLayout {
  const pane = findPane(layout.root, paneId);
  const target = findGroup(layout.root, targetGroupId);
  if (pane === null || target === null) return layout;
  if (target.panes.length === 1 && target.panes[0]!.id === paneId) return layout;
  const split = splitGroup(
    { ...layout, root: withoutPane(layout.root, paneId) },
    targetGroupId,
    edge,
    [pane],
  );
  return settle(setActivePane(split.layout, paneId), split.groupId);
}

export function resizeSplit(
  layout: WorkspaceLayout,
  splitId: string,
  sizes: ReadonlyArray<number>,
): WorkspaceLayout {
  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === "group") return node;
    if (node.id === splitId && sizes.length === node.children.length) return { ...node, sizes };
    return { ...node, children: node.children.map(visit) };
  };
  return { ...layout, root: visit(layout.root) };
}

/** Points the focused chat pane at the route's thread; other panes keep theirs. */
export function retargetFocusedChat(
  layout: WorkspaceLayout,
  target: ThreadRouteTarget,
): WorkspaceLayout {
  const focused = findPane(layout.root, layout.focusedChatPaneId);
  if (focused === null || focused.kind !== "chat") {
    const chat = layoutPanes(layout.root).find((pane) => pane.kind === "chat");
    if (chat === undefined) return createDefaultLayout(target);
    return retargetFocusedChat({ ...layout, focusedChatPaneId: chat.id }, target);
  }
  if (threadRouteTargetKey(focused.target) === threadRouteTargetKey(target)) return layout;
  return updatePane(layout, focused.id, () => ({ ...focused, target }));
}

export function isLayoutValid(value: unknown): value is WorkspaceLayout {
  if (!value || typeof value !== "object") return false;
  const layout = value as WorkspaceLayout;
  if (!layout.root || typeof layout.focusedChatPaneId !== "string") return false;
  try {
    return layoutPanes(layout.root).some((pane) => pane.kind === "chat");
  } catch {
    return false;
  }
}

const SINGLETON_SURFACE_IDS: Partial<Record<RightPanelKind, RightPanelSurface>> = {
  diff: { id: "diff", kind: "diff" },
  files: { id: "files", kind: "files" },
  "pull-requests": { id: "pull-requests", kind: "pull-requests" },
};

function fileSurfaceFromId(surfaceId: string): RightPanelSurface | null {
  if (!surfaceId.startsWith("file:")) return null;
  return {
    id: surfaceId as `file:${string}`,
    kind: "file",
    relativePath: surfaceId.slice("file:".length),
    revealLine: null,
    revealRequestId: 0,
  };
}

/**
 * The surface a pane shows for one thread. A pane keeps its own surface when the thread has
 * it; otherwise it takes the first surface of its kind no other pane claimed. Diff, Files,
 * Pull requests and single files exist for every thread, so those panes always resolve.
 */
function resolvePaneSurface(
  pane: SurfacePane,
  surfaces: ReadonlyArray<RightPanelSurface>,
  claimedSurfaceIds: ReadonlySet<string>,
): RightPanelSurface | null {
  if (pane.surfaceId !== null) {
    const own = surfaces.find((surface) => surface.id === pane.surfaceId);
    if (own) return own;
    const file = pane.surfaceKind === "file" ? fileSurfaceFromId(pane.surfaceId) : null;
    if (file) return file;
  }
  const singleton = SINGLETON_SURFACE_IDS[pane.surfaceKind];
  if (singleton) return surfaces.find((surface) => surface.id === singleton.id) ?? singleton;
  return (
    surfaces.find(
      (surface) => surface.kind === pane.surfaceKind && !claimedSurfaceIds.has(surface.id),
    ) ?? null
  );
}

/**
 * Resolves every pane that shows surfaces of one thread, in tree order, so two panes of the
 * same kind never show the same terminal or browser tab.
 */
export function resolvePaneSurfaces(
  panes: ReadonlyArray<SurfacePane>,
  surfaces: ReadonlyArray<RightPanelSurface>,
): Map<string, RightPanelSurface | null> {
  const claimed = new Set<string>();
  const resolved = new Map<string, RightPanelSurface | null>();
  // Panes that still have their own surface claim it before panes that pick one.
  for (const pane of panes) {
    if (pane.surfaceId !== null && surfaces.some((surface) => surface.id === pane.surfaceId)) {
      claimed.add(pane.surfaceId);
    }
  }
  for (const pane of panes) {
    const surface = resolvePaneSurface(pane, surfaces, claimed);
    if (surface) claimed.add(surface.id);
    resolved.set(pane.id, surface);
  }
  return resolved;
}

/**
 * Surface panes a chat pane renders: unpinned panes follow the focused chat, and pinned panes
 * belong to the first chat pane (the focused one first) that shows their thread.
 */
export function hostedSurfacePanes(
  layout: WorkspaceLayout,
  chatPaneId: string,
  threadKey: string,
): SurfacePane[] {
  const chats = chatPanesWithTarget(layout.root);
  const focused = chats.find((pane) => pane.id === layout.focusedChatPaneId);
  const ordered = focused ? [focused, ...chats.filter((pane) => pane !== focused)] : chats;
  const hostKey = (pane: ChatPane) =>
    pane.target?.kind === "server" ? scopedThreadKey(pane.target.threadRef) : null;
  const host = ordered.find((pane) => hostKey(pane) === threadKey);
  const isFocused = chatPaneId === layout.focusedChatPaneId;
  return layoutPanes(layout.root).filter((pane): pane is SurfacePane => {
    if (pane.kind !== "surface") return false;
    if (pane.pinnedThreadKey === null) return isFocused;
    return pane.pinnedThreadKey === threadKey && host?.id === chatPaneId;
  });
}
