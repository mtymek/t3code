import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { create } from "zustand";

import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Kbd } from "../components/ui/kbd";
import { useSidebar } from "../components/ui/sidebar";
import {
  LAYOUT_PREFIX_BINDINGS,
  isLayoutPrefix,
  layoutPrefixCommand,
  ownLayoutPrefix,
  neighborGroup,
  type LayoutKeyCommand,
} from "./layoutKeys";
import { activateLayoutPane, useNavigateToTarget } from "./layoutNavigation";
import { canRemoveGroup, canRemovePane, findGroup } from "./layoutTree";
import { closeLayoutGroup, closeLayoutPane, useWorkspaceLayoutStore } from "./workspaceLayoutStore";

interface LayoutKeyState {
  /** Ctrl+B was pressed; the next key is a layout command. */
  readonly armed: boolean;
  readonly helpOpen: boolean;
  /** Group showing the pane chooser opened from the keyboard. */
  readonly chooserGroupId: string | null;
  readonly zoomedGroupId: string | null;
}

export const useLayoutKeyStore = create<LayoutKeyState>()(() => ({
  armed: false,
  helpOpen: false,
  chooserGroupId: null,
  zoomedGroupId: null,
}));

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock"]);
const FOCUS_TARGETS = [
  ".xterm-helper-textarea",
  "[contenteditable='true']",
  "textarea",
  "input",
  "button",
];

function groupSection(groupId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`section[data-group-id="${CSS.escape(groupId)}"]`);
}

/**
 * Moves keyboard focus into a group's visible pane: its chooser, terminal, composer or first
 * control. Retries for a few frames, since React may not have drawn a new split or chooser yet.
 */
