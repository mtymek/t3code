import { useAtomValue } from "@effect/atom-react";
import { HistoryIcon, LayoutPanelLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";

import { setUiAssistantOpen, useUiAssistantStore } from "../../uiAssistantStore";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteContent } from "../CommandPaletteContent";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { CommandDialog, CommandDialogPopup } from "../ui/command";
import { Spinner } from "../ui/spinner";

/** Resolves with an error to show, or null once the plan ran (or was cancelled). */
export type UiAssistantSubmit = (
  prompt: string,
  isCancelled: () => boolean,
) => Promise<string | null>;

export function UiAssistantDialog({ onSubmit }: { readonly onSubmit: UiAssistantSubmit }) {
  const open = useUiAssistantStore((state) => state.open);
  return (
    <CommandDialog open={open} onOpenChange={setUiAssistantOpen}>
      {open ? <UiAssistantPopup onSubmit={onSubmit} /> : null}
    </CommandDialog>
  );
}

function UiAssistantPopup({ onSubmit }: { readonly onSubmit: UiAssistantSubmit }) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const recentPrompts = useUiAssistantStore((state) => state.recentPrompts);
  const [text, setText] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Closing while a plan is on its way drops the plan instead of rearranging the screen later.
  const closedRef = useRef(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks an in-flight plan stale when the popup unmounts
  useEffect(() => {
    // StrictMode remounts after a cleanup, so reset here instead of relying on useRef's initial value.
    closedRef.current = false;
    return () => {
      closedRef.current = true;
    };
  }, []);

  const submit = (prompt: string) => {
    const trimmed = prompt.trim();
    if (trimmed.length === 0 || pending !== null) return;
    setPending(trimmed);
    setError(null);
    void onSubmit(trimmed, () => closedRef.current).then((message) => {
      if (closedRef.current) return;
      if (message === null) {
        setUiAssistantOpen(false);
        return;
      }
      setPending(null);
      setError(message);
    });
  };

  const query = text.trim().toLowerCase();
  const items: CommandPaletteActionItem[] = recentPrompts
    .filter((prompt) => query.length === 0 || prompt.toLowerCase().includes(query))
    .map((prompt) => ({
      kind: "action",
      value: `recent:${prompt}`,
      searchTerms: [prompt],
      title: prompt,
      icon: <HistoryIcon />,
      run: async () => submit(prompt),
    }));

  return (
    <CommandDialogPopup
      aria-label="Arrange this thread"
      className="overflow-hidden"
      data-testid="ui-assistant"
      onBackdropPointerDown={() => setUiAssistantOpen(false)}
      finalFocus={false}
    >
      <CommandPaletteContent
        aria-label="Arrange this thread"
        autoHighlight={false}
        escapeLabel={pending === null ? "Close" : "Cancel"}
        footerActionLabel={pending === null ? "Run" : undefined}
        inputProps={{
          placeholder: "Arrange this thread… browser on the right, terminal below",
          startAddon: <LayoutPanelLeftIcon />,
          disabled: pending !== null,
          onKeyDown: (event) => {
            if (event.key !== "Enter" || highlighted !== null) return;
            event.preventDefault();
            submit(text);
          },
        }}
        mode="none"
        onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
        onValueChange={(value) => {
          setHighlighted(null);
          setText(value);
        }}
        value={pending ?? text}
      >
        {pending !== null ? (
          <div
            role="status"
            className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"
          >
            <Spinner />
            Planning…
          </div>
        ) : error !== null ? (
          <div role="alert" className="px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : items.length > 0 ? (
          <CommandPaletteResults
            groups={[{ value: "recent", label: "Recent", items }]}
            highlightedItemValue={highlighted}
            isActionsOnly
            keybindings={keybindings}
            onExecuteItem={(item) => {
              if (item.kind === "action") void item.run();
            }}
          />
        ) : null}
      </CommandPaletteContent>
    </CommandDialogPopup>
  );
}
