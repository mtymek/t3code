import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef, UiAssistantCommand } from "@t3tools/contracts";

import { openUrlInPreview } from "../../browser/openFileInPreview";
import { readThreadPreviewState } from "../../previewStateStore";
import { selectActiveRightPanelSurface, useRightPanelStore } from "../../rightPanelStore";
import { previewEnvironment } from "../../state/preview";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { recordUiAssistantExchange, useUiAssistantStore } from "../../uiAssistantStore";
import { addBrowserSurface } from "../preview/addBrowserSurface";
import { closePreviewSession } from "../preview/closePreviewSession";
import { useThreadTerminalActions } from "../terminal/useThreadTerminalActions";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { UiAssistantSubmit } from "./UiAssistantDialog";
import {
  addedUiAssistantResources,
  describeUiAssistantCommand,
  describeUiAssistantLayout,
  terminalSplitDirection,
  uiAssistantBrowserUrl,
  withThreadEntry,
  type UiAssistantCapabilities,
  type UiAssistantLayoutSnapshot,
} from "./uiAssistant.logic";

/** The chat view's own panel and terminal actions, so plans open things the way clicks do. */
export interface UiAssistantActions {
  readonly addDiffSurface: () => void;
  readonly addFilesSurface: () => void;
  readonly addPullRequestsSurface: () => void;
  readonly addTerminalSurface: () => void;
  readonly splitPanelTerminal: (direction: "horizontal" | "vertical") => void;
  readonly toggleTerminalVisibility: () => void;
  readonly setTerminalOpen: (open: boolean) => void;
  readonly createNewTerminal: () => void;
  readonly splitTerminal: (direction: "horizontal" | "vertical") => void;
}

const MIN_DRAWER_HEIGHT = 180;

function snapshotLayout(ref: ScopedThreadRef): UiAssistantLayoutSnapshot {
  const key = scopedThreadKey(ref);
  return {
    rightPanel: useRightPanelStore.getState().byThreadKey[key],
    terminal: useTerminalUiStateStore.getState().terminalUiStateByThreadKey[key],
  };
}

function drawerOpen(ref: ScopedThreadRef): boolean {
  return selectThreadTerminalUiState(
    useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
    ref,
  ).terminalOpen;
}

