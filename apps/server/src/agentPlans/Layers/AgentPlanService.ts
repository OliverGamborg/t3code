import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentReviewId,
  AgentSharedUpdateId,
  AgentTaskId,
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  MessageId,
  type AgentContract,
  type AgentCoordinationMessage,
  type AgentPlan,
  type AgentSharedUpdate,
  type AgentTask,
  type ModelSelection,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
  type OrchestrationMessage,
  type OrchestrationThread,
  type OrchestrationProjectShell,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerRuntimeStartup } from "../../serverRuntimeStartup.ts";
import { WorktreeManager } from "../../worktrees/Services/WorktreeManager.ts";
import {
  buildOwnerPlanningPrompt,
  buildOwnerWorkerReportPrompt,
  buildReviewerPrompt,
  buildWorkerMessagePrompt,
  buildWorkerExecutionPrompt,
} from "../prompts.ts";
import { parseOwnerPlanOutput } from "../structuredOutput.ts";
import { AgentPlanService, type AgentPlanServiceShape } from "../Services/AgentPlanService.ts";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const TERMINAL_TASK_STATUSES = new Set<AgentTask["status"]>(["done", "failed", "cancelled"]);

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug.length > 0 ? slug : "item";
}

function taskIdFor(planId: string, taskKey: string): AgentTaskId {
  return AgentTaskId.make(`agent-task:${planId}:${slugify(taskKey)}`);
}

function contractIdFor(planId: string, contractKey: string): AgentContractId {
  return AgentContractId.make(`agent-contract:${planId}:${slugify(contractKey)}`);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/g, "");
}

