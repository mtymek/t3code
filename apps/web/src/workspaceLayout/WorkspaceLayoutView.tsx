import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { Columns2, GripHorizontal, Pin, PinOff, Plus, Rows2, X } from "lucide-react";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

import { ThreadRouteView } from "../components/ThreadRouteView";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { SidebarInset } from "../components/ui/sidebar";
import { cn } from "../lib/utils";
import { useQuietThreadShell, useVisibleThreadShells } from "../state/entities";
import type { ThreadRouteTarget } from "../threadRoutes";
import { Kbd } from "../components/ui/kbd";
import { LayoutKeyboard, focusGroupContent, useLayoutKeyStore } from "./LayoutKeyboard";
import { activateLayoutPane, useNavigateToTarget } from "./layoutNavigation";
import {
  canRemoveGroup,
  canRemovePane,
  layoutGroups,
  threadRouteTargetKey,
  type ChatPane,
  type LayoutEdge,
  type LayoutGroup,
  type LayoutNode,
  type LayoutPane,
  type LayoutSplit,
  type SurfacePane,
} from "./layoutTree";
import {
  LayoutPaneContext,
  SurfaceKindIcon,
  surfaceKindLabel,
  surfacePaneLabel,
} from "./paneLabels";
import {
  closeLayoutGroup,
  closeLayoutPane,
  useFocusedChatActionsStore,
  useWorkspaceLayoutStore,
} from "./workspaceLayoutStore";
import { paneNode, prunePaneNodes } from "./paneNodes";

const PANE_DRAG_TYPE = "application/x-t3-layout-pane";

const useDragStore = create<{ paneId: string | null; set: (paneId: string | null) => void }>()(
  (set) => ({ paneId: null, set: (paneId) => set({ paneId }) }),
);

/**
 * The thread area as a tree of splits and tab groups. The focused chat pane shows the route's
 * thread; the route follows when another chat pane takes focus.
 */
export function WorkspaceLayoutView(props: {
  readonly routeTarget: ThreadRouteTarget;
  readonly background: boolean;
}) {
  const { routeTarget, background } = props;
  const root = useWorkspaceLayoutStore((state) => state.layout.root);
  // The route hands over a new target object every render; keep one per thread.
  const [syncedTarget, setSyncedTarget] = useState(routeTarget);
  if (threadRouteTargetKey(syncedTarget) !== threadRouteTargetKey(routeTarget)) {
    setSyncedTarget(routeTarget);
  }

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- points the focused chat pane at threads the router opens from the sidebar, links and shortcuts
  useEffect(() => {
    if (background) return;
    useWorkspaceLayoutStore.getState().syncRoute(syncedTarget);
  }, [syncedTarget, background]);

  return (
    <SidebarInset
      className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
      inert={background}
    >
      <div className="relative flex min-h-0 w-full flex-1">
        <LayoutNodeView node={root} />
      </div>
      <ChatPaneHosts routeTarget={routeTarget} background={background} />
      <LayoutKeyboard background={background} />
    </SidebarInset>
  );
}

function LayoutNodeView(props: { readonly node: LayoutNode }) {
  if (props.node.type === "group") return <GroupView group={props.node} />;
  return <SplitView split={props.node} />;
}