/** Plans a request with the environment's layout assistant model and runs it on this thread. */
export function useUiAssistant(input: {
  readonly threadRef: ScopedThreadRef | null;
  readonly capabilities: UiAssistantCapabilities;
  readonly actions: UiAssistantActions;
}): UiAssistantSubmit {
  const { threadRef, capabilities, actions } = input;
  const planUiAssistant = useAtomCommand(serverEnvironment.planUiAssistant, {
    reportFailure: false,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, "preview close");
  const terminalActions = useThreadTerminalActions(threadRef);

  const execute = async (ref: ScopedThreadRef, command: UiAssistantCommand): Promise<boolean> => {
    switch (command.command) {
      case "browser.open": {
        if (!capabilities.browserAvailable) return false;
        const result = command.url
          ? await openUrlInPreview({
              threadRef: ref,
              url: uiAssistantBrowserUrl(command.url),
              openPreview,
            })
          : await addBrowserSurface({ threadRef: ref, openPreview });
        return result._tag === "Success";
      }
      case "rightPanel.open":
        if (command.kind === "diff") {
          if (!capabilities.diffAvailable) return false;
          actions.addDiffSurface();
        } else if (command.kind === "pull-requests") {
          if (!capabilities.pullRequestsAvailable) return false;
          actions.addPullRequestsSurface();
        } else {
          actions.addFilesSurface();
        }
        return true;
      case "rightPanel.hide": {
        const store = useRightPanelStore.getState();
        store.setMaximized(ref, false);
        store.close(ref);
        return true;
      }
      case "rightPanel.maximize":
        useRightPanelStore.getState().setMaximized(ref, command.maximized);
        return true;
      case "terminal.show":
        if (!capabilities.terminalAvailable) return false;
        // Toggling reuses a running shell or starts one when the drawer is empty.
        if (!drawerOpen(ref)) actions.toggleTerminalVisibility();
        return true;
      case "terminal.hide":
        actions.setTerminalOpen(false);
        return true;
      case "terminal.new":
        if (!capabilities.terminalAvailable) return false;
        if (command.place === "panel") {
          actions.addTerminalSurface();
        } else {
          actions.createNewTerminal();
          actions.setTerminalOpen(true);
        }
        return true;
      case "terminal.split": {
        if (!capabilities.terminalAvailable) return false;
        const direction = terminalSplitDirection(command.direction);
        if (command.place === "panel") {
          const surface = selectActiveRightPanelSurface(
            useRightPanelStore.getState().byThreadKey,
            ref,
          );
          if (surface?.kind !== "terminal") return false;
          actions.splitPanelTerminal(direction);
          return true;
        }
        if (!drawerOpen(ref)) actions.toggleTerminalVisibility();
        actions.splitTerminal(direction);
        return true;
      }
      case "terminal.resize":
        useTerminalUiStateStore
          .getState()
          .setTerminalHeight(ref, Math.max(MIN_DRAWER_HEIGHT, Math.round(command.height)));
        return true;
    }
  };

  const undo = (
    ref: ScopedThreadRef,
    before: UiAssistantLayoutSnapshot,
    after: UiAssistantLayoutSnapshot,
  ) => {
    const added = addedUiAssistantResources(before, after);
    for (const terminalId of added.terminalIds) {
      terminalActions.closeTerminalSession(terminalId, ref);
    }
    const sessions = readThreadPreviewState(ref).sessions;
    for (const tabId of added.browserTabIds) {
      void closePreviewSession({
        closePreview,
        snapshot: sessions[tabId] ?? null,
        tabId,
        threadRef: ref,
      });
    }
    const key = scopedThreadKey(ref);
    useRightPanelStore.setState((state) => ({
      byThreadKey: withThreadEntry(state.byThreadKey, key, before.rightPanel),
    }));
    useTerminalUiStateStore.setState((state) => ({
      terminalUiStateByThreadKey: withThreadEntry(
        state.terminalUiStateByThreadKey,
        key,
        before.terminal,
      ),
    }));
  };

  return async (prompt, isCancelled) => {
    const ref = threadRef;
    if (!ref) return "Open a thread first.";
    const key = scopedThreadKey(ref);
    const result = await planUiAssistant({
      environmentId: ref.environmentId,
      input: {
        prompt,
        layout: describeUiAssistantLayout(snapshotLayout(ref), capabilities),
        history: useUiAssistantStore.getState().historyByThreadKey[key] ?? [],
      },
    });
    if (isCancelled()) return null;
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      return error instanceof Error ? error.message : "The layout assistant could not plan this.";
    }
    const plan = result.value;
    const before = snapshotLayout(ref);
    const ran: UiAssistantCommand[] = [];
    for (const command of plan.commands) {
      if (await execute(ref, command)) ran.push(command);
    }
    const after = snapshotLayout(ref);
    recordUiAssistantExchange(key, {
      prompt,
      reply: plan.reply || ran.map((command) => command.command).join(", "),
    });
    const summary = ran.map(describeUiAssistantCommand).join(" · ");
    if (ran.length === 0) {
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Layout unchanged",
          description: plan.reply || "The layout already matches.",
        }),
      );
      return null;
    }
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "success",
        title: "Layout updated",
        // Long enough to look at the result before deciding to undo it.
        timeout: 15_000,
        description: plan.reply ? `${summary}. ${plan.reply}` : summary,
        actionProps: {
          children: "Undo",
          onClick: () => {
            toastManager.close(toastId);
            undo(ref, before, after);
          },
        },
      }),
    );
    return null;
  };
}
