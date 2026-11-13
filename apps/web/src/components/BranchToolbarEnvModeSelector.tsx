import { ComposerSelectControl } from "./chat/ComposerControl";
import { ComposerContextLabel } from "./ComposerContextLabel";
import { FolderGit2Icon, FolderGitIcon, FolderIcon } from "lucide-react";
import { memo, type MouseEvent as ReactMouseEvent } from "react";

import {
  type CheckoutOption,
  findCheckoutOption,
  resolveCurrentWorkspaceLabel,
  resolveEnvModeLabel,
  resolveLockedWorkspaceLabel,
  resolveSelectedCheckout,
  type EnvMode,
} from "./BranchToolbar.logic";
import { CheckoutItemContent } from "./CheckoutItemContent";
import { useComposerMenuProps } from "./chat/composerEventScope";
import { PreviousWorktreeItemContent } from "./PreviousWorktreeItemContent";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectValue,
} from "./ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { useAtomValue } from "@effect/atom-react";
import { shortcutLabelForCommand } from "../keybindings";
import { primaryServerKeybindingsAtom } from "../state/server";

const PREVIOUS_WORKTREE_SELECT_VALUE = "previous-worktree";

interface BranchToolbarEnvModeSelectorProps {
  forceNewWorktree?: boolean;
  envLocked: boolean;
  effectiveEnvMode: EnvMode;
  activeWorktreePath: string | null;
  onEnvModeChange: (mode: EnvMode) => void;
  previousWorktreeLabel?: string | null;
  previousWorktreeBranch?: string | null;
  onUsePreviousWorktree?: () => void;
  /** A jj project's checkouts, listed in place of Current checkout and Previous worktree. */
  checkoutOptions?: ReadonlyArray<CheckoutOption> | null;
  onSelectCheckout?: (option: CheckoutOption) => void;
}

