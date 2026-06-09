import {
  FileTextIcon,
  GitBranchIcon,
  MoreVerticalIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "~/components/ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "~/components/ui/menu";

interface ActionItem {
  readonly label: string;
  readonly disabledReason: string | null;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

export function AgentPlanActionMenu({
  allTerminal,
  busyAction,
  canStartOwner,
  hasTasks,
  onApproveAndLaunch,
  onImportOwnerOutput,
  onLaunchReadyWorkers,
  onStartOwnerPlanning,
  onStartReview,
}: {
  readonly allTerminal: boolean;
  readonly busyAction: string | null;
  readonly canStartOwner: boolean;
  readonly hasTasks: boolean;
  readonly onApproveAndLaunch: () => void;
  readonly onImportOwnerOutput: () => void;
  readonly onLaunchReadyWorkers: () => void;
  readonly onStartOwnerPlanning: () => void;
  readonly onStartReview: () => void;
}) {
  const busyReason = busyAction ? "Another plan action is running." : null;
  const actions: ActionItem[] = [
    {
      label: "Start owner",
      icon: <PlayIcon />,
      disabledReason: busyReason ?? (canStartOwner ? null : "Owner is already active."),
      onSelect: onStartOwnerPlanning,
    },
    {
      label: "Import owner output",
      icon: <FileTextIcon />,
      disabledReason: busyReason,
      onSelect: onImportOwnerOutput,
    },
    {
      label: "Approve and launch",
      icon: <ShieldCheckIcon />,
      disabledReason: busyReason ?? (hasTasks ? null : "Import tasks before approving."),
      onSelect: onApproveAndLaunch,
    },
    {
      label: "Launch ready workers",
      icon: <RotateCcwIcon />,
      disabledReason: busyReason,
      onSelect: onLaunchReadyWorkers,
    },
    {
      label: "Start review",
      icon: <GitBranchIcon />,
      disabledReason:
        busyReason ?? (allTerminal ? null : "All non-cancelled tasks must finish first."),
      onSelect: onStartReview,
    },
  ];

  return (
    <Menu>
      <MenuTrigger
        render={<Button size="sm" variant="outline" aria-label="Agent plan actions" />}
        className="gap-2"
      >
        <MoreVerticalIcon />
        Actions
      </MenuTrigger>
      <MenuPopup align="end" className="w-64">
        <MenuGroup>
          <MenuGroupLabel>Agent plan</MenuGroupLabel>
          {actions.map((action) => (
            <MenuItem
              key={action.label}
              disabled={action.disabledReason !== null}
              onClick={action.onSelect}
              title={action.disabledReason ?? undefined}
            >
              {action.icon}
              <span className="min-w-0 flex-1 truncate">{action.label}</span>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <div className="px-2 py-1 text-xs text-muted-foreground">
          Disabled actions expose their reason on hover.
        </div>
      </MenuPopup>
    </Menu>
  );
}
