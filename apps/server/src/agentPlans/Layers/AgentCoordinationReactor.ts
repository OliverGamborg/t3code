import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentReviewId,
  AgentSharedUpdateId,
  AgentTaskId,
  CommandId,
  DEFAULT_MODEL,
  MessageId,
  OrchestrationDispatchCommandError,
  ProviderInstanceId,
  ThreadId,
  type AgentContract,
  type AgentCoordinationMessage,
  type AgentPlan,
  type AgentTask,
  type AgentWorkerContractUpdate,
  type OrchestrationEvent,
  type OrchestrationMessage,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager } from "../../worktrees/Services/WorktreeManager.ts";
import {
  buildOwnerWorkerReportPrompt,
  buildReviewerPrompt,
  buildWorkerExecutionPrompt,
  buildWorkerMessagePrompt,
} from "../prompts.ts";
import {
  parseOwnerRoutingOutput,
  parseReviewerOutput,
  parseWorkerReport,
} from "../structuredOutput.ts";
import {
  AgentCoordinationReactor,
  type AgentCoordinationReactorShape,
} from "../Services/AgentCoordinationReactor.ts";

type AssistantMessageEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const MAX_ROUTING_DEPTH = 3;

function messageText(
  messages: ReadonlyArray<OrchestrationMessage>,
  messageId: MessageId,
  fallback: string,
): string {
  return messages.find((message) => message.id === messageId)?.text ?? fallback;
}