function SplitView(props: { readonly split: LayoutSplit }) {
  const { split } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  // Sizes follow the pointer locally during a drag and reach the store once on release.
  const [dragSizes, setDragSizes] = useState<ReadonlyArray<number> | null>(null);
  const sizes = dragSizes ?? split.sizes;
  const row = split.direction === "row";

  const startResize = (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const extent = row ? rect.width : rect.height;
    const start = row ? event.clientX : event.clientY;
    const initial = [...sizes];
    const minimum = (total * 120) / Math.max(extent, 1);
    let latest: number[] = initial;
    const onMove = (moveEvent: PointerEvent) => {
      const delta = (((row ? moveEvent.clientX : moveEvent.clientY) - start) / extent) * total;
      const pair = initial[index]! + initial[index + 1]!;
      const first = Math.min(Math.max(initial[index]! + delta, minimum), pair - minimum);
      latest = [...initial];
      latest[index] = first;
      latest[index + 1] = pair - first;
      setDragSizes(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      useWorkspaceLayoutStore.getState().resize(split.id, latest);
      setDragSizes(null);
    };
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
  };

  return (
    <div
      ref={containerRef}
      className={cn("flex min-h-0 min-w-0 flex-1", row ? "flex-row" : "flex-col")}
    >
      {split.children.map((child, index) => (
        <div key={child.id} className="contents">
          {index > 0 ? (
            <div
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
              className={cn(
                "relative z-10 shrink-0 bg-border transition-colors hover:bg-primary/60",
                row ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
                "before:absolute before:content-['']",
                row ? "before:inset-y-0 before:-inset-x-1" : "before:inset-x-0 before:-inset-y-1",
              )}
              onPointerDown={(event) => startResize(index - 1, event)}
            />
          ) : null}
          <div
            className="flex min-h-0 min-w-0"
            style={{ flexGrow: sizes[index] ?? 1, flexShrink: 1, flexBasis: 0 }}
          >
            <LayoutNodeView node={child} />
          </div>
        </div>
      ))}
    </div>
  );
}

function edgeForPoint(event: ReactDragEvent<HTMLElement>): LayoutEdge | "center" {
  const rect = event.currentTarget.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  const distances: [LayoutEdge | "center", number][] = [
    ["left", x],
    ["right", 1 - x],
    ["top", y],
    ["bottom", 1 - y],
  ];
  const [edge, distance] = distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  return distance < 0.25 ? edge : "center";
}

const DROP_PREVIEW_CLASS: Record<LayoutEdge | "center", string> = {
  center: "inset-2",
  left: "inset-y-2 left-2 w-[calc(50%-0.5rem)]",
  right: "inset-y-2 right-2 w-[calc(50%-0.5rem)]",
  top: "inset-x-2 top-2 h-[calc(50%-0.5rem)]",
  bottom: "inset-x-2 bottom-2 h-[calc(50%-0.5rem)]",
};

function GroupView(props: { readonly group: LayoutGroup }) {
  const { group } = props;
  const isActiveGroup = useWorkspaceLayoutStore((state) => state.layout.activeGroupId === group.id);
  const groupCount = useWorkspaceLayoutStore((state) => layoutGroups(state.layout.root).length);
  const zoomed = useLayoutKeyStore((state) => state.zoomedGroupId === group.id);
  const choosing = useLayoutKeyStore((state) => state.chooserGroupId === group.id);
  const draggingPaneId = useDragStore((state) => state.paneId);
  const [dropEdge, setDropEdge] = useState<LayoutEdge | "center" | null>(null);

  // Native listeners: surface panes are portals from their chat's ChatView, so React would send
  // their pointer and focus events to the hosting chat's group instead of this one.
  const activateOnDomEntry = (element: HTMLElement) => {
    const activate = () => useWorkspaceLayoutStore.getState().activateGroup(group.id);
    element.addEventListener("pointerdown", activate, true);
    element.addEventListener("focusin", activate);
    return () => {
      element.removeEventListener("pointerdown", activate, true);
      element.removeEventListener("focusin", activate);
    };
  };

  const onBodyDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const paneId = event.dataTransfer.getData(PANE_DRAG_TYPE);
    setDropEdge(null);
    if (!paneId) return;
    event.preventDefault();
    const edge = edgeForPoint(event);
    const store = useWorkspaceLayoutStore.getState();
    if (edge === "center") store.movePane(paneId, group.id);
    else store.movePaneToEdge(paneId, group.id, edge);
  };

  return (
    <section
      className={cn(
        "group/section flex min-h-0 min-w-0 flex-1 flex-col outline-none",
        zoomed ? "absolute inset-0 z-40 bg-background" : "relative",
        // A frame around the whole split, drawn over its content so it never shifts the layout.
        groupCount > 1 &&
          isActiveGroup &&
          "after:pointer-events-none after:absolute after:inset-0 after:z-50 after:ring-1 after:ring-primary/70 after:ring-inset",
      )}
      aria-label="Pane group"
      data-group-id={group.id}
      tabIndex={-1}
      ref={activateOnDomEntry}
    >
      {/* A lone chat's own header carries the pane controls; an empty group shows its choices. */}
      {group.panes.length > 1 || group.panes[0]?.kind === "surface" ? (
        <GroupTabBar group={group} />
      ) : null}
      <div
        className="relative flex min-h-0 min-w-0 flex-1"
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(PANE_DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropEdge(edgeForPoint(event));
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropEdge(null);
        }}
        onDrop={onBodyDrop}
      >
        {group.panes.length === 0 ? <EmptyGroup groupId={group.id} /> : null}
        {group.panes.map((pane) => (
          <div
            key={pane.id}
            data-active-pane={pane.id === group.activePaneId ? "" : undefined}
            className={cn(
              "min-h-0 min-w-0 flex-1",
              pane.id === group.activePaneId ? "flex" : "hidden",
            )}
          >
            <PaneMount paneId={pane.id} />
          </div>
        ))}
        {choosing && group.panes.length > 0 ? (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-background/90"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) closeChooser();
            }}
          >
            <PaneChooser groupId={group.id} prompt="Add a tab to this split." />
          </div>
        ) : null}
        {/* Webviews and iframes swallow drag events, so a shield takes them during a drag. */}
        {draggingPaneId !== null ? <div className="absolute inset-0 z-20" /> : null}
        {dropEdge !== null ? (
          <div
            className={cn(
              "pointer-events-none absolute z-30 rounded-md border-2 border-primary/70 bg-primary/10",
              DROP_PREVIEW_CLASS[dropEdge],
            )}
          />
        ) : null}
      </div>
    </section>
  );
}