export function focusGroupContent(groupId: string, options?: { readonly chooser?: boolean }) {
  const attempt = (framesLeft: number) => {
    const section = groupSection(groupId);
    const chooser = section?.querySelector<HTMLElement>(
      "[data-pane-chooser] button:not(:disabled)",
    );
    if ((!section || (options?.chooser && !chooser)) && framesLeft > 0) {
      requestAnimationFrame(() => attempt(framesLeft - 1));
      return;
    }
    if (!section) return;
    if (chooser) {
      chooser.focus({ preventScroll: true });
      return;
    }
    const pane = section.querySelector<HTMLElement>("[data-active-pane]") ?? section;
    for (const selector of FOCUS_TARGETS) {
      const target = pane.querySelector<HTMLElement>(selector);
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    section.focus({ preventScroll: true });
  };
  requestAnimationFrame(() => attempt(10));
}

let sendingPrefix = false;

/** Pressing the prefix twice gives the focused element one Ctrl+B, like tmux's send-prefix. */
function sendPrefixThrough(event: KeyboardEvent) {
  const target = event.target instanceof EventTarget ? event.target : document.activeElement;
  if (!target) return;
  const init = {
    key: event.key,
    code: event.code,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
    composed: true,
  };
  sendingPrefix = true;
  try {
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
  } finally {
    sendingPrefix = false;
  }
}

/** Ctrl+B prefix commands for the layout, as in tmux and herdr. */
export function LayoutKeyboard(props: { readonly background: boolean }) {
  const { background } = props;
  const armed = useLayoutKeyStore((state) => state.armed);
  const helpOpen = useLayoutKeyStore((state) => state.helpOpen);
  const navigate = useNavigate();
  const navigateToTarget = useNavigateToTarget();
  const { toggleSidebar } = useSidebar();

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window keydown listener for the Ctrl+B prefix, ahead of terminals and the composer
  useEffect(() => {
    if (background) return;
    const run = (command: LayoutKeyCommand) => {
      const store = useWorkspaceLayoutStore.getState();
      const keys = useLayoutKeyStore.getState();
      const groupId = store.layout.activeGroupId;
      const group = findGroup(store.layout.root, groupId);
      const showPane = (paneId: string, inGroupId: string) => {
        activateLayoutPane(paneId, navigateToTarget);
        focusGroupContent(inGroupId);
      };
      switch (command.type) {
        case "split": {
          const newGroupId = store.split(groupId, command.edge);
          useLayoutKeyStore.setState({ zoomedGroupId: null, chooserGroupId: newGroupId });
          focusGroupContent(newGroupId, { chooser: true });
          return;
        }
        case "newTab":
          useLayoutKeyStore.setState({ chooserGroupId: groupId });
          focusGroupContent(groupId, { chooser: true });
          return;
        case "closePane": {
          const paneId = group?.activePaneId ?? null;
          if (paneId !== null) {
            if (canRemovePane(store.layout, paneId)) closeLayoutPane(paneId);
          } else if (canRemoveGroup(store.layout, groupId)) {
            closeLayoutGroup(groupId);
          }
          focusGroupContent(useWorkspaceLayoutStore.getState().layout.activeGroupId);
          return;
        }
        case "closeGroup":
          if (canRemoveGroup(store.layout, groupId)) closeLayoutGroup(groupId);
          focusGroupContent(useWorkspaceLayoutStore.getState().layout.activeGroupId);
          return;
        case "go": {
          const boxes = [...document.querySelectorAll<HTMLElement>("section[data-group-id]")].map(
            (section) => ({
              id: section.dataset.groupId ?? "",
              box: section.getBoundingClientRect(),
            }),
          );
          const nextId = neighborGroup(boxes, groupId, command.direction);
          if (nextId === null) return;
          useLayoutKeyStore.setState({ zoomedGroupId: null });
          store.activateGroup(nextId);
          const paneId = findGroup(store.layout.root, nextId)?.activePaneId ?? null;
          if (paneId !== null) showPane(paneId, nextId);
          else focusGroupContent(nextId);
          return;
        }
        case "tab":
        case "tabIndex": {
          if (!group || group.panes.length === 0) return;
          const current = group.panes.findIndex((pane) => pane.id === group.activePaneId);
          const index =
            command.type === "tab"
              ? (current + command.step + group.panes.length) % group.panes.length
              : command.index;
          const pane = group.panes[index];
          if (pane) showPane(pane.id, group.id);
          return;
        }
        case "zoom":
          useLayoutKeyStore.setState({
            zoomedGroupId: keys.zoomedGroupId === groupId ? null : groupId,
          });
          return;
        case "sidebar":
          toggleSidebar();
          return;
        case "settings":
          void navigate({ to: "/settings" });
          return;
        case "help":
          useLayoutKeyStore.setState({ helpOpen: true });
          return;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (sendingPrefix) return;
      if (!useLayoutKeyStore.getState().armed) {
        if (!isLayoutPrefix(event)) return;
        // A dialog over the layout keeps its keys.
        if (
          event.target instanceof Element &&
          event.target.closest("[role='dialog'], [role='alertdialog']")
        ) {
          return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) useLayoutKeyStore.setState({ armed: true });
        return;
      }
      if (MODIFIER_KEYS.has(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      useLayoutKeyStore.setState({ armed: false });
      if (isLayoutPrefix(event)) {
        sendPrefixThrough(event);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const command = layoutPrefixCommand(event.key);
      if (command) run(command);
    };
    const release = ownLayoutPrefix();
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      release();
      useLayoutKeyStore.setState({ armed: false });
    };
  }, [background, navigate, navigateToTarget, toggleSidebar]);

  return (
    <>
      {armed ? (
        <div
          role="status"
          className="pointer-events-none fixed right-4 bottom-4 z-50 flex items-center gap-2 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground shadow-md"
        >
          <Kbd>Ctrl B</Kbd>
          <span>
            <Kbd>v</Kbd> split · <Kbd>c</Kbd> tab · <Kbd>hjkl</Kbd> move · <Kbd>?</Kbd> all
          </span>
        </div>
      ) : null}
      <Dialog
        open={helpOpen}
        onOpenChange={(open) => useLayoutKeyStore.setState({ helpOpen: open })}
      >
        <DialogPopup className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Layout shortcuts</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p className="mb-3 text-sm text-muted-foreground">
              Press <Kbd>Ctrl B</Kbd>, then:
            </p>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-sm">
              {LAYOUT_PREFIX_BINDINGS.map((binding) => (
                <div key={binding.label} className="contents">
                  <dt>
                    <Kbd>{binding.keys[0] === "X" ? "Shift X" : binding.keys[0]}</Kbd>
                  </dt>
                  <dd>{binding.label}</dd>
                </div>
              ))}
              <dt>
                <Kbd>1–9</Kbd>
              </dt>
              <dd>Tab by number</dd>
              <dt>
                <Kbd>Ctrl B</Kbd>
              </dt>
              <dd>Send Ctrl B to the focused pane</dd>
            </dl>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
