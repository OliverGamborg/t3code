import { DEFAULT_THREAD_AGENT_METADATA, type ThreadId } from "@t3tools/contracts";
import { ArrowLeftIcon, NetworkIcon, PanelRightCloseIcon } from "lucide-react";
import { memo } from "react";

import { formatWorkspaceRelativePath } from "../filePathDisplay";
import {
  latestWorkerReport,
  resolveWorkerStatus,
  workerStatusClassName,
  type WorkerThreadReport,
} from "../subagentActivities";
import { formatRelativeTimeLabel } from "../timestampFormat";
import type { Thread } from "../types";
import { cn } from "~/lib/utils";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";

interface SubagentsSidebarProps {
  readonly activeThreadId: ThreadId;
  readonly ownerThread: Thread | null;
  readonly workers: readonly Thread[];
  readonly workspaceRoot: string | undefined;
  readonly mode?: "sidebar" | "embedded";
  readonly onClose: () => void;
  readonly onOpenOwner: (owner: Thread) => void;
  readonly onOpenWorker: (worker: Thread) => void;
}

function reportSupplement(report: WorkerThreadReport | null, workspaceRoot: string | undefined) {
  if (!report) {
    return null;
  }

  const changedFiles = report.changedFiles.filter((path) => path.trim().length > 0);
  if (changedFiles.length > 0) {
    const firstPath = formatWorkspaceRelativePath(changedFiles[0]!, workspaceRoot);
    return changedFiles.length === 1 ? firstPath : `${firstPath} +${changedFiles.length - 1}`;
  }

  if (report.testResults.length > 0) {
    return report.testResults.length === 1
      ? report.testResults[0]
      : `${report.testResults.length} test updates`;
  }

  if (report.blockers.length > 0) {
    return report.blockers.length === 1 ? report.blockers[0] : `${report.blockers.length} blockers`;
  }

  return null;
}

function SubagentCard(props: {
  readonly ownerThread: Thread;
  readonly worker: Thread;
  readonly active: boolean;
  readonly workspaceRoot: string | undefined;
  readonly onOpen: (worker: Thread) => void;
}) {
  const metadata = props.worker.agentMetadata ?? DEFAULT_THREAD_AGENT_METADATA;
  const report = latestWorkerReport(props.ownerThread, props.worker.id);
  const status = resolveWorkerStatus(props.ownerThread, props.worker);
  const supplement = reportSupplement(report, props.workspaceRoot);
  const location = props.worker.branch ?? props.worker.worktreePath ?? metadata.taskKey;

  return (
    <button
      type="button"
      data-testid={`subagent-thread-card-${props.worker.id}`}
      className={cn(
        "w-full rounded-lg border bg-card/70 p-3 text-left transition-colors",
        props.active
          ? "border-primary/45 bg-primary/5"
          : "border-border hover:border-border/80 hover:bg-muted/50",
      )}
      onClick={() => props.onOpen(props.worker)}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">{props.worker.title}</div>
          <div className="truncate text-xs text-muted-foreground">
            {location ? formatWorkspaceRelativePath(location, props.workspaceRoot) : "Subagent"}
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] capitalize leading-none",
            workerStatusClassName(status),
          )}
        >
          {status}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {report
          ? `${report.summary} · ${formatRelativeTimeLabel(report.createdAt)}`
          : metadata.taskTitle || "No report yet"}
      </div>
      {supplement ? (
        <div className="mt-2 truncate rounded-md bg-muted/45 px-2 py-1 text-[11px] text-muted-foreground">
          {supplement}
        </div>
      ) : null}
    </button>
  );
}

const SubagentsSidebar = memo(function SubagentsSidebar({
  activeThreadId,
  ownerThread,
  workers,
  workspaceRoot,
  mode = "embedded",
  onClose,
  onOpenOwner,
  onOpenWorker,
}: SubagentsSidebarProps) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col bg-card/50",
        mode === "sidebar"
          ? "h-full w-[340px] shrink-0 border-l border-border/70"
          : "h-full w-full",
      )}
      data-testid="subagents-sidebar"
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant="info"
            size="sm"
            className="rounded-md px-1.5 py-0 font-semibold tracking-wide uppercase"
          >
            Subagents
          </Badge>
          <span className="text-[11px] text-muted-foreground/60 tabular-nums">
            {workers.length}
          </span>
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onClose}
          aria-label="Close subagents sidebar"
          className="text-muted-foreground/50 hover:text-foreground/70"
        >
          <PanelRightCloseIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {ownerThread && ownerThread.id !== activeThreadId ? (
            <button
              type="button"
              data-testid="subagents-back-to-owner"
              className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-border bg-background/65 px-3 py-2 text-left transition hover:bg-muted/50"
              onClick={() => onOpenOwner(ownerThread)}
            >
              <ArrowLeftIcon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="text-xs font-medium text-foreground">Back to owner</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {ownerThread.title}
                </div>
              </div>
            </button>
          ) : null}

          {ownerThread && workers.length > 0 ? (
            <div className="space-y-2">
              {workers.map((worker) => (
                <SubagentCard
                  key={worker.id}
                  ownerThread={ownerThread}
                  worker={worker}
                  active={worker.id === activeThreadId}
                  workspaceRoot={workspaceRoot}
                  onOpen={onOpenWorker}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <NetworkIcon className="mb-3 size-5 text-muted-foreground/35" />
              <p className="text-[13px] text-muted-foreground/50">No subagents yet.</p>
              <p className="mt-1 max-w-56 text-[11px] leading-relaxed text-muted-foreground/35">
                Subagents will appear here after the owner thread launches workers.
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
});

export default SubagentsSidebar;
export type { SubagentsSidebarProps };
