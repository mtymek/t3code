import { FolderGitIcon, FolderIcon } from "lucide-react";

import type { CheckoutOption } from "./BranchToolbar.logic";
import { MiddleTruncate } from "./ui/middle-truncate";

export function CheckoutItemContent({ option }: { option: CheckoutOption }) {
  const Icon = option.isProjectCheckout ? FolderIcon : FolderGitIcon;
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <Icon className="mt-1 size-3 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <MiddleTruncate value={option.label} />
        {option.detail ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{option.detail}</span>
        ) : null}
      </span>
    </span>
  );
}
