const nodes = new Map<string, HTMLDivElement>();

/**
 * One DOM node per pane for its content to portal into. Splits and moves re-parent the node, so
 * React keeps the pane's tree instead of remounting a chat or restarting a terminal view.
 */
export function paneNode(paneId: string): HTMLDivElement {
  let node = nodes.get(paneId);
  if (!node) {
    node = document.createElement("div");
    node.className = "flex min-h-0 min-w-0 flex-1 flex-col";
    nodes.set(paneId, node);
  }
  return node;
}

export function prunePaneNodes(livePaneIds: ReadonlySet<string>) {
  for (const [paneId, node] of nodes) {
    if (livePaneIds.has(paneId)) continue;
    node.remove();
    nodes.delete(paneId);
  }
}
