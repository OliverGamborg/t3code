import type {
  AgentCoordinationMessage,
  AgentPlanDetailSnapshot,
  AgentReview,
  AgentSharedUpdate,
  AgentTask,
  AgentTaskStatus,
  TurnId,
} from "@t3tools/contracts";
import type { TurnDiffFileChange } from "~/types";
import type { WorkLogEntry } from "~/session-logic";

export const planStatusVariant = {
  draft: "outline",
  planning: "info",
  awaiting_approval: "warning",
  running: "info",
  reviewing: "warning",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

export const taskStatusVariant = {
  pending: "outline",
  running: "info",
  blocked: "warning",
  done: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

export type AgentPlan = AgentPlanDetailSnapshot["plan"];

export interface AgentPlanTaskCounts {
  readonly pending: number;
  readonly running: number;
  readonly blocked: number;
  readonly done: number;
  readonly failed: number;
  readonly cancelled: number;
}

export interface WorkerProgressItem {
  readonly label: string;
  readonly done: boolean;
}

export interface WorkerProgress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

export interface AgentActivityItemModel {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly at: string;
  readonly type: string;
  readonly status?: string;
  readonly taskId?: AgentTask["id"] | null;
  readonly message?: AgentCoordinationMessage;
}

export interface WorkerExecutionSummary {
  readonly changedFiles: ReadonlyArray<TurnDiffFileChange>;
  readonly recentCommands: ReadonlyArray<WorkLogEntry>;
  readonly logEntries: ReadonlyArray<WorkLogEntry>;
  readonly latestDiffTurnId: TurnId | null;
}

export function countTasks(tasks: ReadonlyArray<AgentTask>): AgentPlanTaskCounts {
  return {
    pending: tasks.filter((task) => task.status === "pending").length,
    running: tasks.filter((task) => task.status === "running").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    done: tasks.filter((task) => task.status === "done").length,
    failed: tasks.filter((task) => task.status === "failed").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
  };
}

export function workerProgressItems(task: AgentTask): WorkerProgressItem[] {
  return [
    { label: "Task imported", done: true },
    {
      label: "Approved",
      done: task.status !== "pending" || task.workerThreadId !== null,
    },
    { label: "Worktree created", done: task.worktreePath !== null },
    { label: "Worker thread started", done: task.workerThreadId !== null },
    {
      label: "First report received",
      done: task.summary !== null || ["blocked", "done", "failed"].includes(task.status),
    },
    { label: "Tests reported", done: task.status === "done" || task.status === "failed" },
    { label: "Done/failed", done: task.status === "done" || task.status === "failed" },
  ];
}

export function taskProgress(task: AgentTask): WorkerProgress {
  const items = workerProgressItems(task);
  const done = items.filter((item) => item.done).length;
  return {
    done,
    total: items.length,
    percent: Math.round((done / items.length) * 100),
  };
}

export function launchBlockerReason(plan: AgentPlan, task: AgentTask): string | null {
  if (task.status !== "pending") return "Only pending tasks can be launched.";
  if (task.workerThreadId !== null) return "Worker thread already exists.";
  const unmet = task.dependsOn.filter(
    (taskId) => plan.tasks.find((candidate) => candidate.id === taskId)?.status !== "done",
  );
  if (unmet.length > 0) {
    return `Waiting on ${unmet.length} ${unmet.length === 1 ? "dependency" : "dependencies"}.`;
  }
  return null;
}

export function canRetryMessage(message: AgentCoordinationMessage): boolean {
  return (
    (message.status === "queued" || message.status === "failed") &&
    (message.toTarget === "worker" || message.toTarget === "owner")
  );
}

export function makeActivity(
  updates: ReadonlyArray<AgentSharedUpdate>,
  messages: ReadonlyArray<AgentCoordinationMessage>,
  reviews: ReadonlyArray<AgentReview>,
): AgentActivityItemModel[] {
  return [
    ...updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      at: update.createdAt,
      type: update.type,
      taskId: update.taskId,
    })),
    ...messages.map((message) => ({
      id: message.id,
      title: message.title,
      body: message.body,
      at: message.createdAt,
      type: message.kind,
      status: message.status,
      taskId: message.fromTaskId ?? message.toTaskIds[0] ?? null,
      message,
    })),
    ...reviews.map((review) => ({
      id: review.id,
      title: review.status === "pending" ? "Review started" : `Review ${review.status}`,
      body: review.summary || "Reviewer is preparing a merge recommendation.",
      at: review.updatedAt,
      type: "review",
      status: review.status,
      taskId: null,
    })),
  ].toSorted((left, right) => right.at.localeCompare(left.at));
}

export function taskTone(status: AgentTaskStatus): {
  readonly card: string;
  readonly bar: string;
  readonly accent: string;
} {
  switch (status) {
    case "done":
      return {
        card: "border-emerald-500/45 bg-emerald-500/8 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
        bar: "bg-emerald-500",
        accent: "text-emerald-500",
      };
    case "running":
      return {
        card: "border-emerald-500/40 bg-emerald-500/8 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]",
        bar: "bg-emerald-500",
        accent: "text-emerald-500",
      };
    case "blocked":
    case "failed":
      return {
        card: "border-red-500/45 bg-red-500/8 shadow-[0_0_0_1px_rgba(239,68,68,0.08)]",
        bar: "bg-red-500",
        accent: "text-red-500",
      };
    case "pending":
      return {
        card: "border-amber-500/45 bg-amber-500/8 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]",
        bar: "bg-amber-500",
        accent: "text-amber-500",
      };
    case "cancelled":
      return {
        card: "border-border bg-muted/30",
        bar: "bg-muted-foreground",
        accent: "text-muted-foreground",
      };
  }
}

export function isThreadIdle(
  thread: {
    readonly session: {
      readonly status: string;
      readonly activeTurnId?: string | null | undefined;
    } | null;
    readonly latestTurn: { readonly state: string } | null;
  } | null,
): boolean {
  if (!thread) return false;
  if (thread.session && (thread.session.status === "running" || thread.session.activeTurnId)) {
    return false;
  }
  return thread.latestTurn?.state !== "running";
}

export function taskDisplayIndex(tasks: ReadonlyArray<AgentTask>, task: AgentTask): number {
  return Math.max(1, tasks.findIndex((candidate) => candidate.id === task.id) + 1);
}

export function taskContractTitles(plan: AgentPlan, contractIds: ReadonlyArray<string>): string[] {
  return contractIds.map(
    (contractId) =>
      plan.contracts.find((contract) => contract.id === contractId)?.title ?? String(contractId),
  );
}

export function taskDependencyTitles(plan: AgentPlan, task: AgentTask): string[] {
  return task.dependsOn.map(
    (taskId) => plan.tasks.find((candidate) => candidate.id === taskId)?.title ?? String(taskId),
  );
}

export function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatShortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function splitPaths(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((path) => path.trim())
    .filter(Boolean);
}