function pathsOverlap(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  if (left.length === 0 || right.length === 0) {
    return true;
  }
  for (const leftPath of left.map(normalizePath)) {
    for (const rightPath of right.map(normalizePath)) {
      if (
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`)
      ) {
        return true;
      }
    }
  }
  return false;
}

function maxSequence(values: ReadonlyArray<{ readonly sequence: number }>): number {
  return values.reduce((max, value) => Math.max(max, value.sequence), 0);
}

function isThreadBusy(thread: OrchestrationThread | null): boolean {
  const session = thread?.session;
  return session !== null && session !== undefined
    ? session.status === "running" || session.activeTurnId !== null
    : false;
}

function visibleSharedUpdates(plan: AgentPlan): ReadonlyArray<AgentSharedUpdate> {
  return plan.sharedUpdates.filter((update) => update.visibility !== "owner_only");
}

function relevantContracts(plan: AgentPlan, task: AgentTask): ReadonlyArray<AgentContract> {
  const ids = new Set([...task.requiredContracts, ...task.producedContracts]);
  return plan.contracts.filter(
    (contract) =>
      ids.has(contract.id) ||
      contract.producerTaskId === task.id ||
      contract.consumerTaskIds.includes(task.id),
  );
}

function relatedTasks(plan: AgentPlan, task: AgentTask): ReadonlyArray<AgentTask> {
  const ids = new Set([...task.dependsOn, ...task.relatedTaskIds]);
  return plan.tasks.filter((candidate) => candidate.id !== task.id && ids.has(candidate.id));
}

function latestCompletedAssistantMessage(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId?: MessageId,
): OrchestrationMessage | null {
  const candidates = messages.filter(
    (message) =>
      message.role === "assistant" &&
      !message.streaming &&
      (messageId === undefined || message.id === messageId),
  );
  return (
    candidates.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null
  );
}

function makeCoordinationMessage(input: {
  readonly id: AgentCoordinationMessageId;
  readonly planId: AgentPlan["id"];
  readonly dedupeKey: string;
  readonly kind: AgentCoordinationMessage["kind"];
  readonly status: AgentCoordinationMessage["status"];
  readonly fromRole: AgentCoordinationMessage["fromRole"];
  readonly toTarget: AgentCoordinationMessage["toTarget"];
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
  readonly fromTaskId?: AgentTask["id"] | null;
  readonly fromThreadId?: ThreadId | null;
  readonly toTaskIds?: ReadonlyArray<AgentTask["id"]>;
  readonly toThreadIds?: ReadonlyArray<ThreadId>;
  readonly sourceMessageId?: MessageId | null;
  readonly sourceTurnId?: AgentCoordinationMessage["sourceTurnId"];
  readonly correlationId?: string | null;
  readonly requiresResponse?: boolean;
  readonly deliveryAttempts?: number;
  readonly sentAt?: string | null;
  readonly acknowledgedAt?: string | null;
  readonly failedAt?: string | null;
  readonly failureReason?: string | null;
}): AgentCoordinationMessage {
  return {
    id: input.id,
    planId: input.planId,
    dedupeKey: input.dedupeKey,
    kind: input.kind,
    status: input.status,
    fromRole: input.fromRole,
    fromTaskId: input.fromTaskId ?? null,
    fromThreadId: input.fromThreadId ?? null,
    toTarget: input.toTarget,
    toTaskIds: [...(input.toTaskIds ?? [])],
    toThreadIds: [...(input.toThreadIds ?? [])],
    sourceMessageId: input.sourceMessageId ?? null,
    sourceTurnId: input.sourceTurnId ?? null,
    correlationId: input.correlationId ?? null,
    title: input.title,
    body: input.body,
    requiresResponse: input.requiresResponse ?? false,
    deliveryAttempts: input.deliveryAttempts ?? 0,
    createdAt: input.createdAt,
    sentAt: input.sentAt ?? null,
    acknowledgedAt: input.acknowledgedAt ?? null,
    failedAt: input.failedAt ?? null,
    failureReason: input.failureReason ?? null,
  };
}

const makeAgentPlanService = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const startup = yield* ServerRuntimeStartup;
  const worktreeManager = yield* WorktreeManager;

  const toDispatchCommandError = (cause: unknown, fallbackMessage: string) =>
    isOrchestrationDispatchCommandError(cause)
      ? cause
      : new OrchestrationDispatchCommandError({
          message: cause instanceof Error ? cause.message : fallbackMessage,
          cause,
        });
  const randomUUID = crypto.randomUUIDv4.pipe(
    Effect.mapError((cause) =>
      toDispatchCommandError(cause, "Failed to generate orchestration command identifier."),
    ),
  );
  const serverCommandId = (tag: string) =>
    randomUUID.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const messageId = () => randomUUID.pipe(Effect.map(MessageId.make));
  const threadId = () => randomUUID.pipe(Effect.map(ThreadId.make));
  const coordinationMessageId = () => randomUUID.pipe(Effect.map(AgentCoordinationMessageId.make));
  const reviewId = () => randomUUID.pipe(Effect.map(AgentReviewId.make));

  const dispatchCommand = (
    command: OrchestrationCommand,
  ): Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError> =>
    startup
      .enqueueCommand(
        orchestrationEngine
          .dispatch(command)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
            ),
          ),
      )
      .pipe(
        Effect.mapError((cause) =>
          toDispatchCommandError(cause, "Failed to dispatch orchestration command"),
        ),
      );

  const loadPlan = (planId: AgentPlan["id"]) =>
    projectionSnapshotQuery.getAgentPlanDetailById(planId).pipe(
      Effect.mapError((cause) =>
        toDispatchCommandError(cause, `Failed to load agent plan ${planId}`),
      ),
      Effect.flatMap((detail) =>
        Option.isSome(detail)
          ? Effect.succeed(detail.value.plan)
          : Effect.fail(
              new OrchestrationDispatchCommandError({
                message: `Agent plan ${planId} was not found`,
                cause: planId,
              }),
            ),
      ),
    );

  const loadProject = (projectId: AgentTask["projectId"]) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.mapError((cause) =>
        toDispatchCommandError(cause, `Failed to load project ${projectId}`),
      ),
      Effect.flatMap((project) =>
        Option.isSome(project)
          ? Effect.succeed(project.value)
          : Effect.fail(
              new OrchestrationDispatchCommandError({
                message: `Project ${projectId} was not found.`,
                cause: projectId,
              }),
            ),
      ),
    );

  const loadProjects = (plan: AgentPlan) => Effect.forEach(plan.projectIds, loadProject);

  const resolvePrimaryProject = (
    plan: AgentPlan,
    projectShells: ReadonlyArray<OrchestrationProjectShell>,
  ) => {
    const project =
      projectShells.find((candidate) => candidate.id === plan.primaryProjectId) ??
      projectShells[0] ??
      null;
    if (project === null) {
      return Effect.fail(
        new OrchestrationDispatchCommandError({
          message: "Agent plan must include at least one project.",
          cause: plan.id,
        }),
      );
    }
    return Effect.succeed(project);
  };

  const resolveModelSelection = (
    project: OrchestrationProjectShell,
    override?: ModelSelection,
  ): ModelSelection =>
    override ??
    project.defaultModelSelection ?? {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    };

  const dispatchCoordinationMessage = (message: AgentCoordinationMessage) =>
    serverCommandId("agent-coordination-message-upsert").pipe(
      Effect.flatMap((commandId) =>
        dispatchCommand({
          type: "agent-coordination-message.upsert",
          commandId,
          planId: message.planId,
          message,
        }),
      ),
    );

  const dispatchSharedUpdate = (update: AgentSharedUpdate) =>
    serverCommandId("agent-shared-update-append").pipe(
      Effect.flatMap((commandId) =>
        dispatchCommand({
          type: "agent-shared-update.append",
          commandId,
          planId: update.planId,
          update,
        }),
      ),
    );

  const recordCleanupFailure = (input: {
    readonly plan: AgentPlan;
    readonly task: AgentTask;
    readonly reason: string;
  }) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      yield* dispatchCoordinationMessage(
        makeCoordinationMessage({
          id: yield* coordinationMessageId(),
          planId: input.plan.id,
          dedupeKey: `cleanup-failed:${input.plan.id}:${input.task.id}:${now}`,
          kind: "error",
          status: "failed",
          fromRole: "system",
          toTarget: "user",
          toTaskIds: [input.task.id],
          title: "Worker worktree cleanup failed",
          body: input.reason,
          createdAt: now,
          failedAt: now,
          failureReason: input.reason,
        }),
      ).pipe(Effect.catch(() => Effect.void));
      yield* dispatchSharedUpdate({
        id: AgentSharedUpdateId.make(
          `agent-update:${input.plan.id}:${input.task.id}:cleanup-failed:${slugify(now)}`,
        ),
        planId: input.plan.id,
        taskId: input.task.id,
        type: "risk",
        title: "Worker worktree cleanup failed",
        body: input.reason,
        visibility: "owner_only",
        relatedTaskIds: [input.task.id],
        createdAt: now,
      }).pipe(Effect.catch(() => Effect.void));
    });

  const queueWorkerMessage = (input: {
    readonly plan: AgentPlan;
    readonly task: AgentTask;
    readonly kind: "progress_request" | "assignment" | "clarification_response" | "sync";
    readonly title: string;
    readonly body: string;
    readonly requiresResponse?: boolean;
    readonly status?: AgentCoordinationMessage["status"];
    readonly toThreadIds?: ReadonlyArray<ThreadId>;
    readonly sentAt?: string | null;
  }) =>
    Effect.gen(function* () {
      const now = yield* nowIso;
      const id = yield* coordinationMessageId();
      return yield* dispatchCoordinationMessage(
        makeCoordinationMessage({
          id,
          planId: input.plan.id,
          dedupeKey: `manual:${input.plan.id}:${input.task.id}:${input.kind}:${id}`,
          kind: input.kind,
          status: input.status ?? "queued",
          fromRole: "owner",
          fromThreadId: input.plan.ownerThreadId,
          toTarget: "worker",
          toTaskIds: [input.task.id],
          toThreadIds: input.toThreadIds ?? [],
          title: input.title,
          body: input.body,
          requiresResponse: input.requiresResponse ?? false,
          createdAt: now,
          sentAt: input.sentAt ?? null,
        }),
      );
    });

  const launchReadyWorkers: AgentPlanServiceShape["launchReadyWorkers"] = (input) =>
    Effect.gen(function* () {
      const plan = yield* loadPlan(input.planId);
      if (!(plan.status === "awaiting_approval" || plan.status === "running")) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Agent plan ${plan.id} is not ready to launch workers.`,
          cause: plan.status,
        });
      }

      const selectedIds = input.taskIds ? new Set(input.taskIds) : null;
      const launchedTaskIds: AgentTaskId[] = [];
      const skippedTaskIds: AgentTaskId[] = [];
      const results: Array<{ sequence: number }> = [];

      for (const task of plan.tasks) {
        if (selectedIds && !selectedIds.has(task.id)) {
          continue;
        }
        const dependenciesDone = task.dependsOn.every((dependencyId) =>
          plan.tasks.some(
            (candidate) => candidate.id === dependencyId && candidate.status === "done",
          ),
        );
        const ready =
          task.status === "pending" &&
          task.workerThreadId === null &&
          dependenciesDone &&
          plan.projectIds.includes(task.projectId);

        if (!ready) {
          skippedTaskIds.push(task.id);
          continue;
        }

        const project = yield* loadProject(task.projectId);
        const modelSelection = resolveModelSelection(project, input.modelSelection);
        const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
        const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
        const now = yield* nowIso;
        const workerThreadId = yield* threadId();
        const workerMessageId = yield* messageId();
        const worktree = yield* worktreeManager.createForAgentTask(task);
        const taskWithWorker: AgentTask = {
          ...task,
          status: "running",
          workerThreadId,
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
          assignedProvider: String(modelSelection.instanceId),
          updatedAt: now,
        };
        const prompt = buildWorkerExecutionPrompt({
          plan,
          task: taskWithWorker,
          relatedTasks: relatedTasks(plan, task),
          contracts: relevantContracts(plan, task),
          sharedDecisions: visibleSharedUpdates(plan),
        });

        const cleanupWorktree = worktreeManager.removeForAgentTask(taskWithWorker).pipe(
          Effect.catch((error) =>
            recordCleanupFailure({
              plan,
              task: taskWithWorker,
              reason: error.message,
            }),
          ),
        );
        const deleteWorkerThread = serverCommandId("agent-worker-thread-delete").pipe(
          Effect.flatMap((commandId) =>
            dispatchCommand({
              type: "thread.delete",
              commandId,
              threadId: workerThreadId,
            }),
          ),
          Effect.catch(() => Effect.void),
        );

        const createThreadResult = yield* dispatchCommand({
          type: "thread.create",
          commandId: yield* serverCommandId("agent-worker-thread-create"),
          threadId: workerThreadId,
          projectId: task.projectId,
          title: `Worker: ${task.title}`,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: worktree.branchName,
          worktreePath: worktree.worktreePath,
          createdAt: now,
        }).pipe(Effect.tapError(() => cleanupWorktree));

        const taskResult = yield* dispatchCommand({
          type: "agent-task.upsert",
          commandId: yield* serverCommandId("agent-worker-task-link"),
          planId: plan.id,
          task: taskWithWorker,
        }).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              yield* deleteWorkerThread;
              yield* cleanupWorktree;
            }),
          ),
        );

        const turnResult = yield* dispatchCommand({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("agent-worker-turn-start"),
          threadId: workerThreadId,
          message: {
            messageId: workerMessageId,
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: `Worker: ${task.title}`,
          runtimeMode,
          interactionMode,
          createdAt: now,
        }).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              yield* dispatchCommand({
                type: "agent-task.upsert",
                commandId: yield* serverCommandId("agent-worker-task-failed"),
                planId: plan.id,
                task: {
                  ...taskWithWorker,
                  status: "failed",
                  summary: "Worker failed to start.",
                  updatedAt: yield* nowIso,
                },
              }).pipe(Effect.catch(() => Effect.void));
              yield* deleteWorkerThread;
              yield* cleanupWorktree;
            }),
          ),
        );

        const assignmentResult = yield* queueWorkerMessage({
          plan,
          task: taskWithWorker,
          kind: "assignment",
          title: `Worker launched: ${task.title}`,
          body: task.description,
          status: "sent",
          toThreadIds: [workerThreadId],
          sentAt: now,
        });

        results.push(createThreadResult, taskResult, turnResult, assignmentResult);
        launchedTaskIds.push(task.id);
      }

      if (launchedTaskIds.length > 0 && plan.status !== "running") {
        results.push(
          yield* dispatchCommand({
            type: "agent-plan.status.set",
            commandId: yield* serverCommandId("agent-plan-running"),
            planId: plan.id,
            status: "running",
          }),
        );
      }

      return {
        planId: plan.id,
        launchedTaskIds,
        skippedTaskIds,
        sequence: maxSequence(results),
      };
    });

  const flushQueuedMessagesForPlan = (plan: AgentPlan, targetThreadId?: ThreadId) =>
    Effect.gen(function* () {
      const results: Array<{ sequence: number }> = [];
      const failMessage = (message: AgentCoordinationMessage, reason: string) =>
        nowIso.pipe(
          Effect.flatMap((now) =>
            dispatchCoordinationMessage({
              ...message,
              status: "failed",
              failedAt: now,
              failureReason: reason,
            }),
          ),
        );

      for (const message of plan.coordinationMessages) {
        if (message.status !== "queued") {
          continue;
        }
        if (
          targetThreadId !== undefined &&
          !message.toThreadIds.includes(targetThreadId) &&
          !plan.tasks.some(
            (task) => task.workerThreadId === targetThreadId && message.toTaskIds.includes(task.id),
          ) &&
          !(message.toTarget === "owner" && plan.ownerThreadId === targetThreadId)
        ) {
          continue;
        }
        if (message.deliveryAttempts >= 3) {
          results.push(
            yield* failMessage(message, "Coordination message reached the delivery limit."),
          );
          continue;
        }

        if (message.toTarget === "worker") {
          const task = plan.tasks.find((candidate) => message.toTaskIds.includes(candidate.id));
          if (!task || task.workerThreadId === null) {
            continue;
          }
          const thread = yield* projectionSnapshotQuery
            .getThreadDetailById(task.workerThreadId)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(
                  cause,
                  `Failed to load worker thread ${task.workerThreadId}`,
                ),
              ),
            );
          if (Option.isNone(thread) || isThreadBusy(thread.value)) {
            continue;
          }
          const project = yield* loadProject(task.projectId);
          const modelSelection = resolveModelSelection(project);
          const runtimeMode = "approval-required";
          const interactionMode = "default";
          const now = yield* nowIso;
          const nextAttempts = message.deliveryAttempts + 1;
          const delivery = yield* dispatchCommand({
            type: "thread.turn.start",
            commandId: yield* serverCommandId("agent-worker-message-turn-start"),
            threadId: task.workerThreadId,
            message: {
              messageId: yield* messageId(),
              role: "user",
              text: buildWorkerMessagePrompt({
                plan,
                task,
                kind:
                  message.kind === "progress_request" ||
                  message.kind === "assignment" ||
                  message.kind === "clarification_response" ||
                  message.kind === "sync"
                    ? message.kind
                    : "sync",
                title: message.title,
                body: message.body,
                contracts: relevantContracts(plan, task),
                sharedUpdates: visibleSharedUpdates(plan),
              }),
              attachments: [],
            },
            modelSelection,
            titleSeed: message.title,
            runtimeMode,
            interactionMode,
            createdAt: now,
          }).pipe(
            Effect.map((result) => ({ _tag: "Success" as const, result })),
            Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
          );
          if (delivery._tag === "Failure") {
            results.push(
              yield* dispatchCoordinationMessage({
                ...message,
                status: nextAttempts >= 3 ? "failed" : "queued",
                deliveryAttempts: nextAttempts,
                failedAt: nextAttempts >= 3 ? now : null,
                failureReason: nextAttempts >= 3 ? delivery.error.message : null,
              }),
            );
            continue;
          }
          const upsertResult = yield* dispatchCoordinationMessage({
            ...message,
            status: "sent",
            toThreadIds: [task.workerThreadId],
            deliveryAttempts: nextAttempts,
            sentAt: now,
            failedAt: null,
            failureReason: null,
          });
          results.push(delivery.result, upsertResult);
          continue;
        }

        if (message.toTarget === "owner") {
          if (plan.ownerThreadId === null) {
            continue;
          }
          const ownerThread = yield* projectionSnapshotQuery
            .getThreadDetailById(plan.ownerThreadId)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, `Failed to load owner thread ${plan.ownerThreadId}`),
              ),
            );
          if (Option.isNone(ownerThread) || isThreadBusy(ownerThread.value)) {
            continue;
          }
          const task = message.fromTaskId
            ? (plan.tasks.find((candidate) => candidate.id === message.fromTaskId) ?? null)
            : null;
          if (task === null) {
            results.push(
              yield* failMessage(message, "Owner-directed message is missing a source task."),
            );
            continue;
          }
          const now = yield* nowIso;
          const nextAttempts = message.deliveryAttempts + 1;
          const prompt = buildOwnerWorkerReportPrompt({
            plan,
            task,
            reportTitle: message.title,
            reportBody: message.body,
            contracts: plan.contracts,
            relatedMessages: plan.coordinationMessages.slice(-20),
          });
          const delivery = yield* dispatchCommand({
            type: "thread.turn.start",
            commandId: yield* serverCommandId("agent-owner-queued-message-turn-start"),
            threadId: plan.ownerThreadId,
            message: {
              messageId: yield* messageId(),
              role: "user",
              text: prompt,
              attachments: [],
            },
            modelSelection: ownerThread.value.modelSelection,
            titleSeed: message.title,
            runtimeMode: "approval-required",
            interactionMode: "plan",
            createdAt: now,
          }).pipe(
            Effect.map((result) => ({ _tag: "Success" as const, result })),
            Effect.catch((error) => Effect.succeed({ _tag: "Failure" as const, error })),
          );
          if (delivery._tag === "Failure") {
            results.push(
              yield* dispatchCoordinationMessage({
                ...message,
                status: nextAttempts >= 3 ? "failed" : "queued",
                deliveryAttempts: nextAttempts,
                failedAt: nextAttempts >= 3 ? now : null,
                failureReason: nextAttempts >= 3 ? delivery.error.message : null,
              }),
            );
            continue;
          }
          const upsertResult = yield* dispatchCoordinationMessage({
            ...message,
            status: "sent",
            toThreadIds: [plan.ownerThreadId],
            deliveryAttempts: nextAttempts,
            sentAt: now,
            failedAt: null,
            failureReason: null,
          });
          results.push(delivery.result, upsertResult);
        }
      }
      return { sequence: maxSequence(results) };
    });

  const flushQueuedCoordinationMessages: AgentPlanServiceShape["flushQueuedCoordinationMessages"] =
    (planId) => loadPlan(planId).pipe(Effect.flatMap((plan) => flushQueuedMessagesForPlan(plan)));

  return {
    createManualPlan: (input) =>
      orchestrationEngine.dispatch({
        type: "agent-plan.create",
        commandId: input.commandId,
        planId: input.planId,
        title: input.title,
        userPrompt: input.userPrompt,
        projectIds: [...input.projectIds],
        ...(input.primaryProjectId !== undefined
          ? { primaryProjectId: input.primaryProjectId }
          : {}),
        createdAt: input.createdAt,
      }),

    startOwnerPlanning: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        if (
          plan.ownerThreadId !== null &&
          (plan.status === "planning" || plan.status === "running")
        ) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Agent plan already has an active owner planning thread.",
            cause: plan.ownerThreadId,
          });
        }

        const projectShells = yield* loadProjects(plan);
        const primaryProject = yield* resolvePrimaryProject(plan, projectShells);
        const modelSelection = resolveModelSelection(primaryProject, input.modelSelection);
        const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
        const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
        const now = yield* nowIso;
        const ownerThreadId = yield* threadId();
        const ownerMessageId = yield* messageId();
        const ownerThreadTitle = `Owner plan: ${plan.title}`;
        const prompt = buildOwnerPlanningPrompt({
          userPrompt: plan.userPrompt,
          projectSummaries: projectShells.map((project) => ({
            projectId: project.id,
            title: project.title,
            workspaceRoot: project.workspaceRoot,
          })),
        });

        const deleteOwnerThread = serverCommandId("agent-plan-owner-thread-delete").pipe(
          Effect.flatMap((commandId) =>
            dispatchCommand({
              type: "thread.delete",
              commandId,
              threadId: ownerThreadId,
            }),
          ),
          Effect.catch(() => Effect.void),
        );
        const clearOwnerThread = serverCommandId("agent-plan-owner-link-clear").pipe(
          Effect.flatMap((commandId) =>
            dispatchCommand({
              type: "agent-plan.update",
              commandId,
              planId: plan.id,
              ownerThreadId: null,
            }),
          ),
          Effect.catch(() => Effect.void),
        );
        const markOwnerPlanningFailed = serverCommandId("agent-plan-owner-status-failed").pipe(
          Effect.flatMap((commandId) =>
            dispatchCommand({
              type: "agent-plan.status.set",
              commandId,
              planId: plan.id,
              status: "failed",
            }),
          ),
          Effect.catch(() => Effect.void),
        );

        const createThreadResult = yield* dispatchCommand({
          type: "thread.create",
          commandId: yield* serverCommandId("agent-plan-owner-thread-create"),
          threadId: ownerThreadId,
          projectId: primaryProject.id,
          title: ownerThreadTitle,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: now,
        });
        const updateResult = yield* dispatchCommand({
          type: "agent-plan.update",
          commandId: yield* serverCommandId("agent-plan-owner-link"),
          planId: plan.id,
          ownerThreadId,
        }).pipe(Effect.tapError(() => deleteOwnerThread));
        const statusResult = yield* dispatchCommand({
          type: "agent-plan.status.set",
          commandId: yield* serverCommandId("agent-plan-owner-status"),
          planId: plan.id,
          status: "planning",
        }).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              yield* clearOwnerThread;
              yield* deleteOwnerThread;
            }),
          ),
        );
        const turnResult = yield* dispatchCommand({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("agent-plan-owner-turn-start"),
          threadId: ownerThreadId,
          message: {
            messageId: ownerMessageId,
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: ownerThreadTitle,
          runtimeMode,
          interactionMode,
          createdAt: now,
        }).pipe(
          Effect.tapError(() =>
            Effect.gen(function* () {
              yield* markOwnerPlanningFailed;
              yield* clearOwnerThread;
              yield* deleteOwnerThread;
            }),
          ),
        );

        return {
          planId: plan.id,
          ownerThreadId,
          sequence: maxSequence([createThreadResult, updateResult, statusResult, turnResult]),
        };
      }),

    importOwnerPlanOutput: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        if (["running", "reviewing", "completed"].includes(plan.status)) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Cannot import owner output while plan is ${plan.status}.`,
            cause: plan.status,
          });
        }
        if (plan.tasks.some((task) => task.workerThreadId !== null)) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Cannot replace/import owner output after workers have been launched.",
            cause: plan.id,
          });
        }
        if (plan.tasks.length > 0 && input.replaceDraft !== true) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Plan already has draft tasks. Pass replaceDraft to replace them.",
            cause: plan.id,
          });
        }

        let sourceText = input.jsonText;
        let sourceMessageId: MessageId | null = null;
        if (!sourceText) {
          if (plan.ownerThreadId === null) {
            return yield* new OrchestrationDispatchCommandError({
              message: "Plan has no owner thread to import output from.",
              cause: plan.id,
            });
          }
          const ownerThread = yield* projectionSnapshotQuery
            .getThreadDetailById(plan.ownerThreadId)
            .pipe(
              Effect.mapError((cause) =>
                toDispatchCommandError(cause, `Failed to load owner thread ${plan.ownerThreadId}`),
              ),
            );
          if (Option.isNone(ownerThread)) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Owner thread ${plan.ownerThreadId} was not found.`,
              cause: plan.ownerThreadId,
            });
          }
          const ownerMessage = latestCompletedAssistantMessage(
            ownerThread.value.messages,
            input.ownerMessageId,
          );
          if (!ownerMessage) {
            return yield* new OrchestrationDispatchCommandError({
              message: "No completed owner assistant message was found to import.",
              cause: plan.ownerThreadId,
            });
          }
          sourceText = ownerMessage.text;
          sourceMessageId = ownerMessage.id;
        }

        const parsed = yield* parseOwnerPlanOutput(sourceText).pipe(
          Effect.mapError((cause) =>
            toDispatchCommandError(cause, "Failed to parse owner planning JSON output."),
          ),
        );
        const now = yield* nowIso;
        const taskIdByKey = new Map(
          parsed.tasks.map((task) => [task.taskKey, taskIdFor(String(plan.id), task.taskKey)]),
        );
        const contractIdByKey = new Map(
          parsed.contracts.map((contract) => [
            contract.contractKey,
            contractIdFor(String(plan.id), contract.contractKey),
          ]),
        );
        const taskIds = new Set(taskIdByKey.values());
        const results: Array<{ sequence: number }> = [];

        for (const taskOutput of parsed.tasks) {
          for (const dependencyKey of taskOutput.dependsOn) {
            if (!taskIdByKey.has(dependencyKey)) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Owner output task '${taskOutput.title}' references unknown dependency '${dependencyKey}'.`,
                cause: dependencyKey,
              });
            }
          }
          for (const relatedTaskKey of taskOutput.relatedTasks) {
            if (!taskIdByKey.has(relatedTaskKey)) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Owner output task '${taskOutput.title}' references unknown related task '${relatedTaskKey}'.`,
                cause: relatedTaskKey,
              });
            }
          }
          for (const contractKey of [
            ...taskOutput.requiredContracts,
            ...taskOutput.producedContracts,
          ]) {
            if (!contractIdByKey.has(contractKey)) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Owner output task '${taskOutput.title}' references unknown contract '${contractKey}'.`,
                cause: contractKey,
              });
            }
          }
        }

        for (const contractOutput of parsed.contracts) {
          if (
            contractOutput.producerTaskKey !== null &&
            !taskIdByKey.has(contractOutput.producerTaskKey)
          ) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Owner output contract '${contractOutput.title}' references unknown producer task '${contractOutput.producerTaskKey}'.`,
              cause: contractOutput.producerTaskKey,
            });
          }
          for (const consumerTaskKey of contractOutput.consumerTaskKeys) {
            if (!taskIdByKey.has(consumerTaskKey)) {
              return yield* new OrchestrationDispatchCommandError({
                message: `Owner output contract '${contractOutput.title}' references unknown consumer task '${consumerTaskKey}'.`,
                cause: consumerTaskKey,
              });
            }
          }
        }

        for (const existing of plan.tasks) {
          if (!taskIds.has(existing.id) && existing.workerThreadId === null) {
            results.push(
              yield* dispatchCommand({
                type: "agent-task.upsert",
                commandId: yield* serverCommandId("agent-task-cancel-omitted-draft"),
                planId: plan.id,
                task: {
                  ...existing,
                  status: "cancelled",
                  updatedAt: now,
                },
              }),
            );
          }
        }

        for (const taskOutput of parsed.tasks) {
          const taskId = taskIdByKey.get(taskOutput.taskKey)!;
          const dependsOn = taskOutput.dependsOn
            .map((key) => taskIdByKey.get(key))
            .filter(Boolean) as AgentTaskId[];
          const relatedTaskIds = taskOutput.relatedTasks
            .map((key) => taskIdByKey.get(key))
            .filter(Boolean) as AgentTaskId[];
          const requiredContracts = taskOutput.requiredContracts
            .map((key) => contractIdByKey.get(key))
            .filter(Boolean) as AgentContractId[];
          const producedContracts = taskOutput.producedContracts
            .map((key) => contractIdByKey.get(key))
            .filter(Boolean) as AgentContractId[];
          if (!plan.projectIds.includes(taskOutput.projectId)) {
            return yield* new OrchestrationDispatchCommandError({
              message: `Owner output task '${taskOutput.title}' references unknown project ${taskOutput.projectId}.`,
              cause: taskOutput.projectId,
            });
          }
          results.push(
            yield* dispatchCommand({
              type: "agent-task.upsert",
              commandId: yield* serverCommandId("agent-task-import"),
              planId: plan.id,
              task: {
                id: taskId,
                planId: plan.id,
                title: taskOutput.title,
                description: taskOutput.description,
                status: "pending",
                projectId: taskOutput.projectId,
                workerThreadId: null,
                worktreePath: null,
                branchName: null,
                allowedPaths: [...taskOutput.allowedPaths],
                blockedPaths: [...taskOutput.blockedPaths],
                dependsOn,
                relatedTaskIds,
                requiredContracts,
                producedContracts,
                assignedProvider: null,
                summary: null,
                riskNotes: taskOutput.riskNotes.length > 0 ? taskOutput.riskNotes : null,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
        }

        for (const contractOutput of parsed.contracts) {
          const contractId = contractIdByKey.get(contractOutput.contractKey)!;
          results.push(
            yield* dispatchCommand({
              type: "agent-contract.upsert",
              commandId: yield* serverCommandId("agent-contract-import"),
              planId: plan.id,
              contract: {
                id: contractId,
                planId: plan.id,
                producerTaskId:
                  contractOutput.producerTaskKey === null
                    ? null
                    : (taskIdByKey.get(contractOutput.producerTaskKey) ?? null),
                consumerTaskIds: contractOutput.consumerTaskKeys
                  .map((key) => taskIdByKey.get(key))
                  .filter(Boolean) as AgentTaskId[],
                type: contractOutput.type,
                title: contractOutput.title,
                description: contractOutput.description,
                status: "proposed",
                version: 1,
                createdAt: now,
                updatedAt: now,
              },
            }),
          );
        }

        results.push(
          yield* dispatchCommand({
            type: "agent-plan.status.set",
            commandId: yield* serverCommandId("agent-plan-awaiting-approval"),
            planId: plan.id,
            status: "awaiting_approval",
          }),
        );
        results.push(
          yield* dispatchCoordinationMessage(
            makeCoordinationMessage({
              id: yield* coordinationMessageId(),
              planId: plan.id,
              dedupeKey: `owner-import:${plan.id}:${sourceMessageId ?? now}`,
              kind: "owner_plan_import",
              status: "acknowledged",
              fromRole: "owner",
              fromThreadId: plan.ownerThreadId,
              toTarget: "user",
              sourceMessageId,
              title: "Owner plan imported",
              body: `Imported ${parsed.tasks.length} tasks and ${parsed.contracts.length} contracts. ${parsed.summary}`,
              createdAt: now,
            }),
          ),
        );
        results.push(
          yield* dispatchSharedUpdate({
            id: AgentSharedUpdateId.make(`agent-update:${plan.id}:owner-import:${slugify(now)}`),
            planId: plan.id,
            taskId: null,
            type: "decision",
            title: "Owner task breakdown imported",
            body: `Imported ${parsed.tasks.length} tasks and ${parsed.contracts.length} contracts.\n\n${parsed.summary}`,
            visibility: "all_workers",
            relatedTaskIds: [],
            createdAt: now,
          }),
        );

        return {
          planId: plan.id,
          taskCount: parsed.tasks.length,
          contractCount: parsed.contracts.length,
          sequence: maxSequence(results),
        };
      }),

    approveAgentPlanTasks: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        const selectedTasks = input.taskIds
          ? plan.tasks.filter((task) => input.taskIds?.includes(task.id))
          : plan.tasks.filter((task) => task.status === "pending");
        if (selectedTasks.length === 0) {
          return { planId: plan.id, launchedTaskIds: [], skippedTaskIds: [], sequence: 0 };
        }
        if (input.allowPathOverlaps !== true) {
          for (let leftIndex = 0; leftIndex < selectedTasks.length; leftIndex += 1) {
            for (
              let rightIndex = leftIndex + 1;
              rightIndex < selectedTasks.length;
              rightIndex += 1
            ) {
              const left = selectedTasks[leftIndex]!;
              const right = selectedTasks[rightIndex]!;
              if (pathsOverlap(left.allowedPaths, right.allowedPaths)) {
                return yield* new OrchestrationDispatchCommandError({
                  message: `Tasks '${left.title}' and '${right.title}' have overlapping allowed paths.`,
                  cause: { left: left.id, right: right.id },
                });
              }
            }
          }
        }
        if (input.launch === true) {
          return yield* launchReadyWorkers({
            planId: input.planId,
            taskIds: selectedTasks.map((task) => task.id),
            reason: "approval",
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
          });
        }
        return {
          planId: plan.id,
          launchedTaskIds: [],
          skippedTaskIds: selectedTasks.map((task) => task.id),
          sequence: 0,
        };
      }),

    launchReadyWorkers,

    sendWorkerMessage: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        const task = plan.tasks.find((candidate) => candidate.id === input.taskId);
        if (!task) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Task ${input.taskId} was not found in plan ${plan.id}.`,
            cause: input.taskId,
          });
        }
        const queued = yield* queueWorkerMessage({
          plan,
          task,
          kind: input.kind,
          title: input.title,
          body: input.body,
          requiresResponse: input.requiresResponse ?? false,
        });
        const flushed = yield* flushQueuedCoordinationMessages(plan.id);
        return { sequence: Math.max(queued.sequence, flushed.sequence) };
      }),

    queueCoordinationMessage: dispatchCoordinationMessage,
    flushQueuedCoordinationMessages,

    retryCoordinationMessage: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        const message = plan.coordinationMessages.find(
          (candidate) => candidate.id === input.messageId,
        );
        if (!message) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Coordination message ${input.messageId} was not found in plan ${plan.id}.`,
            cause: input.messageId,
          });
        }
        if (message.status !== "queued" && message.status !== "failed") {
          return yield* new OrchestrationDispatchCommandError({
            message: "Only queued or failed coordination messages can be retried.",
            cause: message.status,
          });
        }
        if (message.toTarget !== "worker" && message.toTarget !== "owner") {
          return yield* new OrchestrationDispatchCommandError({
            message: "Only owner- or worker-directed coordination messages can be retried.",
            cause: message.toTarget,
          });
        }

        const retryMessage: AgentCoordinationMessage = {
          ...message,
          status: "queued",
          sentAt: null,
          failedAt: null,
          failureReason: null,
        };
        const queued = yield* dispatchCoordinationMessage(retryMessage);
        const flushed = yield* flushQueuedMessagesForPlan({
          ...plan,
          coordinationMessages: plan.coordinationMessages.map((candidate) =>
            candidate.id === retryMessage.id ? retryMessage : candidate,
          ),
        });
        return { sequence: Math.max(queued.sequence, flushed.sequence) };
      }),

    startReviewer: (input) =>
      Effect.gen(function* () {
        const plan = yield* loadPlan(input.planId);
        const activeTasks = plan.tasks.filter((task) => task.status !== "cancelled");
        if (
          activeTasks.length === 0 ||
          activeTasks.some((task) => !TERMINAL_TASK_STATUSES.has(task.status))
        ) {
          return yield* new OrchestrationDispatchCommandError({
            message: "All non-cancelled tasks must be terminal before review starts.",
            cause: plan.id,
          });
        }
        const projects = yield* loadProjects(plan);
        const primaryProject = yield* resolvePrimaryProject(plan, projects);
        const modelSelection = resolveModelSelection(primaryProject, input.modelSelection);
        const runtimeMode = input.runtimeMode ?? DEFAULT_RUNTIME_MODE;
        const interactionMode = input.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE;
        const now = yield* nowIso;
        const reviewerThreadId = yield* threadId();
        const nextReviewId = yield* reviewId();
        const title = `Review: ${plan.title}`;
        const prompt = buildReviewerPrompt({
          plan,
          workerSummaries: plan.tasks.map((task) => ({
            task,
            updates: plan.sharedUpdates.filter((update) => update.taskId === task.id),
          })),
        });
        const createThreadResult = yield* dispatchCommand({
          type: "thread.create",
          commandId: yield* serverCommandId("agent-review-thread-create"),
          threadId: reviewerThreadId,
          projectId: primaryProject.id,
          title,
          modelSelection,
          runtimeMode,
          interactionMode,
          branch: null,
          worktreePath: null,
          createdAt: now,
        });
        const reviewResult = yield* dispatchCommand({
          type: "agent-review.upsert",
          commandId: yield* serverCommandId("agent-review-upsert"),
          planId: plan.id,
          review: {
            id: nextReviewId,
            planId: plan.id,
            reviewerThreadId,
            status: "pending",
            summary: "Reviewer is running.",
            mergeOrder: [],
            requiredFixes: [],
            risks: [],
            testRecommendations: [],
            createdAt: now,
            updatedAt: now,
          },
        });
        const statusResult = yield* dispatchCommand({
          type: "agent-plan.status.set",
          commandId: yield* serverCommandId("agent-plan-reviewing"),
          planId: plan.id,
          status: "reviewing",
        });
        const turnResult = yield* dispatchCommand({
          type: "thread.turn.start",
          commandId: yield* serverCommandId("agent-review-turn-start"),
          threadId: reviewerThreadId,
          message: {
            messageId: yield* messageId(),
            role: "user",
            text: prompt,
            attachments: [],
          },
          modelSelection,
          titleSeed: title,
          runtimeMode,
          interactionMode,
          createdAt: now,
        });
        return {
          planId: plan.id,
          reviewId: nextReviewId,
          reviewerThreadId,
          sequence: maxSequence([createThreadResult, reviewResult, statusResult, turnResult]),
        };
      }),

    upsertTask: (planId, commandId, task) =>
      orchestrationEngine.dispatch({
        type: "agent-task.upsert",
        commandId,
        planId,
        task,
      }),
    appendSharedUpdate: (planId, commandId, update) =>
      orchestrationEngine.dispatch({
        type: "agent-shared-update.append",
        commandId,
        planId,
        update,
      }),
    upsertContract: (planId, commandId, contract) =>
      orchestrationEngine.dispatch({
        type: "agent-contract.upsert",
        commandId,
        planId,
        contract,
      }),
    upsertReview: (planId, commandId, review) =>
      orchestrationEngine.dispatch({
        type: "agent-review.upsert",
        commandId,
        planId,
        review,
      }),
  } satisfies AgentPlanServiceShape;
});

export const AgentPlanServiceLive = Layer.effect(AgentPlanService, makeAgentPlanService);
