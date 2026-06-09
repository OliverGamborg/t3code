import {
  AgentPlanId,
  EnvironmentId,
  ProjectId,
  type AgentCoordinationMessage,
  type AgentPlanDetailSnapshot,
  type AgentReview,
  type AgentSharedUpdate,
  type AgentTask,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  CrownIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  Loader2Icon,
  NetworkIcon,
  PlayIcon,
  PlusIcon,
  SendIcon,
  ShieldCheckIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { readEnvironmentApi } from "~/environmentApi";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { newCommandId, randomUUID } from "~/lib/utils";
import { selectAgentPlansForEnvironment, selectProjectsForEnvironment, useStore } from "~/store";

interface AgentPlansPageProps {
  readonly planId?: AgentPlanId;
}

const planStatusVariant = {
  draft: "outline",
  planning: "info",
  awaiting_approval: "warning",
  running: "info",
  reviewing: "warning",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

const taskStatusVariant = {
  pending: "outline",
  running: "info",
  blocked: "warning",
  done: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

export function AgentPlansPage({ planId }: AgentPlansPageProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const environmentId = primaryEnvironmentId ?? activeEnvironmentId;
  const projects = useStore((state) => selectProjectsForEnvironment(state, environmentId));
  const plans = useStore((state) => selectAgentPlansForEnvironment(state, environmentId));
  const [title, setTitle] = useState("Owner-worker orchestration plan");
  const [prompt, setPrompt] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | "">("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const sortedPlans = useMemo(
    () => [...plans].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [plans],
  );
  const selectedPlanId = planId ?? sortedPlans[0]?.id ?? null;
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedPlanSummary = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const detail = useAgentPlanDetail(environmentId, selectedPlanId);

  useEffect(() => {
    if (selectedProjectId === "" && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const createPlan = async () => {
    if (!environmentId || !selectedProject) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setCreateError("Environment connection is not ready.");
      return;
    }
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      setCreateError("Enter a high-level task prompt first.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const now = new Date().toISOString();
      await api.orchestration.dispatchCommand({
        type: "agent-plan.create",
        commandId: newCommandId(),
        planId: AgentPlanId.make(randomUUID()),
        title: title.trim() || "Owner-worker orchestration plan",
        userPrompt: trimmedPrompt,
        projectIds: [selectedProject.id],
        primaryProjectId: selectedProject.id,
        createdAt: now,
      });
      setPrompt("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create agent plan.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="flex min-h-screen min-w-0 bg-background text-foreground">
      <aside className="hidden w-72 shrink-0 border-r border-border bg-muted/15 p-4 xl:block">
        <div className="space-y-3">
          <div>
            <h1 className="text-sm font-semibold">Agent Plans</h1>
            <p className="mt-1 text-xs text-muted-foreground">Owner-worker mission control</p>
          </div>
          <PlanCreateForm
            createError={createError}
            creating={creating}
            onCreate={createPlan}
            onPromptChange={setPrompt}
            onProjectChange={setSelectedProjectId}
            onTitleChange={setTitle}
            prompt={prompt}
            projects={projects}
            selectedProjectId={selectedProject?.id ?? ""}
            title={title}
          />
        </div>

        <div className="mt-6 space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground">Owner Tasks</h2>
          {sortedPlans.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No plans yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {sortedPlans.map((plan) => (
                <Link
                  key={plan.id}
                  to="/agent-plans/$planId"
                  params={{ planId: plan.id }}
                  className="block rounded-md border border-border bg-background/70 px-3 py-2 text-sm transition-colors hover:bg-accent"
                >
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-medium">{plan.title}</span>
                    <Badge size="sm" variant={planStatusVariant[plan.status]}>
                      {plan.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <span>{plan.runningTaskCount} running</span>
                    <span>{plan.blockedTaskCount} blocked</span>
                    <span>
                      {plan.doneTaskCount}/{plan.taskCount} done
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-auto">
        <div className="border-b border-border bg-background/95 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">
                {selectedPlanSummary?.title ?? "Owner-worker orchestration plan"}
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Plan, launch, coordinate, and review worker agents
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{plans.length} plans</Badge>
              <Button size="sm" variant="outline">
                <PlusIcon />
                Add action
              </Button>
            </div>
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-1 gap-4 p-4 2xl:grid-cols-[minmax(0,1fr)_390px]">
          {selectedPlanId === null ? (
            <EmptyPlanState />
          ) : (
            <PlanDetail
              detail={detail.snapshot}
              environmentId={environmentId}
              error={detail.error}
              loading={detail.loading}
              planTitle={selectedPlanSummary?.title ?? "Agent plan"}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function PlanCreateForm({
  createError,
  creating,
  onCreate,
  onPromptChange,
  onProjectChange,
  onTitleChange,
  prompt,
  projects,
  selectedProjectId,
  title,
}: {
  readonly createError: string | null;
  readonly creating: boolean;
  readonly onCreate: () => void;
  readonly onPromptChange: (value: string) => void;
  readonly onProjectChange: (value: ProjectId) => void;
  readonly onTitleChange: (value: string) => void;
  readonly prompt: string;
  readonly projects: ReadonlyArray<{ readonly id: ProjectId; readonly name: string }>;
  readonly selectedProjectId: ProjectId | "";
  readonly title: string;
}) {
  return (
    <div className="space-y-2 rounded-md border border-border bg-card/60 p-3">
      <Input value={title} onChange={(event) => onTitleChange(event.currentTarget.value)} />
      <select
        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={selectedProjectId}
        onChange={(event) => onProjectChange(ProjectId.make(event.currentTarget.value))}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <Textarea
        className="min-h-28"
        onChange={(event) => onPromptChange(event.currentTarget.value)}
        placeholder="Describe the coordinated coding task..."
        value={prompt}
      />
      {createError ? <p className="text-xs text-destructive">{createError}</p> : null}
      <Button className="w-full" disabled={creating || projects.length === 0} onClick={onCreate}>
        {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
        Create Plan
      </Button>
    </div>
  );
}

function useAgentPlanDetail(
  environmentId: EnvironmentId | null | undefined,
  planId: AgentPlanId | null,
): {
  readonly snapshot: AgentPlanDetailSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
} {
  const [snapshot, setSnapshot] = useState<AgentPlanDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!environmentId || !planId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSnapshot(null);
      setLoading(false);
      setError("Environment connection is not ready.");
      return;
    }

    let disposed = false;
    const refresh = () => {
      setLoading(true);
      setError(null);
      void api.orchestration
        .getAgentPlan({ planId })
        .then((nextSnapshot) => {
          if (!disposed) setSnapshot(nextSnapshot);
        })
        .catch((nextError: unknown) => {
          if (!disposed) {
            setError(nextError instanceof Error ? nextError.message : "Failed to load agent plan.");
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    };

    refresh();
    const unsubscribe = api.orchestration.subscribeAgentPlan({ planId }, (item) => {
      if (item.kind === "snapshot") {
        setSnapshot(item.snapshot);
        setLoading(false);
        setError(null);
        return;
      }
      refresh();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [environmentId, planId]);

  return { snapshot, loading, error };
}

function EmptyPlanState() {
  return (
    <div className="col-span-full flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-border">
      <div className="max-w-sm text-center">
        <NetworkIcon className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold">No plan selected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an owner plan, launch owner planning, then import the task breakdown.
        </p>
      </div>
    </div>
  );
}

function PlanDetail({
  detail,
  environmentId,
  error,
  loading,
  planTitle,
}: {
  readonly detail: AgentPlanDetailSnapshot | null;
  readonly environmentId: EnvironmentId | null | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  readonly planTitle: string;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [instruction, setInstruction] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const plan = detail?.plan ?? null;
  const selectedTask =
    plan?.tasks.find((task) => task.id === selectedTaskId) ?? plan?.tasks[0] ?? null;

  useEffect(() => {
    if (!plan) return;
    if (!selectedTask || !plan.tasks.some((task) => task.id === selectedTask.id)) {
      setSelectedTaskId(plan.tasks[0]?.id ?? null);
    }
  }, [plan, selectedTask]);

  if (loading && detail === null) {
    return (
      <div className="col-span-full flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        Loading plan
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="col-span-full rounded-md border border-border px-4 py-5 text-sm text-muted-foreground">
        {error ?? `${planTitle} is not available.`}
      </div>
    );
  }

  const api = environmentId ? readEnvironmentApi(environmentId) : null;
  const runAction = async (name: string, action: () => Promise<void>) => {
    setBusyAction(name);
    setActionError(null);
    try {
      await action();
    } catch (nextError) {
      setActionError(nextError instanceof Error ? nextError.message : `${name} failed.`);
    } finally {
      setBusyAction(null);
    }
  };

  const startOwnerPlanning = () =>
    runAction("start-owner", async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.startAgentPlanOwnerPlanning({ planId: plan.id });
    });

  const importOwnerOutput = () =>
    runAction("import-owner", async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      const trimmedJson = jsonText.trim();
      await api.orchestration.importAgentPlanOwnerOutput({
        planId: plan.id,
        source: trimmedJson ? "provided_json" : "latest_owner_message",
        ...(trimmedJson ? { jsonText: trimmedJson } : {}),
        replaceDraft: true,
      });
      setJsonText("");
    });

  const approveAndLaunch = () =>
    runAction("approve-launch", async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.approveAgentPlanTasks({
        planId: plan.id,
        launch: true,
      });
    });

  const launchReadyWorkers = () =>
    runAction("launch-ready", async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.launchAgentPlanReadyWorkers({
        planId: plan.id,
        reason: "retry",
      });
    });

  const askProgress = (task: AgentTask) =>
    runAction(`ask-progress:${task.id}`, async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.sendAgentPlanWorkerMessage({
        planId: plan.id,
        taskId: task.id,
        kind: "progress_request",
        title: "Progress check",
        body: "Report current status, blockers, tests run, contract changes, and next action.",
        requiresResponse: true,
      });
    });

  const sendInstruction = (task: AgentTask) =>
    runAction(`send-instruction:${task.id}`, async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      const body = instruction.trim();
      if (!body) throw new Error("Enter an instruction first.");
      await api.orchestration.sendAgentPlanWorkerMessage({
        planId: plan.id,
        taskId: task.id,
        kind: "assignment",
        title: "Owner instruction",
        body,
        requiresResponse: true,
      });
      setInstruction("");
    });

  const startReview = () =>
    runAction("start-review", async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.startAgentPlanReview({ planId: plan.id });
    });

  const saveTask = async (task: AgentTask) => {
    if (!api) throw new Error("Environment connection is not ready.");
    await api.orchestration.dispatchCommand({
      type: "agent-task.upsert",
      commandId: newCommandId(),
      planId: plan.id,
      task,
    });
  };

  const counts = countTasks(plan.tasks);
  const activity = makeActivity(plan.sharedUpdates, plan.coordinationMessages, plan.reviews);
  const canStartOwner =
    plan.ownerThreadId === null || !["planning", "running"].includes(plan.status);
  const allTerminal =
    plan.tasks.length > 0 &&
    plan.tasks.every((task) => ["done", "failed", "cancelled"].includes(task.status));

  return (
    <>
      <div className="min-w-0 space-y-4">
        <section className="rounded-md border border-border bg-card/45">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Mission control</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Owner agent is the main task controller
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
            <div className="mx-auto flex max-w-xl flex-col items-center text-center">
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

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {plan.tasks.length === 0 ? (
                <div className="col-span-full rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Import the owner plan output to create worker tasks.
                </div>
              ) : (
                plan.tasks.map((task, index) => (
                  <WorkerCard
                    index={index}
                    key={task.id}
                    onSelect={() => setSelectedTaskId(task.id)}
                    selected={task.id === selectedTask?.id}
                    task={task}
                  />
                ))
              )}
            </div>
          </div>
        </section>

        <section className="rounded-md border border-border bg-card/45">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Owner activity</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Summary updates from the owner agent and worker coordination loop
              </p>
            </div>
            <Badge variant={planStatusVariant[plan.status]}>{plan.status}</Badge>
          </div>
          <div className="space-y-3 p-4">
            {activity.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                No owner activity yet.
              </p>
            ) : (
              activity.map((item) => <ActivityItem item={item} key={item.id} />)
            )}
          </div>
        </section>

        <section className="rounded-md border border-border bg-card/45 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <Textarea
              className="min-h-24"
              onChange={(event) => setJsonText(event.currentTarget.value)}
              placeholder="Optional: paste owner JSON output here. Leave empty to import latest owner assistant message."
              value={jsonText}
            />
            <div className="flex flex-wrap items-start gap-2 lg:w-48 lg:flex-col">
              <Button disabled={!canStartOwner || busyAction !== null} onClick={startOwnerPlanning}>
                {busyAction === "start-owner" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <PlayIcon />
                )}
                Start owner
              </Button>
              <Button disabled={busyAction !== null} onClick={importOwnerOutput} variant="outline">
                {busyAction === "import-owner" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <FileTextIcon />
                )}
                Import output
              </Button>
              <Button
                disabled={busyAction !== null || plan.tasks.length === 0}
                onClick={approveAndLaunch}
              >
                {busyAction === "approve-launch" ? (
                  <Loader2Icon className="animate-spin" />
                ) : (
                  <ShieldCheckIcon />
                )}
                Approve & launch
              </Button>
              <Button disabled={busyAction !== null} onClick={launchReadyWorkers} variant="outline">
                <PlayIcon />
                Launch ready
              </Button>
              <Button
                disabled={busyAction !== null || !allTerminal}
                onClick={startReview}
                variant="outline"
              >
                <GitBranchIcon />
                Start review
              </Button>
            </div>
          </div>
          {actionError ? <p className="mt-3 text-sm text-destructive">{actionError}</p> : null}
          {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
        </section>
      </div>

      <WorkerInspector
        busyAction={busyAction}
        environmentId={environmentId}
        instruction={instruction}
        onAskProgress={askProgress}
        onInstructionChange={setInstruction}
        onSaveTask={(task) => void runAction(`save-task:${task.id}`, () => saveTask(task))}
        onSendInstruction={sendInstruction}
        plan={plan}
        selectedTask={selectedTask}
      />
    </>
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
  selected,
  task,
}: {
  readonly index: number;
  readonly onSelect: () => void;
  readonly selected: boolean;
  readonly task: AgentTask;
}) {
  const tone = taskTone(task.status);
  return (
    <button
      className={`min-h-44 rounded-md border p-3 text-left transition-colors ${tone.card} ${
        selected ? "ring-2 ring-primary/50" : ""
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-2">
        <Badge size="sm" variant={taskStatusVariant[task.status]}>
          W{index + 1}
        </Badge>
        <StatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</span>
      </div>
      <Badge className="mt-4" size="sm" variant={taskStatusVariant[task.status]}>
        {task.status}
      </Badge>
      <p className="mt-4 line-clamp-3 text-sm text-muted-foreground">{task.description}</p>
      <div className="mt-6">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>{taskProgress(task)} / 10</span>
          {task.branchName ? <span className="truncate">{task.branchName}</span> : null}
        </div>
        <div className="h-1.5 rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${tone.bar}`}
            style={{ width: `${taskProgress(task) * 10}%` }}
          />
        </div>
      </div>
    </button>
  );
}

function WorkerInspector({
  busyAction,
  environmentId,
  instruction,
  onAskProgress,
  onInstructionChange,
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
  readonly onSaveTask: (task: AgentTask) => void;
  readonly onSendInstruction: (task: AgentTask) => void;
  readonly plan: AgentPlanDetailSnapshot["plan"];
  readonly selectedTask: AgentTask | null;
}) {
  const [draft, setDraft] = useState<EditableTaskDraft | null>(null);

  useEffect(() => {
    setDraft(selectedTask ? taskToDraft(selectedTask) : null);
  }, [selectedTask]);

  if (!selectedTask || !draft) {
    return (
      <aside className="rounded-md border border-border bg-card/45 p-4">
        <h2 className="text-sm font-semibold">Worker inspector</h2>
        <p className="mt-3 text-sm text-muted-foreground">Select a worker to inspect status.</p>
      </aside>
    );
  }

  const workerIndex = plan.tasks.findIndex((task) => task.id === selectedTask.id) + 1;
  const isEditable = selectedTask.status === "pending" || plan.status === "awaiting_approval";
  const progressItems = workerProgressItems(selectedTask);
  const relatedMessages = plan.coordinationMessages.filter(
    (message) =>
      message.toTaskIds.includes(selectedTask.id) || message.fromTaskId === selectedTask.id,
  );

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
    <aside className="min-w-0 rounded-md border border-border bg-card/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Worker inspector</h2>
        <Badge variant={taskStatusVariant[selectedTask.status]}>{selectedTask.status}</Badge>
      </div>
      <div className="space-y-5 p-4">
        <div>
          <div className="flex min-w-0 items-center gap-2">
            <Badge variant={taskStatusVariant[selectedTask.status]}>W{workerIndex}</Badge>
            <StatusIcon status={selectedTask.status} />
            <h3 className="truncate text-base font-semibold">{selectedTask.title}</h3>
          </div>
          <dl className="mt-4 space-y-2 text-sm">
            <InspectorRow label="Project" value={String(selectedTask.projectId)} />
            <InspectorRow label="Branch" value={selectedTask.branchName ?? "Not created"} />
            <InspectorRow label="Worktree" value={selectedTask.worktreePath ?? "Not created"} />
          </dl>
          {selectedTask.workerThreadId && environmentId ? (
            <Button
              className="mt-3"
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
              Open worker thread
            </Button>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Progress</span>
            <span>{taskProgress(selectedTask)} / 10 completed</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${taskTone(selectedTask.status).bar}`}
              style={{ width: `${taskProgress(selectedTask) * 10}%` }}
            />
          </div>
          <div className="mt-3 space-y-1.5">
            {progressItems.map((item) => (
              <div className="flex items-center gap-2 text-xs" key={item.label}>
                {item.done ? (
                  <CheckCircle2Icon className="size-3.5 text-emerald-500" />
                ) : (
                  <CircleIcon className="size-3.5 text-muted-foreground" />
                )}
                <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>

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

        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Coordination messages</h4>
          {relatedMessages.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No worker-specific messages yet.
            </p>
          ) : (
            relatedMessages.slice(-6).map((message) => (
              <div
                className="rounded-md border border-border bg-background/60 px-3 py-2"
                key={message.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium">{message.title}</p>
                  <Badge size="sm" variant={message.status === "failed" ? "error" : "outline"}>
                    {message.status}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{message.body}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
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

interface EditableTaskDraft {
  readonly title: string;
  readonly description: string;
  readonly allowedPaths: string;
  readonly blockedPaths: string;
  readonly riskNotes: string;
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

function splitPaths(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((path) => path.trim())
    .filter(Boolean);
}

function countTasks(tasks: ReadonlyArray<AgentTask>) {
  return {
    pending: tasks.filter((task) => task.status === "pending").length,
    running: tasks.filter((task) => task.status === "running").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
    done: tasks.filter((task) => task.status === "done").length,
  };
}

function taskProgress(task: AgentTask): number {
  if (task.status === "done") return 10;
  if (task.status === "failed" || task.status === "cancelled") return 10;
  if (task.status === "running") return 6;
  if (task.status === "blocked") return 2;
  return task.workerThreadId ? 1 : 0;
}

function workerProgressItems(task: AgentTask) {
  return [
    { label: "Create worktree", done: task.worktreePath !== null },
    { label: "Start worker thread", done: task.workerThreadId !== null },
    {
      label: "Run implementation",
      done: ["running", "blocked", "done", "failed"].includes(task.status),
    },
    { label: "Report progress", done: task.summary !== null },
    { label: "Resolve blockers", done: task.status !== "blocked" },
    { label: "Complete task", done: task.status === "done" },
    { label: "Final review input", done: task.status === "done" || task.status === "failed" },
  ];
}

function taskTone(status: AgentTask["status"]) {
  switch (status) {
    case "done":
      return { card: "border-emerald-500/50 bg-emerald-500/10", bar: "bg-emerald-500" };
    case "running":
      return { card: "border-blue-500/50 bg-blue-500/10", bar: "bg-blue-500" };
    case "blocked":
    case "failed":
      return { card: "border-red-500/50 bg-red-500/10", bar: "bg-red-500" };
    case "pending":
      return { card: "border-amber-500/50 bg-amber-500/10", bar: "bg-amber-500" };
    case "cancelled":
      return { card: "border-muted bg-muted/30", bar: "bg-muted-foreground" };
  }
}

function StatusIcon({ status }: { readonly status: AgentTask["status"] }) {
  switch (status) {
    case "done":
      return <CheckCircle2Icon className="size-4 text-emerald-500" />;
    case "running":
      return <PlayIcon className="size-4 text-blue-500" />;
    case "blocked":
    case "failed":
      return <AlertCircleIcon className="size-4 text-red-500" />;
    case "pending":
      return <Clock3Icon className="size-4 text-amber-500" />;
    case "cancelled":
      return <SquareIcon className="size-4 text-muted-foreground" />;
  }
}

type ActivityItemModel = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly at: string;
  readonly type: string;
  readonly status?: string;
};

function makeActivity(
  updates: ReadonlyArray<AgentSharedUpdate>,
  messages: ReadonlyArray<AgentCoordinationMessage>,
  reviews: ReadonlyArray<AgentReview>,
): ActivityItemModel[] {
  return [
    ...updates.map((update) => ({
      id: update.id,
      title: update.title,
      body: update.body,
      at: update.createdAt,
      type: update.type,
    })),
    ...messages.map((message) => ({
      id: message.id,
      title: message.title,
      body: message.body,
      at: message.createdAt,
      type: message.kind,
      status: message.status,
    })),
    ...reviews.map((review) => ({
      id: review.id,
      title: review.status === "pending" ? "Review started" : `Review ${review.status}`,
      body: review.summary || "Reviewer is preparing a merge recommendation.",
      at: review.updatedAt,
      type: "review",
      status: review.status,
    })),
  ].toSorted((left, right) => right.at.localeCompare(left.at));
}

function ActivityItem({ item }: { readonly item: ActivityItemModel }) {
  const failed = item.status === "failed" || item.type === "blocker" || item.type === "error";
  const complete = item.status === "acknowledged" || item.type === "completion";
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <div className="flex justify-center pt-1">
        <div
          className={`flex size-6 items-center justify-center rounded-full border ${
            failed
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : complete
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-blue-500/40 bg-blue-500/10 text-blue-500"
          }`}
        >
          {failed ? (
            <AlertCircleIcon className="size-3.5" />
          ) : complete ? (
            <CheckCircle2Icon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </div>
      </div>
      <div className="rounded-md border border-border bg-background/60 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <Badge size="sm" variant={failed ? "error" : "outline"}>
            {item.status ?? item.type}
          </Badge>
        </div>
        <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{item.body}</p>
        <p className="mt-2 text-xs text-muted-foreground">{formatTime(item.at)}</p>
      </div>
    </div>
  );
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