function taskIdFor(planId: string, taskKey: string) {
  return `agent-task:${planId}:${taskKey
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
}

function makeMessage(input: {
  readonly id: AgentCoordinationMessage["id"];
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
  readonly fromThreadId?: AgentCoordinationMessage["fromThreadId"];
  readonly toTaskIds?: ReadonlyArray<AgentTask["id"]>;
  readonly toThreadIds?: ReadonlyArray<AgentCoordinationMessage["toThreadIds"][number]>;
  readonly sourceMessageId?: MessageId | null;
  readonly sourceTurnId?: AgentCoordinationMessage["sourceTurnId"];
  readonly correlationId?: string | null;
  readonly requiresResponse?: boolean;
  readonly deliveryAttempts?: number;
  readonly sentAt?: string | null;
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
    acknowledgedAt: null,
    failedAt: input.failedAt ?? null,
    failureReason: input.failureReason ?? null,
  };
}

function contractFromUpdate(input: {
  readonly plan: AgentPlan;
  readonly task: AgentTask | null;
  readonly update: AgentWorkerContractUpdate;
  readonly now: string;
}): AgentContract {
  const existing =
    input.update.contractId !== undefined
      ? input.plan.contracts.find((contract) => contract.id === input.update.contractId)
      : input.update.contractTitle
        ? input.plan.contracts.find((contract) => contract.title === input.update.contractTitle)
        : undefined;
  const id =
    existing?.id ??
    input.update.contractId ??
    AgentContractId.make(
      `agent-contract:${input.plan.id}:${String(input.update.contractTitle ?? "worker-update")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`,
    );
  return {
    id,
    planId: input.plan.id,
    producerTaskId: existing?.producerTaskId ?? input.task?.id ?? null,
    consumerTaskIds: existing?.consumerTaskIds ?? [],
    type: input.update.type ?? existing?.type ?? "other",
    title: input.update.contractTitle ?? existing?.title ?? "Worker contract update",
    description: input.update.description,
    status: input.update.status,
    version: (existing?.version ?? 0) + 1,
    createdAt: existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const worktreeManager = yield* WorktreeManager;

  const randomUuid = crypto.randomUUIDv4;
  const commandId = (tag: string) =>
    randomUuid.pipe(Effect.map((uuid) => CommandId.make(`server:${tag}:${uuid}`)));
  const coordinationMessageId = () =>
    randomUuid.pipe(Effect.map((uuid) => AgentCoordinationMessageId.make(uuid)));
  const dispatch = (command: Parameters<typeof orchestrationEngine.dispatch>[0]) =>
    orchestrationEngine.dispatch(command).pipe(
      Effect.mapError(
        (cause) =>
          new OrchestrationDispatchCommandError({
            message: cause instanceof Error ? cause.message : "Failed to dispatch command.",
            cause,
          }),
      ),
    );

  const upsertCoordination = (message: AgentCoordinationMessage) =>
    commandId("agent-reactor-coordination-message").pipe(
      Effect.flatMap((nextCommandId) =>
        dispatch({
          type: "agent-coordination-message.upsert",
          commandId: nextCommandId,
          planId: message.planId,
          message,
        }),
      ),
    );

  const upsertTask = (plan: AgentPlan, task: AgentTask) =>
    commandId("agent-reactor-task-upsert").pipe(
      Effect.flatMap((nextCommandId) =>
        dispatch({
          type: "agent-task.upsert",
          commandId: nextCommandId,
          planId: plan.id,
          task,
        }),
      ),
    );

  const appendSharedUpdate = (input: {
    readonly plan: AgentPlan;
    readonly task: AgentTask | null;
    readonly type: "progress" | "blocker" | "test_result" | "contract" | "review_note" | "risk";
    readonly title: string;
    readonly body: string;
    readonly now: string;
  }) =>
    commandId("agent-reactor-shared-update").pipe(
      Effect.flatMap((nextCommandId) =>
        dispatch({
          type: "agent-shared-update.append",
          commandId: nextCommandId,
          planId: input.plan.id,
          update: {
            id: AgentSharedUpdateId.make(
              `agent-update:${input.plan.id}:${input.task?.id ?? "plan"}:${input.now}:${input.type}`,
            ),
            planId: input.plan.id,
            taskId: input.task?.id ?? null,
            type: input.type,
            title: input.title,
            body: input.body,
            visibility: "all_workers",
            relatedTaskIds: input.task ? [input.task.id] : [],
            createdAt: input.now,
          },
        }),
      ),
    );

  const upsertContract = (plan: AgentPlan, contract: AgentContract) =>
    commandId("agent-reactor-contract-upsert").pipe(
      Effect.flatMap((nextCommandId) =>
        dispatch({
          type: "agent-contract.upsert",
          commandId: nextCommandId,
          planId: plan.id,
          contract,
        }),
      ),
    );

  const resolveProject = (projectId: AgentPlan["projectIds"][number]) =>
    projectionSnapshotQuery.getProjectShellById(projectId).pipe(
      Effect.flatMap((project) =>
        Option.isSome(project)
          ? Effect.succeed(project.value)
          : Effect.fail(
              new OrchestrationDispatchCommandError({
                message: `Project ${projectId} was not found.`,
              }),
            ),
      ),
    );

  const isThreadBusy = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadDetailById(threadId).pipe(
      Effect.map((detail) => {
        if (Option.isNone(detail)) return true;
        return detail.value.latestTurn?.state === "running";
      }),
    );

  const dispatchWorkerTurn = (input: {
    readonly plan: AgentPlan;
    readonly task: AgentTask;
    readonly title: string;
    readonly body: string;
    readonly kind: AgentCoordinationMessage["kind"];
    readonly now: string;
    readonly sourceMessageId?: MessageId | null;
    readonly requiresResponse?: boolean;
  }) =>
    Effect.gen(function* () {
      if (input.task.workerThreadId === null) {
        yield* upsertCoordination(
          makeMessage({
            id: yield* coordinationMessageId(),
            planId: input.plan.id,
            dedupeKey: `worker-message-unassigned:${input.plan.id}:${input.task.id}:${input.title}:${input.now}`,
            kind: input.kind,
            status: "queued",
            fromRole: "owner",
            toTarget: "worker",
            toTaskIds: [input.task.id],
            title: input.title,
            body: input.body,
            createdAt: input.now,
            requiresResponse: input.requiresResponse ?? true,
          }),
        );
        return;
      }

      const busy = yield* isThreadBusy(input.task.workerThreadId);
      const message = makeMessage({
        id: yield* coordinationMessageId(),
        planId: input.plan.id,
        dedupeKey: `worker-message:${input.plan.id}:${input.task.id}:${input.sourceMessageId ?? input.now}:${input.title}`,
        kind: input.kind,
        status: busy ? "queued" : "sent",
        fromRole: "owner",
        fromThreadId: input.plan.ownerThreadId,
        toTarget: "worker",
        toTaskIds: [input.task.id],
        toThreadIds: [input.task.workerThreadId],
        sourceMessageId: input.sourceMessageId ?? null,
        title: input.title,
        body: input.body,
        createdAt: input.now,
        sentAt: busy ? null : input.now,
        requiresResponse: input.requiresResponse ?? true,
        deliveryAttempts: busy ? 0 : 1,
      });
      yield* upsertCoordination(message);
      if (busy) return;

      yield* dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("agent-worker-route-turn"),
        threadId: input.task.workerThreadId,
        message: {
          messageId: yield* randomUuid.pipe(Effect.map(MessageId.make)),
          role: "user",
          text: buildWorkerMessagePrompt({
            plan: input.plan,
            task: input.task,
            kind: input.kind as
              | "progress_request"
              | "assignment"
              | "clarification_response"
              | "sync",
            title: input.title,
            body: input.body,
            contracts: input.plan.contracts.filter(
              (contract) =>
                input.task.requiredContracts.includes(contract.id) ||
                input.task.producedContracts.includes(contract.id) ||
                contract.consumerTaskIds.includes(input.task.id) ||
                contract.producerTaskId === input.task.id,
            ),
            sharedUpdates: input.plan.sharedUpdates.slice(-20),
          }),
          attachments: [],
        },
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        },
        titleSeed: input.title,
        runtimeMode: "approval-required",
        interactionMode: "default",
        createdAt: input.now,
      });
    });

  const launchReadyWorkers = (plan: AgentPlan) =>
    Effect.gen(function* () {
      for (const task of plan.tasks) {
        if (task.status !== "pending" || task.workerThreadId !== null) continue;
        const dependenciesDone = task.dependsOn.every((dependencyId) =>
          plan.tasks.some(
            (candidate) => candidate.id === dependencyId && candidate.status === "done",
          ),
        );
        if (!dependenciesDone) continue;

        const project = yield* resolveProject(task.projectId);
        const worktree = yield* worktreeManager.createForAgentTask(task);
        const now = yield* nowIso;
        const threadId = ThreadId.make(yield* randomUuid);
        const workerTask = {
          ...task,
          status: "running" as const,
          workerThreadId: threadId,
          worktreePath: worktree.worktreePath,
          branchName: worktree.branchName,
          updatedAt: now,
        };
        const modelSelection = project.defaultModelSelection ?? {
          instanceId: ProviderInstanceId.make("codex"),
          model: DEFAULT_MODEL,
        };
        yield* dispatch({
          type: "thread.create",
          commandId: yield* commandId("agent-worker-thread-create"),
          threadId,
          projectId: project.id,
          title: `Worker: ${task.title}`,
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          branch: worktree.branchName,
          worktreePath: worktree.worktreePath,
          createdAt: now,
        });
        yield* upsertTask(plan, workerTask);
        yield* dispatch({
          type: "thread.turn.start",
          commandId: yield* commandId("agent-worker-turn-start"),
          threadId,
          message: {
            messageId: yield* randomUuid.pipe(Effect.map(MessageId.make)),
            role: "user",
            text: buildWorkerExecutionPrompt({
              plan,
              task: workerTask,
              relatedTasks: plan.tasks.filter((candidate) =>
                task.relatedTaskIds.includes(candidate.id),
              ),
              contracts: plan.contracts.filter(
                (contract) =>
                  task.requiredContracts.includes(contract.id) ||
                  task.producedContracts.includes(contract.id) ||
                  contract.consumerTaskIds.includes(task.id) ||
                  contract.producerTaskId === task.id,
              ),
              sharedDecisions: plan.sharedUpdates.slice(-20),
            }),
            attachments: [],
          },
          modelSelection,
          titleSeed: `Worker: ${task.title}`,
          runtimeMode: "approval-required",
          interactionMode: "default",
          createdAt: now,
        });
        yield* upsertCoordination(
          makeMessage({
            id: yield* coordinationMessageId(),
            planId: plan.id,
            dedupeKey: `worker-assignment:${plan.id}:${task.id}:${threadId}`,
            kind: "assignment",
            status: "sent",
            fromRole: "owner",
            toTarget: "worker",
            toTaskIds: [task.id],
            toThreadIds: [threadId],
            title: `Assigned ${task.title}`,
            body: task.description,
            createdAt: now,
            sentAt: now,
            deliveryAttempts: 1,
            requiresResponse: true,
          }),
        );
      }
    });

  const startReviewer = (plan: AgentPlan) =>
    Effect.gen(function* () {
      if (
        plan.reviews.some((review) => review.status === "pending") ||
        plan.tasks.some(
          (task) =>
            task.status !== "done" && task.status !== "failed" && task.status !== "cancelled",
        )
      ) {
        return;
      }
      const primaryProjectId = plan.primaryProjectId ?? plan.projectIds[0];
      if (!primaryProjectId) return;
      const project = yield* resolveProject(primaryProjectId);
      const now = yield* nowIso;
      const reviewerThreadId = ThreadId.make(yield* randomUuid);
      const reviewId = AgentReviewId.make(yield* randomUuid);
      const modelSelection = project.defaultModelSelection ?? {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      };
      yield* dispatch({
        type: "thread.create",
        commandId: yield* commandId("agent-review-thread-create"),
        threadId: reviewerThreadId,
        projectId: project.id,
        title: `Reviewer: ${plan.title}`,
        modelSelection,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        branch: null,
        worktreePath: null,
        createdAt: now,
      });
      yield* dispatch({
        type: "agent-review.upsert",
        commandId: yield* commandId("agent-review-upsert"),
        planId: plan.id,
        review: {
          id: reviewId,
          planId: plan.id,
          reviewerThreadId,
          status: "pending",
          summary: "",
          mergeOrder: [],
          requiredFixes: [],
          risks: [],
          testRecommendations: [],
          createdAt: now,
          updatedAt: now,
        },
      });
      yield* dispatch({
        type: "agent-plan.status.set",
        commandId: yield* commandId("agent-review-status"),
        planId: plan.id,
        status: "reviewing",
      });
      yield* dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("agent-review-turn-start"),
        threadId: reviewerThreadId,
        message: {
          messageId: yield* randomUuid.pipe(Effect.map(MessageId.make)),
          role: "user",
          text: buildReviewerPrompt({
            plan,
            workerSummaries: plan.tasks.map((task) => ({
              task,
              updates: plan.sharedUpdates.filter((update) => update.taskId === task.id),
            })),
          }),
          attachments: [],
        },
        modelSelection,
        titleSeed: `Review: ${plan.title}`,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdAt: now,
      });
    });

  const notifyOwner = (input: {
    readonly plan: AgentPlan;
    readonly task: AgentTask;
    readonly title: string;
    readonly body: string;
    readonly correlationId: string;
    readonly now: string;
    readonly sourceMessageId: MessageId;
  }) =>
    Effect.gen(function* () {
      if (input.plan.ownerThreadId === null) {
        return;
      }
      const ownerThread = yield* projectionSnapshotQuery.getThreadDetailById(
        input.plan.ownerThreadId,
      );
      if (Option.isNone(ownerThread)) {
        return;
      }
      const depth = input.plan.coordinationMessages.filter(
        (message) => message.correlationId === input.correlationId,
      ).length;
      if (depth >= MAX_ROUTING_DEPTH) {
        yield* appendSharedUpdate({
          plan: input.plan,
          task: input.task,
          type: "blocker",
          title: "Autonomous routing paused",
          body: "The owner/worker routing depth limit was reached. User input is required.",
          now: input.now,
        });
        return;
      }
      const prompt = buildOwnerWorkerReportPrompt({
        plan: input.plan,
        task: input.task,
        reportTitle: input.title,
        reportBody: input.body,
        contracts: input.plan.contracts,
        relatedMessages: input.plan.coordinationMessages.slice(-20),
      });
      yield* dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("agent-owner-worker-report-turn"),
        threadId: input.plan.ownerThreadId,
        message: {
          messageId: yield* randomUuid.pipe(Effect.map(MessageId.make)),
          role: "user",
          text: prompt,
          attachments: [],
        },
        modelSelection: ownerThread.value.modelSelection,
        titleSeed: input.title,
        runtimeMode: "approval-required",
        interactionMode: "plan",
        createdAt: input.now,
      });
      yield* upsertCoordination(
        makeMessage({
          id: yield* coordinationMessageId(),
          planId: input.plan.id,
          dedupeKey: `owner-notify:${input.plan.id}:${input.sourceMessageId}`,
          kind: "sync",
          status: "sent",
          fromRole: "system",
          fromTaskId: input.task.id,
          fromThreadId: input.task.workerThreadId,
          toTarget: "owner",
          toThreadIds: [input.plan.ownerThreadId],
          sourceMessageId: input.sourceMessageId,
          correlationId: input.correlationId,
          title: input.title,
          body: input.body,
          createdAt: input.now,
          sentAt: input.now,
          requiresResponse: true,
          deliveryAttempts: 1,
        }),
      );
    });

  const findPlanRole = Effect.fn("findPlanRole")(function* (threadId: string) {
    const shell = yield* projectionSnapshotQuery.getShellSnapshot();
    for (const planShell of shell.agentPlans) {
      const detail = yield* projectionSnapshotQuery.getAgentPlanDetailById(planShell.id);
      if (Option.isNone(detail)) continue;
      const plan = detail.value.plan;
      if (plan.ownerThreadId === threadId) {
        return { plan, role: "owner" as const, task: null, reviewId: null };
      }
      const task = plan.tasks.find((candidate) => candidate.workerThreadId === threadId);
      if (task) {
        return { plan, role: "worker" as const, task, reviewId: null };
      }
      const review = plan.reviews.find((candidate) => candidate.reviewerThreadId === threadId);
      if (review) {
        return { plan, role: "reviewer" as const, task: null, reviewId: review.id };
      }
    }
    return null;
  });

  const processWorkerMessage = Effect.fn("processWorkerMessage")(function* (
    event: AssistantMessageEvent,
    plan: AgentPlan,
    task: AgentTask,
    text: string,
  ) {
    const now = yield* nowIso;
    const dedupeKey = `worker-report:${plan.id}:${task.id}:${event.payload.messageId}`;
    if (plan.coordinationMessages.some((message) => message.dedupeKey === dedupeKey)) {
      return;
    }
    const report = yield* parseWorkerReport(text).pipe(
      Effect.tapError((error) =>
        upsertCoordination(
          makeMessage({
            id: AgentCoordinationMessageId.make(
              `agent-coordination-error:${event.payload.messageId}`,
            ),
            planId: plan.id,
            dedupeKey,
            kind: "error",
            status: "failed",
            fromRole: "worker",
            fromTaskId: task.id,
            fromThreadId: task.workerThreadId,
            toTarget: "owner",
            sourceMessageId: event.payload.messageId,
            sourceTurnId: event.payload.turnId,
            title: "Worker report parse failed",
            body: error.message,
            createdAt: now,
            failedAt: now,
            failureReason: error.message,
          }),
        ),
      ),
    );
    const nextStatus =
      report.status === "progress"
        ? task.status
        : report.status === "blocked"
          ? "blocked"
          : report.status === "done"
            ? "done"
            : "failed";
    yield* appendSharedUpdate({
      plan,
      task,
      type:
        report.status === "blocked"
          ? "blocker"
          : report.status === "done"
            ? "progress"
            : report.status === "failed"
              ? "risk"
              : "progress",
      title: report.title,
      body: [report.summary, report.details, ...report.testResults, ...report.blockers]
        .filter(Boolean)
        .join("\n\n"),
      now,
    });
    yield* upsertTask(plan, {
      ...task,
      status: nextStatus,
      summary: report.summary,
      riskNotes: report.blockers.length > 0 ? report.blockers.join("\n") : task.riskNotes,
      updatedAt: now,
    });
    for (const update of report.changedContracts) {
      yield* upsertContract(plan, contractFromUpdate({ plan, task, update, now }));
    }
    yield* upsertCoordination(
      makeMessage({
        id: yield* coordinationMessageId(),
        planId: plan.id,
        dedupeKey,
        kind:
          report.status === "blocked"
            ? "blocker"
            : report.status === "done"
              ? "completion"
              : "progress_report",
        status: "acknowledged",
        fromRole: "worker",
        fromTaskId: task.id,
        fromThreadId: task.workerThreadId,
        toTarget: "owner",
        sourceMessageId: event.payload.messageId,
        sourceTurnId: event.payload.turnId,
        correlationId: String(event.payload.messageId),
        title: report.title,
        body: report.summary,
        createdAt: now,
        requiresResponse:
          report.requiresOwnerResponse ||
          report.status === "blocked" ||
          report.status === "done" ||
          report.status === "failed" ||
          report.changedContracts.length > 0,
      }),
    );
    if (
      report.requiresOwnerResponse ||
      report.status === "blocked" ||
      report.status === "done" ||
      report.status === "failed" ||
      report.changedContracts.length > 0
    ) {
      yield* notifyOwner({
        plan,
        task,
        title: report.title,
        body: report.summary,
        correlationId: String(event.payload.messageId),
        now,
        sourceMessageId: event.payload.messageId,
      });
    }
    if (report.status === "done") {
      yield* launchReadyWorkers(plan).pipe(Effect.catch(() => Effect.void));
    }
  });

  const processOwnerMessage = Effect.fn("processOwnerMessage")(function* (
    event: AssistantMessageEvent,
    plan: AgentPlan,
    text: string,
  ) {
    if (!text.includes("t3-agent-owner-routing")) return;
    const now = yield* nowIso;
    const output = yield* parseOwnerRoutingOutput(text);
    for (const taskUpdate of output.taskUpdates) {
      const taskId =
        taskUpdate.taskId ??
        (taskUpdate.taskKey
          ? AgentTaskId.make(taskIdFor(String(plan.id), taskUpdate.taskKey))
          : null);
      const task = taskId ? plan.tasks.find((candidate) => candidate.id === taskId) : undefined;
      if (task) {
        yield* upsertTask(plan, {
          ...task,
          ...(taskUpdate.status ? { status: taskUpdate.status } : {}),
          ...(taskUpdate.summary !== undefined ? { summary: taskUpdate.summary } : {}),
          ...(taskUpdate.riskNotes !== undefined ? { riskNotes: taskUpdate.riskNotes } : {}),
          updatedAt: now,
        });
      }
    }
    for (const contractUpdate of output.contractUpdates) {
      yield* upsertContract(
        plan,
        contractFromUpdate({ plan, task: null, update: contractUpdate, now }),
      );
    }
    for (const route of output.routeMessages) {
      const targetIds = [
        ...route.targetTaskIds,
        ...route.targetTaskKeys.map((key) => AgentTaskId.make(taskIdFor(String(plan.id), key))),
      ];
      for (const targetId of targetIds) {
        const target = plan.tasks.find((candidate) => candidate.id === targetId);
        if (!target) continue;
        yield* dispatchWorkerTurn({
          plan,
          task: target,
          kind: route.kind,
          title: route.title,
          body: route.body,
          now,
          sourceMessageId: event.payload.messageId,
          requiresResponse: route.requiresResponse,
        });
      }
    }
    if (output.askUser !== null) {
      yield* appendSharedUpdate({
        plan,
        task: null,
        type: "blocker",
        title: "Owner needs user input",
        body: output.askUser,
        now,
      });
    }
    if (
      output.readyForReview &&
      plan.tasks.length > 0 &&
      plan.tasks.every(
        (task) => task.status === "done" || task.status === "failed" || task.status === "cancelled",
      )
    ) {
      yield* startReviewer(plan).pipe(Effect.catch(() => Effect.void));
    }
  });

  const processReviewerMessage = Effect.fn("processReviewerMessage")(function* (
    event: AssistantMessageEvent,
    plan: AgentPlan,
    reviewId: AgentReviewId,
    text: string,
  ) {
    if (!text.includes("t3-agent-review")) return;
    const now = yield* nowIso;
    const output = yield* parseReviewerOutput(text);
    yield* dispatch({
      type: "agent-review.upsert",
      commandId: yield* commandId("agent-review-complete"),
      planId: plan.id,
      review: {
        id: reviewId,
        planId: plan.id,
        reviewerThreadId: event.payload.threadId,
        status: output.status,
        summary: output.summary,
        mergeOrder: output.mergeOrder,
        requiredFixes: output.requiredFixes,
        risks: output.risks,
        testRecommendations: output.testRecommendations,
        createdAt: now,
        updatedAt: now,
      },
    });
    yield* dispatch({
      type: "agent-plan.status.set",
      commandId: yield* commandId("agent-review-status"),
      planId: plan.id,
      status: output.status === "failed" ? "failed" : "completed",
    });
  });

  const processEvent = Effect.fn("processAgentCoordinationEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (
      event.type !== "thread.message-sent" ||
      event.payload.role !== "assistant" ||
      event.payload.streaming
    ) {
      return;
    }
    const role = yield* findPlanRole(String(event.payload.threadId));
    if (!role) return;
    const thread = yield* projectionSnapshotQuery.getThreadDetailById(event.payload.threadId);
    const text = Option.isSome(thread)
      ? messageText(thread.value.messages, event.payload.messageId, event.payload.text)
      : event.payload.text;
    if (role.role === "worker" && role.task) {
      yield* processWorkerMessage(event, role.plan, role.task, text);
    } else if (role.role === "owner") {
      yield* processOwnerMessage(event, role.plan, text);
    } else if (role.role === "reviewer" && role.reviewId) {
      yield* processReviewerMessage(event, role.plan, role.reviewId, text);
    }
  });

  const processEventSafely = (event: OrchestrationEvent) =>
    processEvent(event).pipe(
      Effect.catchCause((cause) => {
        if (Cause.hasInterruptsOnly(cause)) {
          return Effect.failCause(cause);
        }
        return Effect.logWarning("agent coordination reactor failed to process event", {
          eventType: event.type,
          cause: Cause.pretty(cause),
        });
      }),
    );

  const worker = yield* makeDrainableWorker(processEventSafely);

  const start: AgentCoordinationReactorShape["start"] = Effect.fn("start")(function* () {
    yield* Effect.forkScoped(
      Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => worker.enqueue(event)),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies AgentCoordinationReactorShape;
});

export const AgentCoordinationReactorLive = Layer.effect(AgentCoordinationReactor, make);