/** Pane controls show while the pointer is on the group, as in herdr's pane headers. */
const REVEAL_ON_HOVER_CLASS =
  "pointer-events-none opacity-0 transition-opacity group-hover/section:pointer-events-auto group-hover/section:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-data-popup-open:pointer-events-auto has-data-popup-open:opacity-100";

/** Controls for a chat that is alone in its group, drawn into the chat's own header. */
function ChatPaneHeaderActions(props: { readonly groupId: string; readonly paneId: string }) {
  const multipleGroups = useWorkspaceLayoutStore(
    (state) => layoutGroups(state.layout.root).length > 1,
  );
  const closable = useWorkspaceLayoutStore((state) => canRemovePane(state.layout, props.paneId));
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-md bg-background ps-1",
        REVEAL_ON_HOVER_CLASS,
      )}
    >
      {multipleGroups ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                role="button"
                tabIndex={-1}
                aria-label="Drag to move"
                draggable
                className="flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                onDragStart={(event) => startPaneDrag(event, props.paneId)}
              />
            }
          >
            <GripHorizontal className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Drag to move</TooltipPopup>
        </Tooltip>
      ) : null}
      <GroupSplitButtons groupId={props.groupId} />
      {closable ? (
        <LayoutIconButton label="Close pane" onClick={() => closeLayoutPane(props.paneId)}>
          <X className="size-3.5" />
        </LayoutIconButton>
      ) : null}
    </div>
  );
}

function startPaneDrag(event: ReactDragEvent<HTMLElement>, paneId: string) {
  event.dataTransfer.setData(PANE_DRAG_TYPE, paneId);
  event.dataTransfer.effectAllowed = "move";
  // Set after the browser snapshots the drag image, so the source does not vanish from it.
  requestAnimationFrame(() => useDragStore.getState().set(paneId));
  // A source dropped into another group unmounts, so its own dragend never fires.
  // Deferred: clearing re-renders away the shield the drop targets before React sees it.
  const clear = () => {
    window.removeEventListener("drop", clear, true);
    window.removeEventListener("dragend", clear, true);
    setTimeout(() => useDragStore.getState().set(null));
  };
  window.addEventListener("drop", clear, true);
  window.addEventListener("dragend", clear, true);
}

