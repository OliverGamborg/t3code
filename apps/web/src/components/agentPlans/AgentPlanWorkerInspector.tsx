import type { AgentCoordinationMessage, AgentTask, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  RotateCcwIcon,
  SendIcon,
  TerminalIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  canRetryMessage,
  formatShortTime,
  launchBlockerReason,
  splitPaths,
  taskContractTitles,
  taskDependencyTitles,
  taskDisplayIndex,
  taskProgress,
  taskStatusVariant,
  taskTone,
  workerProgressItems,
  type AgentPlan,
} from "./agentPlanPresentation";
import { AgentTaskStatusIcon, ProgressCheckIcon } from "./AgentPlanStatusIcon";
import { useAgentThreadDetail } from "./useAgentThreadDetail";
import { useAgentWorkerExecutionSummary } from "./useAgentWorkerExecutionSummary";

interface EditableTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly allowedPaths: string;
  readonly blockedPaths: string;
  readonly riskNotes: string;
}

export function AgentPlanWorkerInspector({
  busyAction,
  environmentId,
  instruction,
  onAskProgress,
  onInstructionChange,
  onRetryMessage,
  onSaveTask,
  onSendInstruction,
  plan,
  selectedTask,
}: {
  readonly busyAction: string | null;
  readonly environmentId: EnvironmentId | null | undefined;
  readonly instruction: string;
  readonly onAskProgress: (task: AgentTask) => void;
  readonly onInstructionChange: (value: string) => void;
  readonly onRetryMessage: (message: AgentCoordinationMessage) => void;
  readonly onSaveTask: (task: AgentTask) => void;
  readonly onSendInstruction: (task: AgentTask) => void;
  readonly plan: AgentPlan;
  readonly selectedTask: AgentTask | null;
}) {
  const [draft, setDraft] = useState<EditableTaskDraft | null>(null);
  const workerThreadId = selectedTask?.workerThreadId ?? null;
  const { thread } = useAgentThreadDetail(environmentId, workerThreadId);
  const execution = useAgentWorkerExecutionSummary(thread);

  useEffect(() => {
    setDraft(selectedTask ? taskToDraft(selectedTask) : null);
  }, [selectedTask]);

  if (!selectedTask || !draft) {
    return (
      <aside className="rounded-md border border-border bg-card/45 p-4 lg:sticky lg:top-3">
        <h2 className="text-sm font-semibold">Worker inspector</h2>
        <p className="mt-3 text-sm text-muted-foreground">Select a worker to inspect status.</p>
      </aside>
    );
  }

  const workerIndex = taskDisplayIndex(plan.tasks, selectedTask);
  const isEditable = selectedTask.status === "pending" || plan.status === "awaiting_approval";
  const progressItems = workerProgressItems(selectedTask);
  const progress = taskProgress(selectedTask);
  const relatedMessages = plan.coordinationMessages.filter(
    (message) =>
      message.toTaskIds.includes(selectedTask.id) || message.fromTaskId === selectedTask.id,
  );
  const latestDiff = thread?.turnDiffSummaries.at(-1) ?? null;
  const launchBlocker = launchBlockerReason(plan, selectedTask);
  const tone = taskTone(selectedTask.status);

  const saveDraft = () =>
    onSaveTask({
      ...selectedTask,
      title: draft.title.trim() || selectedTask.title,
      description: draft.description,
      allowedPaths: splitPaths(draft.allowedPaths),
      blockedPaths: splitPaths(draft.blockedPaths),
      riskNotes: draft.riskNotes.trim() || null,
      updatedAt: new Date().toISOString(),
    });

  return (
    <aside className="min-w-0 rounded-md border border-border bg-card/60 lg:sticky lg:top-3">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Worker inspector</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Real worker thread projections and coordination state
          </p>
        </div>
        <Badge variant={taskStatusVariant[selectedTask.status]}>{selectedTask.status}</Badge>
      </div>
      <div className="max-h-none space-y-5 overflow-y-auto p-4 lg:max-h-[calc(100vh-8rem)]">
        <div>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={taskStatusVariant[selectedTask.status]}>W{workerIndex}</Badge>
            <AgentTaskStatusIcon status={selectedTask.status} />
            <h3 className="truncate text-base font-semibold">{selectedTask.title}</h3>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedTask.description}</p>
          <dl className="mt-4 space-y-2 text-sm">
            <InspectorRow label="Project" value={String(selectedTask.projectId)} />
            <InspectorRow label="Branch" value={selectedTask.branchName ?? "Not created"} />
            <InspectorRow label="Worktree" value={selectedTask.worktreePath ?? "Not created"} />
          </dl>
          <div className="mt-4 space-y-3">
            <ChipList
              emptyLabel="No dependencies"
              items={taskDependencyTitles(plan, selectedTask)}
              label="Dependencies"
            />
            <ChipList
              emptyLabel="No required contracts"
              items={taskContractTitles(plan, selectedTask.requiredContracts)}
              label="Requires"
            />
            <ChipList
              emptyLabel="No produced contracts"
              items={taskContractTitles(plan, selectedTask.producedContracts)}
              label="Produces"
            />
          </div>
          {launchBlocker ? (
            <p className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {launchBlocker}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {selectedTask.workerThreadId && environmentId ? (
              <Button
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: selectedTask.workerThreadId }}
                  />
                }
                size="sm"
                variant="outline"
              >
                <ExternalLinkIcon />
                Open worker
              </Button>
            ) : null}
            {selectedTask.workerThreadId && environmentId && latestDiff ? (
              <Button
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{ environmentId, threadId: selectedTask.workerThreadId }}
                    search={{ diff: "1", diffTurnId: latestDiff.turnId }}
                  />
                }
                size="sm"
                variant="outline"
              >
                <GitBranchIcon />
                View diff
              </Button>
            ) : null}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span>
              {progress.done} / {progress.total} completed
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${tone.bar}`}
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            {progressItems.map((item) => (
              <div className="flex items-center gap-2 text-xs" key={item.label}>
                <ProgressCheckIcon done={item.done} />
                <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        <ExecutionPanel execution={execution} />

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Task scope</h4>
          <Input
            disabled={!isEditable}
            onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
            value={draft.title}
          />
          <Textarea
            className="min-h-24"
            disabled={!isEditable}
            onChange={(event) => setDraft({ ...draft, description: event.currentTarget.value })}
            value={draft.description}
          />
          <Textarea
            className="min-h-16"
            disabled={!isEditable}
            onChange={(event) => setDraft({ ...draft, allowedPaths: event.currentTarget.value })}
            placeholder="Allowed paths"
            value={draft.allowedPaths}
          />
          <Textarea
            className="min-h-16"
            disabled={!isEditable}
            onChange={(event) => setDraft({ ...draft, blockedPaths: event.currentTarget.value })}
            placeholder="Blocked paths"
            value={draft.blockedPaths}
          />
          <Textarea
            className="min-h-16"
            disabled={!isEditable}
            onChange={(event) => setDraft({ ...draft, riskNotes: event.currentTarget.value })}
            placeholder="Risk notes"
            value={draft.riskNotes}
          />
          <Button
            disabled={!isEditable || busyAction !== null}
            onClick={saveDraft}
            variant="outline"
          >
            <FileTextIcon />
            Save task
          </Button>
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Owner messages</h4>
          <Button
            disabled={busyAction !== null || selectedTask.workerThreadId === null}
            onClick={() => onAskProgress(selectedTask)}
            variant="outline"
          >
            <TerminalIcon />
            Ask progress
          </Button>
          <Textarea
            className="min-h-20"
            onChange={(event) => onInstructionChange(event.currentTarget.value)}
            placeholder="Send a follow-up instruction to this worker..."
            value={instruction}
          />
          <Button
            disabled={busyAction !== null || selectedTask.workerThreadId === null}
            onClick={() => onSendInstruction(selectedTask)}
          >
            <SendIcon />
            Send instruction
          </Button>
        </div>

        <CoordinationMessages
          busy={busyAction !== null}
          messages={relatedMessages}
          onRetryMessage={onRetryMessage}
        />
      </div>
    </aside>
  );
}

function ExecutionPanel({
  execution,
}: {
  readonly execution: ReturnType<typeof useAgentWorkerExecutionSummary>;
}) {
  const totalAdditions = execution.changedFiles.reduce(
    (total, file) => total + (file.additions ?? 0),
    0,
  );
  const totalDeletions = execution.changedFiles.reduce(
    (total, file) => total + (file.deletions ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <h4 className="font-semibold">Changed files</h4>
          <span className="text-xs text-muted-foreground">
            {execution.changedFiles.length} files
            {execution.changedFiles.length > 0 ? `, +${totalAdditions} / -${totalDeletions}` : ""}
          </span>
        </div>
        {execution.changedFiles.length === 0 ? (
          <EmptyMiniPanel>No changed files reported.</EmptyMiniPanel>
        ) : (
          <div className="space-y-1 rounded-md border border-border bg-background/50 p-2">
            {execution.changedFiles.slice(0, 8).map((file) => (
              <div className="flex min-w-0 items-center gap-2 text-xs" key={file.path}>
                <FileTextIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                <span className="text-emerald-500">+{file.additions ?? 0}</span>
                <span className="text-red-500">-{file.deletions ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Recent commands</h4>
        {execution.recentCommands.length === 0 ? (
          <EmptyMiniPanel>No commands reported.</EmptyMiniPanel>
        ) : (
          <div className="space-y-1 rounded-md border border-border bg-background/50 p-2">
            {execution.recentCommands.map((entry) => (
              <div className="grid grid-cols-[48px_minmax(0,1fr)] gap-2 text-xs" key={entry.id}>
                <span className="text-muted-foreground">{formatShortTime(entry.createdAt)}</span>
                <code className="truncate font-mono">{entry.command ?? entry.rawCommand}</code>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-sm font-semibold">Logs tail</h4>
        {execution.logEntries.length === 0 ? (
          <EmptyMiniPanel>No log details reported.</EmptyMiniPanel>
        ) : (
          <div className="space-y-1 rounded-md border border-border bg-background/50 p-2">
            {execution.logEntries.map((entry) => (
              <div className="text-xs" key={entry.id}>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span className="truncate">{entry.label}</span>
                  <span>{formatShortTime(entry.createdAt)}</span>
                </div>
                <pre className="mt-1 line-clamp-4 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                  {entry.detail}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CoordinationMessages({
  busy,
  messages,
  onRetryMessage,
}: {
  readonly busy: boolean;
  readonly messages: ReadonlyArray<AgentCoordinationMessage>;
  readonly onRetryMessage: (message: AgentCoordinationMessage) => void;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Coordination messages</h4>
      {messages.length === 0 ? (
        <EmptyMiniPanel>No worker-specific messages yet.</EmptyMiniPanel>
      ) : (
        messages.slice(-6).map((message) => (
          <div
            className="rounded-md border border-border bg-background/60 px-3 py-2"
            key={message.id}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium">{message.title}</p>
              <div className="flex shrink-0 items-center gap-1">
                <Badge size="sm" variant={message.status === "failed" ? "error" : "outline"}>
                  {message.status}
                </Badge>
                {canRetryMessage(message) ? (
                  <Button
                    aria-label={`Retry ${message.title}`}
                    disabled={busy}
                    onClick={() => onRetryMessage(message)}
                    size="icon-xs"
                    title="Retry message"
                    variant="ghost"
                  >
                    <RotateCcwIcon />
                  </Button>
                ) : null}
              </div>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.body}</p>
          </div>
        ))
      )}
    </div>
  );
}

function InspectorRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function ChipList({
  emptyLabel,
  items,
  label,
}: {
  readonly emptyLabel: string;
  readonly items: ReadonlyArray<string>;
  readonly label: string;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.length === 0 ? (
          <span className="text-xs text-muted-foreground">{emptyLabel}</span>
        ) : (
          items.map((item) => (
            <Badge key={item} size="sm" variant="outline">
              {item}
            </Badge>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyMiniPanel({ children }: { readonly children: ReactNode }) {
  return (
    <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function taskToDraft(task: AgentTask): EditableTaskDraft {
  return {
    title: task.title,
    description: task.description,
    allowedPaths: task.allowedPaths.join("\n"),
    blockedPaths: task.blockedPaths.join("\n"),
    riskNotes: task.riskNotes ?? "",
  };
}
