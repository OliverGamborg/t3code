import {
  AgentPlanId,
  EnvironmentId,
  ProjectId,
  type AgentCoordinationMessage,
  type AgentTask,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { ExternalLinkIcon, Loader2Icon, NetworkIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { readEnvironmentApi } from "~/environmentApi";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { newCommandId, randomUUID } from "~/lib/utils";
import { selectAgentPlansForEnvironment, selectProjectsForEnvironment, useStore } from "~/store";
import { AgentPlanActionMenu } from "./AgentPlanActionMenu";
import { AgentPlanActivityTimeline } from "./AgentPlanActivityTimeline";
import { AgentPlanMissionControl } from "./AgentPlanMissionControl";
import { AgentPlanOwnerComposer } from "./AgentPlanOwnerComposer";
import { AgentPlanReviewPanel } from "./AgentPlanReviewPanel";
import { AgentPlanWorkerInspector } from "./AgentPlanWorkerInspector";
import { planStatusVariant, type AgentPlan } from "./agentPlanPresentation";
import { useAgentPlanDetail } from "./useAgentPlanDetail";
import { useAgentThreadDetail } from "./useAgentThreadDetail";

interface AgentPlansPageProps {
  readonly planId?: AgentPlanId;
}

export function AgentPlansPage({ planId }: AgentPlansPageProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const environmentId = primaryEnvironmentId ?? activeEnvironmentId;
  const projects = useStore(
    useShallow((state) => selectProjectsForEnvironment(state, environmentId)),
  );
  const plans = useStore(
    useShallow((state) => selectAgentPlansForEnvironment(state, environmentId)),
  );
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

  const selectedPlanProject =
    projects.find((project) => project.id === selectedPlanSummary?.primaryProjectId) ??
    projects.find((project) => selectedPlanSummary?.projectIds.includes(project.id)) ??
    null;

  return (
    <main className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
      <div className="border-b border-border bg-background/95 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">
              {selectedPlanSummary?.title ?? "Agent mission control"}
            </h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {selectedPlanProject
                ? `${selectedPlanProject.name} • owner-worker orchestration`
                : "Plan, launch, coordinate, and review worker agents"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{plans.length} plans</Badge>
            {selectedPlanSummary ? (
              <Badge variant={planStatusVariant[selectedPlanSummary.status]}>
                {selectedPlanSummary.status}
              </Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {selectedPlanId === null ? (
          <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <EmptyPlanState />
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
        ) : (
          <PlanDetail
            createForm={
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
            }
            detail={detail.snapshot}
            environmentId={environmentId}
            error={detail.error}
            loading={detail.loading}
            planTitle={selectedPlanSummary?.title ?? "Agent plan"}
            projectName={selectedPlanProject?.name ?? null}
          />
        )}
      </div>
    </main>
  );
}

function PlanDetail({
  createForm,
  detail,
  environmentId,
  error,
  loading,
  planTitle,
  projectName,
}: {
  readonly createForm: ReactNode;
  readonly detail: { readonly plan: AgentPlan } | null;
  readonly environmentId: EnvironmentId | null | undefined;
  readonly error: string | null;
  readonly loading: boolean;
  readonly planTitle: string;
  readonly projectName: string | null;
}) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [importMode, setImportMode] = useState<"latest" | "paste">("latest");
  const [importError, setImportError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const plan = detail?.plan ?? null;
  const selectedTask =
    plan?.tasks.find((task) => task.id === selectedTaskId) ?? plan?.tasks[0] ?? null;
  const { thread: ownerThread } = useAgentThreadDetail(environmentId, plan?.ownerThreadId ?? null);

  useEffect(() => {
    if (!plan) return;
    if (!selectedTask || !plan.tasks.some((task) => task.id === selectedTask.id)) {
      setSelectedTaskId(plan.tasks[0]?.id ?? null);
    }
  }, [plan, selectedTask]);

  if (loading && detail === null) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        Loading plan
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="rounded-md border border-border px-4 py-5 text-sm text-muted-foreground">
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
      setImportError(null);
      if (importMode === "paste" && !trimmedJson) {
        const message = "Paste owner JSON before importing.";
        setImportError(message);
        throw new Error(message);
      }
      await api.orchestration.importAgentPlanOwnerOutput({
        planId: plan.id,
        source: importMode === "paste" ? "provided_json" : "latest_owner_message",
        ...(importMode === "paste" ? { jsonText: trimmedJson } : {}),
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

  const retryMessage = (message: AgentCoordinationMessage) =>
    runAction(`retry-message:${message.id}`, async () => {
      if (!api) throw new Error("Environment connection is not ready.");
      await api.orchestration.retryAgentPlanCoordinationMessage({
        planId: plan.id,
        messageId: message.id,
      });
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

  const canStartOwner =
    plan.ownerThreadId === null || !["planning", "running"].includes(plan.status);
  const allTerminal =
    plan.tasks.length > 0 &&
    plan.tasks.every((task) => ["done", "failed", "cancelled"].includes(task.status));

  return (
    <div className="grid min-h-0 grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_410px]">
      <div className="min-w-0 space-y-4">
        <section className="rounded-md border border-border bg-card/45 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="truncate text-sm font-semibold">{plan.title}</h2>
                <Badge variant={planStatusVariant[plan.status]}>{plan.status}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {projectName ?? "Project"} • {plan.tasks.length} worker tasks •{" "}
                {plan.coordinationMessages.length} coordination messages
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {plan.ownerThreadId && environmentId ? (
                <Button
                  render={
                    <Link
                      to="/$environmentId/$threadId"
                      params={{ environmentId, threadId: plan.ownerThreadId }}
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  <ExternalLinkIcon />
                  Open owner
                </Button>
              ) : null}
              <AgentPlanActionMenu
                allTerminal={allTerminal}
                busyAction={busyAction}
                canStartOwner={canStartOwner}
                hasTasks={plan.tasks.length > 0}
                onApproveAndLaunch={approveAndLaunch}
                onImportOwnerOutput={importOwnerOutput}
                onLaunchReadyWorkers={launchReadyWorkers}
                onStartOwnerPlanning={startOwnerPlanning}
                onStartReview={startReview}
              />
            </div>
          </div>
        </section>

        <AgentPlanMissionControl
          onSelectTask={(task) => setSelectedTaskId(task.id)}
          plan={plan}
          selectedTask={selectedTask}
        />

        <ImportPanel
          actionError={actionError}
          error={error}
          importError={importError}
          importMode={importMode}
          jsonText={jsonText}
          onImportModeChange={setImportMode}
          onJsonTextChange={setJsonText}
        />

        <AgentPlanActivityTimeline
          busy={busyAction !== null}
          onRetryMessage={retryMessage}
          plan={plan}
        />

        <AgentPlanReviewPanel
          environmentId={environmentId}
          reviews={plan.reviews}
          tasks={plan.tasks}
        />

        <AgentPlanOwnerComposer
          environmentId={environmentId}
          ownerThread={ownerThread}
          plan={plan}
        />
      </div>

      <div className="space-y-4">
        <AgentPlanWorkerInspector
          busyAction={busyAction}
          environmentId={environmentId}
          instruction={instruction}
          onAskProgress={askProgress}
          onInstructionChange={setInstruction}
          onRetryMessage={retryMessage}
          onSaveTask={(task) => void runAction(`save-task:${task.id}`, () => saveTask(task))}
          onSendInstruction={sendInstruction}
          plan={plan}
          selectedTask={selectedTask}
        />
        <div className="2xl:hidden">{createForm}</div>
      </div>
    </div>
  );
}

function ImportPanel({
  actionError,
  error,
  importError,
  importMode,
  jsonText,
  onImportModeChange,
  onJsonTextChange,
}: {
  readonly actionError: string | null;
  readonly error: string | null;
  readonly importError: string | null;
  readonly importMode: "latest" | "paste";
  readonly jsonText: string;
  readonly onImportModeChange: (mode: "latest" | "paste") => void;
  readonly onJsonTextChange: (value: string) => void;
}) {
  return (
    <section className="rounded-md border border-border bg-card/45 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Owner output import</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Choose latest owner message or paste validated owner JSON before using the action menu.
          </p>
        </div>
        <div className="inline-flex rounded-md border border-border bg-background p-1 text-xs">
          <button
            className={`rounded px-3 py-1 ${importMode === "latest" ? "bg-accent" : ""}`}
            onClick={() => onImportModeChange("latest")}
            type="button"
          >
            Latest owner message
          </button>
          <button
            className={`rounded px-3 py-1 ${importMode === "paste" ? "bg-accent" : ""}`}
            onClick={() => onImportModeChange("paste")}
            type="button"
          >
            Paste JSON
          </button>
        </div>
      </div>
      <Textarea
        className="mt-3 min-h-24"
        disabled={importMode === "latest"}
        onChange={(event) => onJsonTextChange(event.currentTarget.value)}
        placeholder={
          importMode === "latest"
            ? "Import will use the latest completed owner assistant message."
            : "Paste owner JSON output here."
        }
        value={jsonText}
      />
      {importError ? <p className="mt-3 text-sm text-destructive">{importError}</p> : null}
      {actionError ? <p className="mt-3 text-sm text-destructive">{actionError}</p> : null}
      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
    </section>
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
    <section className="space-y-2 rounded-md border border-border bg-card/60 p-3">
      <div>
        <h2 className="text-sm font-semibold">Create plan</h2>
        <p className="mt-1 text-xs text-muted-foreground">Start a new owner-worker mission.</p>
      </div>
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
    </section>
  );
}

function EmptyPlanState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-border">
      <div className="max-w-sm text-center">
        <NetworkIcon className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold">No agent plan selected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create an owner plan, launch owner planning, then import the task breakdown.
        </p>
      </div>
    </div>
  );
}