function LayoutIconButton(props: {
  readonly label: string;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Button
          aria-label={props.label}
          size="icon-xs"
          variant="ghost-muted"
          disabled={props.disabled}
          onClick={props.onClick}
        >
          {props.children}
        </Button>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function GroupSplitButtons(props: { readonly groupId: string }) {
  const split = (edge: LayoutEdge) => useWorkspaceLayoutStore.getState().split(props.groupId, edge);
  return (
    <>
      <LayoutIconButton label="Split right" onClick={() => split("right")}>
        <Columns2 className="size-3.5" />
      </LayoutIconButton>
      <LayoutIconButton label="Split down" onClick={() => split("bottom")}>
        <Rows2 className="size-3.5" />
      </LayoutIconButton>
    </>
  );
}

function GroupTabBar(props: { readonly group: LayoutGroup }) {
  const { group } = props;
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/30 pe-1"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PANE_DRAG_TYPE)) return;
        event.preventDefault();
        if (dropIndex === null) setDropIndex(group.panes.length);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropIndex(null);
      }}
      onDrop={(event) => {
        const paneId = event.dataTransfer.getData(PANE_DRAG_TYPE);
        const index = dropIndex ?? group.panes.length;
        setDropIndex(null);
        if (!paneId) return;
        event.preventDefault();
        useWorkspaceLayoutStore.getState().movePane(paneId, group.id, index);
      }}
    >
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto" role="tablist">
        {group.panes.map((pane, index) => (
          <PaneTab
            key={pane.id}
            pane={pane}
            active={pane.id === group.activePaneId}
            dropBefore={dropIndex === index}
            onDragOverTab={(before) => setDropIndex(before ? index : index + 1)}
          />
        ))}
        {dropIndex === group.panes.length ? <div className="h-5 w-0.5 rounded bg-primary" /> : null}
      </div>
      <div className={cn("flex items-center gap-0.5", REVEAL_ON_HOVER_CLASS)}>
        <AddPaneMenu groupId={group.id} />
        <GroupSplitButtons groupId={group.id} />
      </div>
    </div>
  );
}

function usePaneTitle(pane: LayoutPane): string {
  const chatRef =
    pane.kind === "chat" && pane.target?.kind === "server" ? pane.target.threadRef : null;
  const chatShell = useQuietThreadShell(chatRef);
  const pinnedRef =
    pane.kind === "surface" && pane.pinnedThreadKey !== null
      ? parsePinnedKey(pane.pinnedThreadKey)
      : null;
  const pinnedShell = useQuietThreadShell(pinnedRef);
  if (pane.kind === "chat") {
    if (pane.target === null) return "Choose a thread";
    if (pane.target.kind === "draft") return "New thread";
    return chatShell?.title || "Thread";
  }
  const label = surfacePaneLabel(pane);
  return pinnedShell ? `${label} · ${pinnedShell.title}` : label;
}

function parsePinnedKey(key: string) {
  const separator = key.indexOf(":");
  if (separator < 0) return null;
  return {
    environmentId: key.slice(0, separator),
    threadId: key.slice(separator + 1),
  } as Parameters<typeof scopedThreadKey>[0];
}

