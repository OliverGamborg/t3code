import {
  AgentContractId,
  AgentPlanId,
  AgentSharedUpdateId,
  AgentTaskId,
  EnvironmentId,
  ProjectId,
  type AgentPlanDetailSnapshot,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import {
  ClipboardListIcon,
  FileTextIcon,
  GitBranchIcon,
  Loader2Icon,
  NetworkIcon,
  PlusIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { readEnvironmentApi } from "~/environmentApi";
import { usePrimaryEnvironmentId } from "~/environments/primary";
import { newCommandId, randomUUID } from "~/lib/utils";
import { selectAgentPlansForEnvironment, selectProjectsForEnvironment, useStore } from "~/store";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";

interface AgentPlansPageProps {
  readonly planId?: AgentPlanId;
}

const statusVariant = {
  draft: "outline",
  planning: "info",
  awaiting_approval: "warning",
  running: "info",
  reviewing: "warning",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
} as const;

export function AgentPlansPage({ planId }: AgentPlansPageProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const environmentId = primaryEnvironmentId ?? activeEnvironmentId;
  const projects = useStore((state) => selectProjectsForEnvironment(state, environmentId));
  const plans = useStore((state) => selectAgentPlansForEnvironment(state, environmentId));
  const [title, setTitle] = useState("Owner/worker implementation plan");
  const [prompt, setPrompt] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<ProjectId | "">("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selectedPlanId = planId ?? plans[0]?.id ?? null;
  const selectedProject =
    projects.find((project) => project.id === selectedProjectId) ?? projects[0];
  const selectedPlanSummary = plans.find((plan) => plan.id === selectedPlanId) ?? null;
  const detail = useAgentPlanDetail(environmentId, selectedPlanId);

  useEffect(() => {
    if (selectedProjectId === "" && projects[0]) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const sortedPlans = useMemo(
    () => [...plans].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [plans],
  );

  const createPlan = async () => {
    if (!environmentId || !selectedProject) {
      return;
    }
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
      const planId = AgentPlanId.make(randomUUID());
      const foundationTaskId = AgentTaskId.make(randomUUID());
      const reviewTaskId = AgentTaskId.make(randomUUID());
      const contractId = AgentContractId.make(randomUUID());

      await api.orchestration.dispatchCommand({
        type: "agent-plan.create",
        commandId: newCommandId(),
        planId,
        title: title.trim() || "Owner/worker implementation plan",
        userPrompt: trimmedPrompt,
        projectIds: [selectedProject.id],
        primaryProjectId: selectedProject.id,
        createdAt: now,
      });

      await api.orchestration.dispatchCommand({
        type: "agent-task.upsert",
        commandId: newCommandId(),
        planId,
        task: {
          id: foundationTaskId,
          planId,
          title: "Persist coordination foundation",
          description:
            "Add durable agent-plan state, task records, shared updates, and contract records without starting worker sessions.",
          status: "pending",
          projectId: selectedProject.id,
          workerThreadId: null,
          worktreePath: null,
          branchName: null,
          allowedPaths: [
            "packages/contracts",
            "apps/server/src/orchestration",
            "apps/server/src/persistence",
          ],
          blockedPaths: [".repos"],
          dependsOn: [],
          relatedTaskIds: [reviewTaskId],
          requiredContracts: [],
          producedContracts: [contractId],
          assignedProvider: null,
          summary: null,
          riskNotes: "Keep orchestration provider-neutral and avoid worktree side effects.",
          createdAt: now,
          updatedAt: now,
        },
      });

      await api.orchestration.dispatchCommand({
        type: "agent-task.upsert",
        commandId: newCommandId(),
        planId,
        task: {
          id: reviewTaskId,
          planId,
          title: "Add minimal plan viewer",
          description:
            "Expose a simple Agent Plans view that can create a manual plan and display tasks, updates, and contracts.",
          status: "pending",
          projectId: selectedProject.id,
          workerThreadId: null,
          worktreePath: null,
          branchName: null,
          allowedPaths: ["apps/web/src"],
          blockedPaths: [".repos"],
          dependsOn: [foundationTaskId],
          relatedTaskIds: [foundationTaskId],
          requiredContracts: [contractId],
          producedContracts: [],
          assignedProvider: null,
          summary: null,
          riskNotes: "Keep UI compact and avoid worker launch controls in this PR.",
          createdAt: now,
          updatedAt: now,
        },
      });

      await api.orchestration.dispatchCommand({
        type: "agent-contract.upsert",
        commandId: newCommandId(),
        planId,
        contract: {
          id: contractId,
          planId,
          producerTaskId: foundationTaskId,
          consumerTaskIds: [reviewTaskId],
          type: "type",
          title: "Agent plan projection contract",
          description:
            "AgentPlan owns task, shared update, and contract child records. Shell views receive summaries; detail views subscribe to one plan.",
          status: "draft",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      });

      await api.orchestration.dispatchCommand({
        type: "agent-shared-update.append",
        commandId: newCommandId(),
        planId,
        update: {
          id: AgentSharedUpdateId.make(randomUUID()),
          planId,
          taskId: null,
          type: "decision",
          title: "Foundation-only MVP",
          body: "This plan records coordination state and a manual/mock task breakdown. Worktrees and worker sessions are intentionally excluded.",
          visibility: "all_workers",
          relatedTaskIds: [foundationTaskId, reviewTaskId],
          createdAt: now,
        },
      });

      setPrompt("");
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Failed to create agent plan.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="flex min-h-screen min-w-0 flex-col bg-background text-foreground">
      <header className="border-b border-border bg-background/95 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">Agent Plans</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Owner/worker coordination foundation
            </p>
          </div>
          <Badge variant="outline">{plans.length} plans</Badge>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-border bg-muted/20 p-4 lg:border-r lg:border-b-0">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <Input value={title} onChange={(event) => setTitle(event.currentTarget.value)} />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Project</label>
              <select
                className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={selectedProject?.id ?? ""}
                onChange={(event) =>
                  setSelectedProjectId(ProjectId.make(event.currentTarget.value))
                }
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Prompt</label>
              <Textarea
                className="min-h-36"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="Describe the coordinated coding task..."
              />
            </div>

            {createError ? <p className="text-xs text-destructive">{createError}</p> : null}

            <Button
              className="w-full"
              disabled={creating || !selectedProject || !environmentId}
              onClick={createPlan}
            >
              {creating ? <Loader2Icon className="animate-spin" /> : <PlusIcon />}
              Create Plan
            </Button>
          </div>

          <div className="mt-6 space-y-2">
            <h2 className="text-xs font-semibold text-muted-foreground">Plans</h2>
            <div className="space-y-1.5">
              {sortedPlans.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  No agent plans yet.
                </p>
              ) : (
                sortedPlans.map((plan) => (
                  <Link
                    key={plan.id}
                    to="/agent-plans/$planId"
                    params={{ planId: plan.id }}
                    className="block rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="truncate font-medium">{plan.title}</span>
                      <Badge size="sm" variant={statusVariant[plan.status]}>
                        {plan.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                      <span>{plan.taskCount} tasks</span>
                      <span>{plan.contractCount} contracts</span>
                      <span>{plan.updateCount} updates</span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="min-w-0 overflow-auto p-4 sm:p-6">
          {selectedPlanId === null ? (
            <EmptyPlanState />
          ) : (
            <PlanDetail
              detail={detail.snapshot}
              loading={detail.loading}
              planTitle={selectedPlanSummary?.title ?? "Agent plan"}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function useAgentPlanDetail(
  environmentId: EnvironmentId | null | undefined,
  planId: AgentPlanId | null,
): {
  readonly snapshot: AgentPlanDetailSnapshot | null;
  readonly loading: boolean;
} {
  const [snapshot, setSnapshot] = useState<AgentPlanDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!environmentId || !planId) {
      setSnapshot(null);
      setLoading(false);
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSnapshot(null);
      setLoading(false);
      return;
    }

    let disposed = false;
    const refresh = () => {
      setLoading(true);
      void api.orchestration
        .getAgentPlan({ planId })
        .then((nextSnapshot) => {
          if (!disposed) {
            setSnapshot(nextSnapshot);
          }
        })
        .finally(() => {
          if (!disposed) {
            setLoading(false);
          }
        });
    };

    refresh();
    const unsubscribe = api.orchestration.subscribeAgentPlan({ planId }, (item) => {
      if (item.kind === "snapshot") {
        setSnapshot(item.snapshot);
        setLoading(false);
        return;
      }
      refresh();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [environmentId, planId]);

  return { snapshot, loading };
}

function EmptyPlanState() {
  return (
    <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed border-border">
      <div className="max-w-sm text-center">
        <NetworkIcon className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-3 text-sm font-semibold">No plan selected</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Create a plan to persist the coordination state foundation.
        </p>
      </div>
    </div>
  );
}

function PlanDetail({
  detail,
  loading,
  planTitle,
}: {
  readonly detail: AgentPlanDetailSnapshot | null;
  readonly loading: boolean;
  readonly planTitle: string;
}) {
  if (loading && detail === null) {
    return (
      <div className="flex min-h-[360px] items-center justify-center text-sm text-muted-foreground">
        <Loader2Icon className="mr-2 size-4 animate-spin" />
        Loading plan
      </div>
    );
  }

  if (detail === null) {
    return (
      <div className="rounded-md border border-border px-4 py-5 text-sm text-muted-foreground">
        {planTitle} is not available.
      </div>
    );
  }

  const plan = detail.plan;

  return (
    <div className="space-y-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <NetworkIcon className="size-4 text-muted-foreground" />
            <h2 className="truncate text-lg font-semibold">{plan.title}</h2>
          </div>
          <p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-muted-foreground">
            {plan.userPrompt}
          </p>
        </div>
        <Badge variant={statusVariant[plan.status]}>{plan.status}</Badge>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Metric label="Tasks" value={plan.tasks.length} icon={<ClipboardListIcon />} />
        <Metric label="Contracts" value={plan.contracts.length} icon={<GitBranchIcon />} />
        <Metric label="Updates" value={plan.sharedUpdates.length} icon={<FileTextIcon />} />
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Tasks</h3>
        <div className="grid gap-2">
          {plan.tasks.map((task) => (
            <div key={task.id} className="rounded-md border border-border bg-card px-3 py-2">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{task.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>
                </div>
                <Badge size="sm" variant={task.status === "blocked" ? "warning" : "outline"}>
                  {task.status}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {task.allowedPaths.map((path) => (
                  <Badge key={path} size="sm" variant="secondary">
                    {path}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Contracts</h3>
          {plan.contracts.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No contracts recorded.
            </p>
          ) : (
            plan.contracts.map((contract) => (
              <div key={contract.id} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{contract.title}</p>
                  <Badge size="sm" variant="outline">
                    v{contract.version}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{contract.description}</p>
              </div>
            ))
          )}
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Shared Updates</h3>
          {plan.sharedUpdates.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              No updates recorded.
            </p>
          ) : (
            plan.sharedUpdates.map((update) => (
              <div key={update.id} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{update.title}</p>
                  <Badge size="sm" variant="outline">
                    {update.type}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{update.body}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: number;
  readonly icon: ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="[&_svg]:size-3.5">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}