export const BranchToolbarEnvModeSelector = memo(function BranchToolbarEnvModeSelector({
  forceNewWorktree = false,
  envLocked,
  effectiveEnvMode,
  activeWorktreePath,
  onEnvModeChange,
  previousWorktreeLabel,
  previousWorktreeBranch = null,
  onUsePreviousWorktree,
  checkoutOptions = null,
  onSelectCheckout,
}: BranchToolbarEnvModeSelectorProps) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const shortcutLabel = shortcutLabelForCommand(
    useAtomValue(primaryServerKeybindingsAtom),
    "composer.workspace",
  );
  const showPreviousWorktree = Boolean(
    checkoutOptions === null && previousWorktreeLabel && onUsePreviousWorktree,
  );
  const selectedCheckout =
    checkoutOptions === null
      ? undefined
      : resolveSelectedCheckout({ options: checkoutOptions, effectiveEnvMode, activeWorktreePath });
  const envModeItems = checkoutOptions
    ? [
        { value: "worktree", label: resolveEnvModeLabel("worktree") },
        ...checkoutOptions.map(({ value, label }) => ({ value, label })),
      ]
    : [
        {
          value: "local",
          label: resolveCurrentWorkspaceLabel(activeWorktreePath),
        },
        { value: "worktree", label: resolveEnvModeLabel("worktree") },
        ...(showPreviousWorktree && previousWorktreeLabel
          ? [{ value: PREVIOUS_WORKTREE_SELECT_VALUE, label: previousWorktreeLabel }]
          : []),
      ];

  const stopContextMenuMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0 || event.ctrlKey) {
      event.stopPropagation();
    }
  };

  if (envLocked || forceNewWorktree) {
    const lockedRow = (
      <span
        className="inline-flex h-7 min-w-0 items-center gap-1.5 border border-transparent px-1.75 font-normal text-muted-foreground/70 text-sm sm:h-6 sm:text-xs"
        data-composer-context-control
      >
        {activeWorktreePath ? (
          <FolderGitIcon className="size-3" />
        ) : effectiveEnvMode === "worktree" ? (
          <FolderGit2Icon className="size-3" />
        ) : (
          <FolderIcon className="size-3" />
        )}
        <ComposerContextLabel>
          {forceNewWorktree
            ? resolveEnvModeLabel("worktree")
            : resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode)}
        </ComposerContextLabel>
      </span>
    );

    return (
      <Tooltip>
        <TooltipTrigger render={lockedRow} />
        <TooltipPopup>
          {forceNewWorktree
            ? "Each model starts in its own worktree."
            : (activeWorktreePath ??
              resolveLockedWorkspaceLabel(activeWorktreePath, effectiveEnvMode))}
        </TooltipPopup>
      </Tooltip>
    );
  }

  return (
    <Select
      modal={false}
      value={selectedCheckout?.value ?? effectiveEnvMode}
      onValueChange={(value: string | null) => {
        const checkout = findCheckoutOption(checkoutOptions ?? [], value);
        if (checkout) {
          onSelectCheckout?.(checkout);
          return;
        }
        if (value === PREVIOUS_WORKTREE_SELECT_VALUE) {
          onUsePreviousWorktree?.();
          return;
        }
        onEnvModeChange(value as EnvMode);
      }}
      items={envModeItems}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComposerSelectControl
              size="xs"
              className="min-w-0 shrink"
              aria-label="Workspace"
              data-composer-shortcut="composer.workspace"
              data-composer-context-control
              onMouseDownCapture={stopContextMenuMouseDown}
            />
          }
        >
          {effectiveEnvMode === "worktree" ? (
            <FolderGit2Icon className="size-3" />
          ) : activeWorktreePath ? (
            <FolderGitIcon className="size-3" />
          ) : (
            <FolderIcon className="size-3" />
          )}
          <ComposerContextLabel>
            <SelectValue />
          </ComposerContextLabel>
        </TooltipTrigger>
        <TooltipPopup>
          {selectedCheckout
            ? (activeWorktreePath ?? selectedCheckout.label)
            : effectiveEnvMode === "worktree"
              ? resolveEnvModeLabel("worktree")
              : resolveCurrentWorkspaceLabel(activeWorktreePath)}
          {shortcutLabel ? ` · ${shortcutLabel}` : null}
        </TooltipPopup>
      </Tooltip>
      <SelectPopup
        alignItemWithTrigger={false}
        {...composerFloatingLayerProps}
        className={
          showPreviousWorktree || checkoutOptions ? "w-[min(21rem,calc(100vw-2rem))]" : undefined
        }
      >
        <SelectGroup>
          <SelectGroupLabel>Workspace</SelectGroupLabel>
          {checkoutOptions ? (
            <>
              <SelectItem value="worktree">
                <span className="inline-flex items-center gap-1.5">
                  <FolderGit2Icon className="size-3" />
                  {resolveEnvModeLabel("worktree")}
                </span>
              </SelectItem>
              {checkoutOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <CheckoutItemContent option={option} />
                </SelectItem>
              ))}
            </>
          ) : (
            <>
              <SelectItem value="local">
                <span className="inline-flex items-center gap-1.5">
                  {activeWorktreePath ? (
                    <FolderGitIcon className="size-3" />
                  ) : (
                    <FolderIcon className="size-3" />
                  )}
                  {resolveCurrentWorkspaceLabel(activeWorktreePath)}
                </span>
              </SelectItem>
              <SelectItem value="worktree">
                <span className="inline-flex items-center gap-1.5">
                  <FolderGit2Icon className="size-3" />
                  {resolveEnvModeLabel("worktree")}
                </span>
              </SelectItem>
            </>
          )}
          {showPreviousWorktree && previousWorktreeLabel ? (
            <SelectItem value={PREVIOUS_WORKTREE_SELECT_VALUE}>
              <PreviousWorktreeItemContent branch={previousWorktreeBranch} />
            </SelectItem>
          ) : null}
        </SelectGroup>
      </SelectPopup>
    </Select>
  );
});