function PaneTab(props: {
  readonly pane: LayoutPane;
  readonly active: boolean;
  readonly dropBefore: boolean;
  readonly onDragOverTab: (before: boolean) => void;
}) {
  const { pane, active, dropBefore, onDragOverTab } = props;
  const title = usePaneTitle(pane);
  const navigateToTarget = useNavigateToTarget();
  const focused = useWorkspaceLayoutStore(
    (state) => pane.kind === "chat" && state.layout.focusedChatPaneId === pane.id,
  );
  const closable = useWorkspaceLayoutStore((state) => canRemovePane(state.layout, pane.id));
  const focusedThreadKey = useWorkspaceLayoutStore((state) => {
    const chat = layoutGroups(state.layout.root)
      .flatMap((group) => group.panes)
      .find((entry) => entry.id === state.layout.focusedChatPaneId);
    return chat?.kind === "chat" && chat.target?.kind === "server"
      ? scopedThreadKey(chat.target.threadRef)
      : null;
  });

  const activate = () => activateLayoutPane(pane.id, navigateToTarget);

  return (
    <div className="flex items-center">
      {dropBefore ? <div className="h-5 w-0.5 rounded bg-primary" /> : null}
      <div
        role="tab"
        aria-selected={active}
        tabIndex={0}
        draggable
        className={cn(
          "group/tab flex h-7 max-w-52 shrink-0 cursor-default items-center gap-1.5 rounded-md ps-2 pe-1 text-xs select-none",
          active
            ? "bg-background text-foreground shadow-xs ring-1 ring-border"
            : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
        )}
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") activate();
        }}
        onAuxClick={(event) => {
          if (event.button === 1 && closable) closeLayoutPane(pane.id);
        }}
        onDragStart={(event) => startPaneDrag(event, pane.id)}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(PANE_DRAG_TYPE)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onDragOverTab(event.clientX < rect.left + rect.width / 2);
        }}
      >
        <span className={cn("relative flex", focused && "text-primary")}>
          <SurfaceKindIcon kind={pane.kind === "chat" ? "chat" : pane.surfaceKind} />
        </span>
        <span className="min-w-0 truncate">{title}</span>
        {pane.kind === "surface" ? (
          <PinButton pane={pane} focusedThreadKey={focusedThreadKey} />
        ) : null}
        <button
          type="button"
          aria-label={`Close ${title}`}
          disabled={!closable}
          className={cn(
            "flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted disabled:hidden",
            !active && "opacity-0 group-hover/tab:opacity-100",
          )}
          onClick={(event) => {
            event.stopPropagation();
            closeLayoutPane(pane.id);
          }}
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

function PinButton(props: {
  readonly pane: SurfacePane;
  readonly focusedThreadKey: string | null;
}) {
  const { pane, focusedThreadKey } = props;
  const pinned = pane.pinnedThreadKey !== null;
  if (!pinned && focusedThreadKey === null) return null;
  return (
    <button
      type="button"
      aria-label={pinned ? "Follow the focused chat" : "Pin to this thread"}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded hover:bg-muted",
        pinned ? "text-primary" : "opacity-0 group-hover/tab:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        useWorkspaceLayoutStore.getState().setPanePinned(pane.id, pinned ? null : focusedThreadKey);
      }}
    >
      {pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
    </button>
  );
}

const SURFACE_MENU_ITEMS = [
  "terminal",
  "diff",
  "files",
  "preview",
  "pull-requests",
  "side-chat",
] as const;
type MenuSurfaceKind = (typeof SURFACE_MENU_ITEMS)[number];

/** Whether the focused chat offers a pane kind, and whether it can add one now. */
function useSurfaceKindAvailability() {
  const actions = useFocusedChatActionsStore((state) => state.actions);
  return (kind: MenuSurfaceKind | "chat") => {
    if (kind === "side-chat") {
      return {
        offered: actions?.addSideChat != null,
        enabled: actions?.addSideChat != null && actions.sideChatDisabledReason === null,
      };
    }
    const needsActions = kind === "terminal" || kind === "preview";
    return { offered: true, enabled: !needsActions || actions !== null };
  };
}

function addSurfaceToGroup(groupId: string, kind: MenuSurfaceKind) {
  const store = useWorkspaceLayoutStore.getState();
  const actions = useFocusedChatActionsStore.getState().actions;
  if (kind === "terminal" || kind === "preview" || kind === "side-chat") {
    if (!actions) return;
    store.requestSurfaceIn(groupId, null);
    if (kind === "terminal") actions.addTerminal();
    else if (kind === "preview") actions.addBrowser();
    else actions.addSideChat?.();
    return;
  }
  store.addSurfacePane(groupId, kind);
}

