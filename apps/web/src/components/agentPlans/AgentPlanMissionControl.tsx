import { CrownIcon, GitBranchIcon } from "lucide-react";
import type { AgentTask } from "@t3tools/contracts";

import { Badge } from "~/components/ui/badge";
import {
  countTasks,
  launchBlockerReason,
  taskDependencyTitles,
  taskProgress,
  taskStatusVariant,
  taskTone,
  type AgentPlan,
} from "./agentPlanPresentation";
import { AgentTaskStatusIcon } from "./AgentPlanStatusIcon";

export function AgentPlanMissionControl({
  plan,
  selectedTask,
  onSelectTask,
}: {
  readonly plan: AgentPlan;
  readonly selectedTask: AgentTask | null;
  readonly onSelectTask: (task: AgentTask) => void;
}) {
  const counts = countTasks(plan.tasks);

  return (
    <section className="overflow-hidden rounded-md border border-border bg-card/45">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Mission control</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Owner agent coordinates workers and drives the review loop
          </p>
        </div>
        <div className="grid grid-cols-5 overflow-hidden rounded-md border border-border text-center text-xs">
          <MetricCell label="Workers total" value={plan.tasks.length} />
          <MetricCell className="text-emerald-500" label="Active" value={counts.running} />
          <MetricCell className="text-red-500" label="Blocked" value={counts.blocked} />
          <MetricCell className="text-emerald-500" label="Complete" value={counts.done} />
          <MetricCell className="text-amber-500" label="Queued" value={counts.pending} />
        </div>
      </div>

      <div className="px-4 py-5">
        <div className="relative mx-auto flex max-w-xl flex-col items-center text-center">
          <div className="flex size-12 items-center justify-center rounded-full border border-violet-500/50 bg-violet-500/10 text-violet-300">
            <CrownIcon className="size-5" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <h3 className="text-sm font-semibold">Owner Controller</h3>
            <Badge size="sm" variant="secondary">
              Main task controller
            </Badge>
          </div>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Coordinates workers, assigns tasks, reviews reports, and drives completion.
          </p>
        </div>

        <div className="relative mt-7">
          {plan.tasks.length > 0 ? (
            <>
              <div className="pointer-events-none absolute left-6 right-6 top-0 hidden h-6 border-t border-dashed border-border md:block" />
              <div className="pointer-events-none absolute left-1/2 top-[-1.75rem] hidden h-7 border-l border-dashed border-border md:block" />
            </>
          ) : null}
          <div className="grid auto-cols-[minmax(230px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 md:grid-flow-row md:grid-cols-2 xl:grid-cols-4">
            {plan.tasks.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground md:col-span-2 xl:col-span-4">
                Import the owner plan output to create worker tasks.
              </div>
            ) : (
              plan.tasks.map((task, index) => (
                <WorkerCard
                  index={index}
                  key={task.id}
                  onSelect={() => onSelectTask(task)}
                  plan={plan}
                  selected={task.id === selectedTask?.id}
                  task={task}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricCell({
  className = "",
  label,
  value,
}: {
  readonly className?: string;
  readonly label: string;
  readonly value: number;
}) {
  return (
    <div className="min-w-20 border-r border-border px-3 py-2 last:border-r-0">
      <div className={`text-base font-semibold ${className}`}>{value}</div>
      <div className="mt-0.5 whitespace-nowrap text-muted-foreground">{label}</div>
    </div>
  );
}

function WorkerCard({
  index,
  onSelect,
  plan,
  selected,
  task,
}: {
  readonly index: number;
  readonly onSelect: () => void;
  readonly plan: AgentPlan;
  readonly selected: boolean;
  readonly task: AgentTask;
}) {
  const tone = taskTone(task.status);
  const progress = taskProgress(task);
  const dependencies = taskDependencyTitles(plan, task);
  const blocker = task.status === "pending" ? launchBlockerReason(plan, task) : task.riskNotes;

  return (
    <button
      className={`relative min-h-44 rounded-md border p-3 text-left transition-colors ${tone.card} ${
        selected ? "ring-2 ring-primary/50" : ""
      }`}
      onClick={onSelect}
      type="button"
    >
      <span className="absolute left-1/2 top-[-1.5rem] hidden h-6 border-l border-dashed border-border md:block" />
      <div className="flex items-center gap-2">
        <Badge size="sm" variant={taskStatusVariant[task.status]}>
          W{index + 1}
        </Badge>
        <AgentTaskStatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
      </div>
      <Badge className="mt-4" size="sm" variant={taskStatusVariant[task.status]}>
        {task.status}
      </Badge>
      <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">{task.description}</p>
      {dependencies.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1">
          {dependencies.slice(0, 2).map((dependency) => (
            <Badge key={dependency} size="sm" variant="outline">
              {dependency}
            </Badge>
          ))}
          {dependencies.length > 2 ? (
            <Badge size="sm" variant="outline">
              +{dependencies.length - 2}
            </Badge>
          ) : null}
        </div>
      ) : null}
      {blocker ? (
        <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{blocker}</p>
      ) : null}
      <div className="mt-5">
        <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {progress.done} / {progress.total}
          </span>
          {task.branchName ? (
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
              <GitBranchIcon className="size-3 shrink-0" />
              <span className="truncate">{task.branchName}</span>
            </span>
          ) : null}
        </div>
        <div className="h-1.5 rounded-full bg-background/80">
          <div
            className={`h-full rounded-full ${tone.bar}`}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>
    </button>
  );
}
