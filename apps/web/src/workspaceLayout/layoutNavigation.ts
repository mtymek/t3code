import { useNavigate } from "@tanstack/react-router";

import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  type ThreadRouteTarget,
} from "../threadRoutes";
import { findPane } from "./layoutTree";
import { useWorkspaceLayoutStore } from "./workspaceLayoutStore";

export function useNavigateToTarget() {
  const navigate = useNavigate();
  return (target: ThreadRouteTarget) => {
    if (target.kind === "server") {
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(target.threadRef),
      });
    } else {
      void navigate({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(target.draftId) });
    }
  };
}

/** The route target the focused pane shows: kept in the store by syncRoute. */
function focusedRouteTarget(): ThreadRouteTarget | null {
  const { layout } = useWorkspaceLayoutStore.getState();
  if (layout.focusedChatPaneId === null) return null;
  const pane = findPane(layout.root, layout.focusedChatPaneId);
  return pane?.kind === "chat" ? pane.target : null;
}

/** Shows a pane in its group; a chat pane also takes focus, and the route follows it. */
export function activateLayoutPane(
  paneId: string,
  navigateToTarget: (target: ThreadRouteTarget) => void,
) {
  const store = useWorkspaceLayoutStore.getState();
  const pane = findPane(store.layout.root, paneId);
  if (pane?.kind === "chat" && pane.target !== null) {
    const next = store.focusChatPane(paneId, focusedRouteTarget());
    if (next) navigateToTarget(next);
    return;
  }
  store.activatePane(paneId);
}