function AddPaneMenu(props: { readonly groupId: string }) {
  const availability = useSurfaceKindAvailability();
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label="Add pane" size="icon-xs" variant="ghost-muted" />}>
        <Plus className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" sideOffset={6}>
        <MenuItem onClick={() => useWorkspaceLayoutStore.getState().addChatPane(props.groupId)}>
          <SurfaceKindIcon kind="chat" />
          Chat
        </MenuItem>
        {SURFACE_MENU_ITEMS.filter((kind) => availability(kind).offered).map((kind) => (
          <MenuItem
            key={kind}
            disabled={!availability(kind).enabled}
            onClick={() => addSurfaceToGroup(props.groupId, kind)}
          >
            <SurfaceKindIcon kind={kind} />
            {surfaceKindLabel(kind)}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

const CHOOSER_ITEMS = [
  { kind: "chat", key: "c" },
  { kind: "terminal", key: "t" },
  { kind: "diff", key: "d" },
  { kind: "files", key: "f" },
  { kind: "preview", key: "b" },
  { kind: "pull-requests", key: "p" },
  { kind: "side-chat", key: "s" },
] as const;

function closeChooser() {
  useLayoutKeyStore.setState({ chooserGroupId: null });
}

/** Pane kinds to add to a group; each has a letter key while the chooser has focus. */
function PaneChooser(props: { readonly groupId: string; readonly prompt: string }) {
  const availability = useSurfaceKindAvailability();
  const enabled = (kind: (typeof CHOOSER_ITEMS)[number]["kind"]) => availability(kind).enabled;
  const pick = (kind: (typeof CHOOSER_ITEMS)[number]["kind"]) => {
    closeChooser();
    if (kind === "chat") useWorkspaceLayoutStore.getState().addChatPane(props.groupId);
    else addSurfaceToGroup(props.groupId, kind);
    focusGroupContent(props.groupId);
  };
  return (
    <div
      className="flex flex-col items-center gap-3 p-6 text-center"
      data-pane-chooser
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          closeChooser();
          return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const item = CHOOSER_ITEMS.find((entry) => entry.key === event.key);
        if (!item || !enabled(item.kind)) return;
        event.preventDefault();
        pick(item.kind);
      }}
    >
      <p className="text-sm text-muted-foreground">{props.prompt}</p>
      <div className="flex max-w-96 flex-wrap justify-center gap-2">
        {CHOOSER_ITEMS.filter((item) => availability(item.kind).offered).map((item) => (
          <Button
            key={item.kind}
            size="sm"
            variant="outline"
            disabled={!enabled(item.kind)}
            onClick={() => pick(item.kind)}
          >
            <SurfaceKindIcon kind={item.kind} />
            {item.kind === "chat" ? "Chat" : surfaceKindLabel(item.kind)}
            <Kbd>{item.key}</Kbd>
          </Button>
        ))}
      </div>
    </div>
  );
}

function EmptyGroup(props: { readonly groupId: string }) {
  const closable = useWorkspaceLayoutStore((state) => canRemoveGroup(state.layout, props.groupId));
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center">
      {closable ? (
        <div className="absolute top-1.5 right-1.5">
          <LayoutIconButton label="Close split" onClick={() => closeLayoutGroup(props.groupId)}>
            <X className="size-3.5" />
          </LayoutIconButton>
        </div>
      ) : null}
      <PaneChooser groupId={props.groupId} prompt="Add a pane to this split, or drag a tab here." />
    </div>
  );
}

