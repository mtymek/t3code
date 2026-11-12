import {
  Files,
  FileDiff,
  FileText,
  Globe,
  MessageSquare,
  MessagesSquare,
  Smartphone,
  TerminalSquare,
} from "lucide-react";
import { createContext, type ReactNode } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import type { RightPanelKind } from "../rightPanelStore";
import type { SurfacePane } from "./layoutTree";

/** Set for a ChatView rendered in a layout chat pane; it then hosts surfaces as panes. */
export const LayoutPaneContext = createContext<{
  readonly paneId: string;
  /** Layout controls for the chat's header, when no tab bar carries them. */
  readonly headerActions: ReactNode;
} | null>(null);

const KIND_LABELS: Record<RightPanelKind, string> = {
  diff: "Diff",
  files: "Files",
  file: "File",
  preview: "Browser",
  device: "Device",
  terminal: "Terminal",
  "pull-request": "Pull request",
  "pull-requests": "Pull requests",
  "side-chat": "Side chat",
};

export function surfaceKindLabel(kind: RightPanelKind): string {
  return KIND_LABELS[kind];
}

export function surfacePaneLabel(pane: SurfacePane): string {
  if (pane.surfaceKind === "file" && pane.surfaceId?.startsWith("file:")) {
    const path = pane.surfaceId.slice("file:".length);
    return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || "File";
  }
  if (pane.surfaceKind === "pull-request" && pane.surfaceId) {
    const number = pane.surfaceId.split(":").at(-1);
    if (number && /^\d+$/.test(number)) return `#${number}`;
  }
  return KIND_LABELS[pane.surfaceKind];
}

export function SurfaceKindIcon(props: { readonly kind: RightPanelKind | "chat" }) {
  const className = "size-3.5 shrink-0";
  switch (props.kind) {
    case "chat":
      return <MessageSquare className={className} />;
    case "diff":
      return <FileDiff className={className} />;
    case "files":
      return <Files className={className} />;
    case "file":
      return <FileText className={className} />;
    case "preview":
      return <Globe className={className} />;
    case "device":
      return <Smartphone className={className} />;
    case "terminal":
      return <TerminalSquare className={className} />;
    case "pull-request":
    case "pull-requests":
      return <PullRequestGlyph.pullRequest className={className} />;
    case "side-chat":
      return <MessagesSquare className={className} />;
  }
}
