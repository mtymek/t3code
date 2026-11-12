import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import {
  RightPanelSurfaceContent,
  type RightPanelSurfaceContentProps,
} from "../components/chat/RightPanelSurfaceContent";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../components/ui/empty";
import {
  selectThreadRightPanelState,
  useRightPanelStore,
  type ThreadRightPanelState,
} from "../rightPanelStore";
import {
  findPaneGroup,
  hostedSurfacePanes,
  layoutGroups,
  resolvePaneSurfaces,
  type SurfacePane,
} from "./layoutTree";
import { surfacePaneLabel } from "./paneLabels";
import {
  useFocusedChatActionsStore,
  usePaneCloseStore,
  useWorkspaceLayoutStore,
} from "./workspaceLayoutStore";
import { paneNode } from "./paneNodes";

/**
 * Renders the surface panes a layout chat pane owns into their pane elements, and turns
 * right panel opens on the focused thread into panes. Lives inside ChatView, which already
 * computes everything the surfaces need.
 */
export function LayoutSurfaceHost(props: {
  readonly paneId: string;
  readonly threadRef: ScopedThreadRef;
  readonly surfaceProps: Omit<
    RightPanelSurfaceContentProps,
    "surface" | "visible" | "activeSurfaceId"
  >;
  readonly onAddTerminal: () => void;
  readonly onAddBrowser: () => void;
  readonly onAddSideChat: (() => void) | undefined;
  readonly sideChatDisabledReason: string | null;
}) {
  const {
    paneId,
    threadRef,
    surfaceProps,
    onAddTerminal,
    onAddBrowser,
    onAddSideChat,
    sideChatDisabledReason,
  } = props;
  const threadKey = scopedThreadKey(threadRef);
  const layout = useWorkspaceLayoutStore((state) => state.layout);
  const isFocused = layout.focusedChatPaneId === paneId;
  const hosted = hostedSurfacePanes(layout, paneId, threadKey);
  const surfaces = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).surfaces,
  );
  const activeSurfaceId = useRightPanelStore(
    (state) => selectThreadRightPanelState(state.byThreadKey, threadRef).activeSurfaceId,
  );
  const resolved = resolvePaneSurfaces(hosted, surfaces);
  const activePaneIds = new Set(layoutGroups(layout.root).map((group) => group.activePaneId));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes this thread's launch actions to the layout's add menus while this chat has focus
  useEffect(() => {
    if (!isFocused) return;
    const { setActions } = useFocusedChatActionsStore.getState();
    setActions({
      addTerminal: onAddTerminal,
      addBrowser: onAddBrowser,
      openSurface: (kind) => useRightPanelStore.getState().open(threadRef, kind),
      addSideChat: onAddSideChat ?? null,
      sideChatDisabledReason,
    });
    return () => setActions(null);
  }, [isFocused, onAddTerminal, onAddBrowser, onAddSideChat, sideChatDisabledReason, threadRef]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- subscribes to right panel opens from chat actions and keybindings, which the layout shows as panes
  useEffect(() => {
    if (!isFocused) return;
    const adopt = (state: ThreadRightPanelState) => {
      const layoutNow = useWorkspaceLayoutStore.getState().layout;
      const hostedNow = hostedSurfacePanes(layoutNow, paneId, threadKey);
      useWorkspaceLayoutStore.getState().adoptSurface({
        surface: state.surfaces.find((surface) => surface.id === state.activeSurfaceId) ?? null,
        hostedPanes: hostedNow,
        resolved: resolvePaneSurfaces(hostedNow, state.surfaces),
      });
      // The open flag is a request the layout consumed; the next open sets it again.
      useRightPanelStore.getState().close(threadRef);
    };
    const initial = selectThreadRightPanelState(
      useRightPanelStore.getState().byThreadKey,
      threadRef,
    );
    if (initial.isOpen) adopt(initial);
    return useRightPanelStore.subscribe((state, previous) => {
      const next = selectThreadRightPanelState(state.byThreadKey, threadRef);
      if (!next.isOpen) return;
      const before = selectThreadRightPanelState(previous.byThreadKey, threadRef);
      if (before.isOpen && before.activeSurfaceId === next.activeSurfaceId) return;
      adopt(next);
    });
  }, [isFocused, paneId, threadKey, threadRef]);

  const onCloseSurface = surfaceProps.onCloseSurface;
  // Panes whose surface close was requested; they leave once the surface does, so a cancelled
  // confirmation keeps the pane.
  const closingRef = useRef(new Map<string, string>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- publishes close handlers for the panes this chat renders to the layout's tab bars
  useEffect(() => {
    const closing = closingRef.current;
    for (const [closingPaneId, surfaceId] of closing) {
      if (surfaces.some((entry) => entry.id === surfaceId)) continue;
      closing.delete(closingPaneId);
      useWorkspaceLayoutStore.getState().closePane(closingPaneId);
    }
    const handlers: Record<string, () => void> = {};
    for (const pane of hosted) {
      const surface = resolved.get(pane.id);
      if (surface && surfaces.some((entry) => entry.id === surface.id)) {
        handlers[pane.id] = () => {
          closing.set(pane.id, surface.id);
          onCloseSurface(surface);
        };
      }
    }
    usePaneCloseStore.getState().setHandlers(paneId, handlers);
  }, [hosted, resolved, surfaces, onCloseSurface, paneId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- drops this chat's close handlers from the layout store when it unmounts
  useEffect(() => () => usePaneCloseStore.getState().setHandlers(paneId, {}), [paneId]);

  return hosted.map((pane) => {
    const surface = resolved.get(pane.id) ?? null;
    // Like the right panel, only a group's active tab mounts its surface.
    if (!activePaneIds.has(pane.id)) return null;
    return createPortal(
      <div
        className="flex h-full min-h-0 w-full min-w-0 flex-col"
        // Terminal split and close act on the thread's active surface.
        onPointerDownCapture={() => {
          if (surface && activeSurfaceId !== surface.id) {
            useRightPanelStore.getState().revealSurface(threadRef, surface.id);
          }
        }}
      >
        {surface ? (
          <RightPanelSurfaceContent
            {...surfaceProps}
            surface={surface}
            activeSurfaceId={surface.id}
            visible
            onNavigateFolder={(source, relativePath, folderTrail, keepSource) => {
              const rightPanel = useRightPanelStore.getState();
              rightPanel.ensureSurface(threadRef, source);
              if (!keepSource) {
                // The pane moves with the browser, so the opened entry is already on screen.
                useWorkspaceLayoutStore.getState().retargetSurfacePane(
                  pane.id,
                  relativePath === ""
                    ? { id: "files", kind: "files" }
                    : {
                        id: `file:${relativePath}`,
                        kind: "file",
                        relativePath,
                        revealLine: null,
                        revealRequestId: 0,
                      },
                );
              }
              rightPanel.navigateFolder(
                threadRef,
                source.id,
                relativePath,
                folderTrail,
                keepSource,
              );
            }}
          />
        ) : (
          <MissingSurface
            pane={pane}
            onStart={
              pane.surfaceKind === "terminal"
                ? onAddTerminal
                : pane.surfaceKind === "preview"
                  ? onAddBrowser
                  : null
            }
          />
        )}
      </div>,
      paneNode(pane.id),
      pane.id,
    );
  });
}

function MissingSurface(props: {
  readonly pane: SurfacePane;
  readonly onStart: (() => void) | null;
}) {
  const { pane, onStart } = props;
  const label = surfacePaneLabel(pane);
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>No {label.toLowerCase()} in this thread</EmptyTitle>
        <EmptyDescription>
          {onStart
            ? "This pane shows the thread you focus. Start one here for this thread."
            : "This pane shows the thread you focus, and that thread has nothing of this kind."}
        </EmptyDescription>
      </EmptyHeader>
      {onStart ? (
        <EmptyContent>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const store = useWorkspaceLayoutStore.getState();
              const group = findPaneGroup(store.layout.root, pane.id);
              store.requestSurfaceIn(group?.id ?? null, pane.id);
              onStart();
            }}
          >
            Start {label.toLowerCase()}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