function ChatPaneView(props: {
  readonly pane: ChatPane;
  readonly groupId: string;
  readonly solo: boolean;
  readonly routeTarget: ThreadRouteTarget;
  readonly background: boolean;
}) {
  const { pane, groupId, solo, routeTarget, background } = props;
  const focused = useWorkspaceLayoutStore((state) => state.layout.focusedChatPaneId === pane.id);
  const navigateToTarget = useNavigateToTarget();
  // Each layout belongs to one thread and the route follows its focused pane, so a pane shows its
  // own target; a thread opened from outside brings in its own layout instead. A first-run layout
  // has no target until the route syncs.
  const target = pane.target ?? (focused ? routeTarget : null);

  if (target === null) {
    return <ThreadPicker paneId={pane.id} />;
  }
  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1"
      onPointerDownCapture={(event) => {
        // Portaled surface panes this chat hosts are elsewhere on screen.
        if (focused || !event.currentTarget.contains(event.target as Node)) return;
        const next = useWorkspaceLayoutStore.getState().focusChatPane(pane.id, routeTarget);
        if (next) navigateToTarget(next);
      }}
    >
      <LayoutPaneContext
        value={{
          paneId: pane.id,
          headerActions: solo ? <ChatPaneHeaderActions groupId={groupId} paneId={pane.id} /> : null,
        }}
      >
        <ThreadRouteView target={target} background={background} routeOwner={focused} inPane />
      </LayoutPaneContext>
    </div>
  );
}

function ThreadPicker(props: { readonly paneId: string }) {
  const shells = useVisibleThreadShells();
  const [query, setQuery] = useState("");
  const navigateToTarget = useNavigateToTarget();
  const needle = query.trim().toLowerCase();
  const threads = shells
    .filter((shell) => shell.archivedAt === null)
    .filter((shell) => needle === "" || shell.title.toLowerCase().includes(needle))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 40);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto p-6 scrollbar-gutter-both">
      <div className="flex w-full max-w-md flex-col gap-3">
        <p className="text-sm font-medium">Open a thread in this pane</p>
        <Input
          autoFocus
          placeholder="Filter threads"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ul className="flex flex-col">
          {threads.map((shell) => (
            <li key={`${shell.environmentId}:${shell.id}`}>
              <button
                type="button"
                className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  const store = useWorkspaceLayoutStore.getState();
                  const target: ThreadRouteTarget = {
                    kind: "server",
                    threadRef: { environmentId: shell.environmentId, threadId: shell.id },
                  };
                  store.setChatPaneTarget(props.paneId, target);
                  activateLayoutPane(props.paneId, navigateToTarget);
                }}
              >
                {shell.title || "Untitled thread"}
              </button>
            </li>
          ))}
          {threads.length === 0 ? (
            <li className="px-2 py-1.5 text-sm text-muted-foreground">No threads match.</li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}

/** Shows a pane's stable node here; see paneNode. */
function PaneMount(props: { readonly paneId: string }) {
  const { paneId } = props;
  return (
    <div
      ref={(element) => {
        if (!element) return;
        const node = paneNode(paneId);
        element.append(node);
        return () => {
          if (node.parentNode === element) node.remove();
        };
      }}
      className="flex min-h-0 min-w-0 flex-1"
    />
  );
}

/** Every chat pane, rendered in one flat list so splits and moves never remount a ChatView. */
function ChatPaneHosts(props: {
  readonly routeTarget: ThreadRouteTarget;
  readonly background: boolean;
}) {
  const root = useWorkspaceLayoutStore((state) => state.layout.root);
  const groups = layoutGroups(root);
  const paneIds = groups.flatMap((group) => group.panes.map((pane) => pane.id)).join(" ");

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- frees the DOM nodes of panes that left the layout
  useEffect(() => {
    prunePaneNodes(new Set(paneIds.split(" ")));
  }, [paneIds]);

  // One flat keyed list: nested per-group arrays would be matched by position and remount.
  return groups.flatMap((group) =>
    group.panes.flatMap((pane) =>
      pane.kind === "chat"
        ? [
            <Fragment key={pane.id}>
              {createPortal(
                <ChatPaneView
                  pane={pane}
                  groupId={group.id}
                  solo={group.panes.length === 1}
                  routeTarget={props.routeTarget}
                  background={props.background}
                />,
                paneNode(pane.id),
              )}
            </Fragment>,
          ]
        : [],
    ),
  );
}
