export type LayoutDirection = "left" | "right" | "up" | "down";

export type LayoutKeyCommand =
  | { readonly type: "split"; readonly edge: "right" | "bottom" }
  | { readonly type: "newTab" }
  | { readonly type: "closePane" }
  | { readonly type: "closeGroup" }
  | { readonly type: "go"; readonly direction: LayoutDirection }
  | { readonly type: "tab"; readonly step: 1 | -1 }
  | { readonly type: "tabIndex"; readonly index: number }
  | { readonly type: "zoom" }
  | { readonly type: "sidebar" }
  | { readonly type: "settings" }
  | { readonly type: "help" };

/** The keys after the Ctrl+B prefix, following tmux and herdr. */
export const LAYOUT_PREFIX_BINDINGS: ReadonlyArray<{
  readonly keys: ReadonlyArray<string>;
  readonly label: string;
  readonly command: LayoutKeyCommand;
}> = [
  { keys: ["v"], label: "Split right", command: { type: "split", edge: "right" } },
  { keys: ["-"], label: "Split down", command: { type: "split", edge: "bottom" } },
  { keys: ["c"], label: "New tab in this split", command: { type: "newTab" } },
  { keys: ["x"], label: "Close tab", command: { type: "closePane" } },
  { keys: ["X"], label: "Close split", command: { type: "closeGroup" } },
  { keys: ["h"], label: "Go left", command: { type: "go", direction: "left" } },
  { keys: ["j"], label: "Go down", command: { type: "go", direction: "down" } },
  { keys: ["k"], label: "Go up", command: { type: "go", direction: "up" } },
  { keys: ["l"], label: "Go right", command: { type: "go", direction: "right" } },
  { keys: ["n"], label: "Next tab", command: { type: "tab", step: 1 } },
  { keys: ["p"], label: "Previous tab", command: { type: "tab", step: -1 } },
  { keys: ["z"], label: "Zoom split", command: { type: "zoom" } },
  { keys: ["b"], label: "Toggle sidebar", command: { type: "sidebar" } },
  { keys: ["s"], label: "Settings", command: { type: "settings" } },
  { keys: ["?"], label: "Show shortcuts", command: { type: "help" } },
];

export function layoutPrefixCommand(key: string): LayoutKeyCommand | null {
  if (/^[1-9]$/.test(key)) return { type: "tabIndex", index: Number(key) - 1 };
  return LAYOUT_PREFIX_BINDINGS.find((binding) => binding.keys.includes(key))?.command ?? null;
}

export function isLayoutPrefix(event: KeyboardEvent): boolean {
  return (
    event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "b"
  );
}

let layoutPrefixOwners = 0;

/** Ctrl+B belongs to the layout while it is mounted, so the sidebar shortcut steps aside. */
export function claimsLayoutPrefix(event: KeyboardEvent): boolean {
  return layoutPrefixOwners > 0 && isLayoutPrefix(event);
}

export function ownLayoutPrefix(): () => void {
  layoutPrefixOwners += 1;
  return () => {
    layoutPrefixOwners -= 1;
  };
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The group next to `fromId` in a direction: among groups past its edge that overlap it on the
 * other axis, the nearest, then the one with the most overlap.
 */
export function neighborGroup(
  boxes: ReadonlyArray<{ readonly id: string; readonly box: Box }>,
  fromId: string,
  direction: LayoutDirection,
): string | null {
  const from = boxes.find((entry) => entry.id === fromId)?.box;
  if (!from) return null;
  const horizontal = direction === "left" || direction === "right";
  let best: { id: string; distance: number; overlap: number } | null = null;
  for (const { id, box } of boxes) {
    if (id === fromId) continue;
    const distance =
      direction === "left"
        ? from.left - box.right
        : direction === "right"
          ? box.left - from.right
          : direction === "up"
            ? from.top - box.bottom
            : box.top - from.bottom;
    if (distance < -1) continue;
    const overlap = horizontal
      ? Math.min(from.bottom, box.bottom) - Math.max(from.top, box.top)
      : Math.min(from.right, box.right) - Math.max(from.left, box.left);
    if (overlap <= 0) continue;
    if (
      best === null ||
      distance < best.distance - 1 ||
      (Math.abs(distance - best.distance) <= 1 && overlap > best.overlap)
    ) {
      best = { id, distance, overlap };
    }
  }
  return best?.id ?? null;
}
