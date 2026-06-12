import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentPlanId,
  AgentReviewId,
  AgentTaskId,
  CommandId,
  DEFAULT_MODEL,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AgentContract,
  type AgentCoordinationMessage,
  type AgentPlan,
  type AgentPlanDetailSnapshot,
  type AgentReview,
  type AgentTask,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager } from "../../worktrees/Services/WorktreeManager.ts";
import { AgentCoordinationReactor } from "../Services/AgentCoordinationReactor.ts";
import { AgentCoordinationReactorLive } from "./AgentCoordinationReactor.ts";
import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";

const PLAN_ID = AgentPlanId.make("agent-plan-reactor");
const PROJECT_ID = ProjectId.make("project-reactor");
const TASK_A_ID = AgentTaskId.make("agent-task:agent-plan-reactor:task-a");
const TASK_B_ID = AgentTaskId.make("agent-task:agent-plan-reactor:task-b");
const OWNER_THREAD_ID = ThreadId.make("thread-owner");
const WORKER_A_THREAD_ID = ThreadId.make("thread-worker-a");
const WORKER_B_THREAD_ID = ThreadId.make("thread-worker-b");
const REVIEWER_THREAD_ID = ThreadId.make("thread-reviewer");
const NOW = "2026-06-09T00:00:00.000Z";

function makeProject(): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Project",
    workspaceRoot: "/workspace/project",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: TASK_A_ID,
    planId: PLAN_ID,
    title: "Task A",
    description: "Task A.",
    status: "running",
    projectId: PROJECT_ID,
    workerThreadId: WORKER_A_THREAD_ID,
    worktreePath: "/worktrees/task-a",
    branchName: "agent/plan/task-a",
    allowedPaths: ["src/a"],
    blockedPaths: [],
    dependsOn: [],
    relatedTaskIds: [],
    requiredContracts: [],
    producedContracts: [],
    assignedProvider: null,
    summary: null,
    riskNotes: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeContract(overrides: Partial<AgentContract> = {}): AgentContract {
  return {
    id: AgentContractId.make("agent-contract:agent-plan-reactor:api"),
    planId: PLAN_ID,
    producerTaskId: TASK_A_ID,
    consumerTaskIds: [],
    type: "api",
    title: "API",
    description: "API contract.",
    status: "proposed",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeCoordinationMessage(
  overrides: Partial<AgentCoordinationMessage> = {},
): AgentCoordinationMessage {
  return {
    id: AgentCoordinationMessageId.make("coordination-a"),
    planId: PLAN_ID,
    dedupeKey: "coordination-a",
    kind: "sync",
    status: "queued",
    fromRole: "owner",
    fromTaskId: null,
    fromThreadId: OWNER_THREAD_ID,
    toTarget: "worker",
    toTaskIds: [TASK_A_ID],
    toThreadIds: [WORKER_A_THREAD_ID],
    sourceMessageId: null,
    sourceTurnId: null,
    correlationId: null,
    title: "Queued",
    body: "Queued body.",
    requiresResponse: false,
    deliveryAttempts: 0,
    createdAt: NOW,
    sentAt: null,
    acknowledgedAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

function makeReview(overrides: Partial<AgentReview> = {}): AgentReview {
  return {
    id: AgentReviewId.make("review-a"),
    planId: PLAN_ID,
    reviewerThreadId: REVIEWER_THREAD_ID,
    status: "pending",
    summary: "Pending.",
    mergeOrder: [],
    requiredFixes: [],
    risks: [],
    testRecommendations: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makePlan(overrides: Partial<AgentPlan> = {}): AgentPlanDetailSnapshot {
  return {
    snapshotSequence: 1,
    plan: {
      id: PLAN_ID,
      title: "Reactor plan",
      userPrompt: "Coordinate work.",
      status: "running",
      projectIds: [PROJECT_ID],
      primaryProjectId: PROJECT_ID,
      ownerThreadId: OWNER_THREAD_ID,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      tasks: [makeTask()],
      sharedUpdates: [],
      contracts: [],
      coordinationMessages: [],
      reviews: [],
      ...overrides,
    },
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  const threadId = overrides.id ?? WORKER_A_THREAD_ID;
  return {
    id: threadId,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: DEFAULT_MODEL,
    },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: {
      threadId,
      status: "ready",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      activeTurnId: null,
      lastError: null,
      updatedAt: NOW,
    },
    ...overrides,
  };
}

function busyThread(id: ThreadId): OrchestrationThread {
  return makeThread({
    id,
    session: {
      threadId: id,
      status: "running",
      providerName: "codex",
      providerInstanceId: ProviderInstanceId.make("codex"),
      runtimeMode: "approval-required",
      activeTurnId: TurnId.make(`turn-${id}`),
      lastError: null,
      updatedAt: NOW,
    },
  });
}

function workerReport(
  status: "progress" | "blocked" | "done" | "failed",
  overrides: Record<string, unknown> = {},
) {
  return [
    "```t3-agent-worker-report",
    JSON.stringify({
      schema: "t3.agent.worker_report.v1",
      status,
      title: `${status} report`,
      summary: `${status} summary`,
      details: "details",
      requiresOwnerResponse: false,
      changedContracts: [],
      testResults: [],
      blockers: status === "blocked" ? ["blocked"] : [],
      nextSuggestedAction: null,
      ...overrides,
    }),
    "```",
  ].join("\n");
}

function ownerRouting(overrides: Record<string, unknown> = {}) {
  return [
    "```t3-agent-owner-routing",
    JSON.stringify({
      schema: "t3.agent.owner_routing.v1",
      summary: "route",
      routeMessages: [],
      taskUpdates: [],
      contractUpdates: [],
      askUser: null,
      readyForReview: false,
      ...overrides,
    }),
    "```",
  ].join("\n");
}

function reviewerOutput(status: "passed" | "warning" | "failed") {
  return [
    "```t3-agent-review",
    JSON.stringify({
      schema: "t3.agent.review.v1",
      status,
      summary: "review summary",
      mergeOrder: [TASK_A_ID],
      requiredFixes: status === "failed" ? ["fix"] : [],
      risks: ["risk"],
      testRecommendations: ["vp check"],
    }),
    "```",
  ].join("\n");
}

function messageEvent(input: {
  readonly threadId: ThreadId;
  readonly messageId?: MessageId;
  readonly role?: "user" | "assistant";
  readonly text: string;
  readonly streaming?: boolean;
}): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.make(`event-${input.messageId ?? "message"}`),
    aggregateKind: "thread",
    aggregateId: input.threadId,
    type: "thread.message-sent",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-message-event"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-message-event"),
    metadata: {},
    payload: {
      threadId: input.threadId,
      messageId: input.messageId ?? MessageId.make("message-a"),
      role: input.role ?? "assistant",
      text: input.text,
      attachments: [],
      turnId: TurnId.make("turn-a"),
      streaming: input.streaming ?? false,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function idleSessionEvent(threadId: ThreadId): OrchestrationEvent {
  return {
    sequence: 1,
    eventId: EventId.make(`event-idle-${threadId}`),
    aggregateKind: "thread",
    aggregateId: threadId,
    type: "thread.session-set",
    occurredAt: NOW,
    commandId: CommandId.make("cmd-session-event"),
    causationEventId: null,
    correlationId: CommandId.make("cmd-session-event"),
    metadata: {},
    payload: {
      threadId,
      session: {
        threadId,
        status: "ready",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "approval-required",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    },
  };
}

function makeProjection(input: {
  readonly getDetail: () => AgentPlanDetailSnapshot;
  readonly threads: Map<ThreadId, OrchestrationThread>;
}): ProjectionSnapshotQueryShape {
  const shell = (): OrchestrationShellSnapshot => {
    const plan = input.getDetail().plan;
    return {
      snapshotSequence: input.getDetail().snapshotSequence,
      projects: [],
      threads: [],
      agentPlans: [
        {
          id: plan.id,
          title: plan.title,
          status: plan.status,
          projectIds: plan.projectIds,
          primaryProjectId: plan.primaryProjectId,
          ownerThreadId: plan.ownerThreadId,
          workerThreadIds: plan.tasks.flatMap((task) =>
            task.workerThreadId !== null ? [task.workerThreadId] : [],
          ),
          taskCount: plan.tasks.length,
          runningTaskCount: plan.tasks.filter((task) => task.status === "running").length,
          blockedTaskCount: plan.tasks.filter((task) => task.status === "blocked").length,
          doneTaskCount: plan.tasks.filter((task) => task.status === "done").length,
          contractCount: plan.contracts.length,
          updateCount: plan.sharedUpdates.length,
          coordinationMessageCount: plan.coordinationMessages.length,
          reviewCount: plan.reviews.length,
          createdAt: plan.createdAt,
          updatedAt: plan.updatedAt,
        },
      ],
      updatedAt: NOW,
    };
  };
  return {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.succeed(shell()),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.succeed(Option.some(makeProject())),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: (threadId) =>
      Effect.succeed(
        input.threads.has(threadId) ? Option.some(input.threads.get(threadId)!) : Option.none(),
      ),
    getAgentPlanShellById: () => Effect.die("unused"),
    getAgentPlanDetailById: () => Effect.succeed(Option.some(input.getDetail())),
  };
}

function runWithHarness(
  input: {
    readonly detail?: AgentPlanDetailSnapshot;
    readonly threads?: ReadonlyArray<OrchestrationThread>;
    readonly failDispatch?: (command: OrchestrationCommand) => boolean;
  },
  test: (harness: {
    readonly publish: (event: OrchestrationEvent) => Effect.Effect<void>;
    readonly dispatchCalls: ReadonlyArray<OrchestrationCommand>;
    readonly plan: () => AgentPlan;
    readonly setPlan: (update: (plan: AgentPlan) => AgentPlan) => void;
    readonly threads: Map<ThreadId, OrchestrationThread>;
  }) => Effect.Effect<void, never, AgentCoordinationReactor>,
) {
  return Effect.gen(function* () {
    const events = yield* PubSub.unbounded<OrchestrationEvent>();
    let detail = input.detail ?? makePlan();
    const threads = new Map(
      (
        input.threads ?? [
          makeThread({ id: OWNER_THREAD_ID, interactionMode: "plan" }),
          makeThread({ id: WORKER_A_THREAD_ID }),
          makeThread({ id: WORKER_B_THREAD_ID }),
          makeThread({ id: REVIEWER_THREAD_ID, interactionMode: "plan" }),
        ]
      ).map((thread) => [thread.id, thread]),
    );
    const dispatchCalls: OrchestrationCommand[] = [];
    let nextSequence = 1;
    const updatePlan = (update: (plan: AgentPlan) => AgentPlan) => {
      detail = {
        ...detail,
        snapshotSequence: detail.snapshotSequence + 1,
        plan: update(detail.plan),
      };
    };
    const mutate = (command: OrchestrationCommand) => {
      switch (command.type) {
        case "agent-task.upsert":
          updatePlan((plan) => ({
            ...plan,
            tasks: [...plan.tasks.filter((task) => task.id !== command.task.id), command.task],
          }));
          break;
        case "agent-shared-update.append":
          updatePlan((plan) => ({
            ...plan,
            sharedUpdates: [...plan.sharedUpdates, command.update],
          }));
          break;
        case "agent-contract.upsert":
          updatePlan((plan) => ({
            ...plan,
            contracts: [
              ...plan.contracts.filter((contract) => contract.id !== command.contract.id),
              command.contract,
            ],
          }));
          break;
        case "agent-coordination-message.upsert":
          updatePlan((plan) => ({
            ...plan,
            coordinationMessages: [
              ...plan.coordinationMessages.filter((message) => message.id !== command.message.id),
              command.message,
            ],
          }));
          break;
        case "agent-review.upsert":
          updatePlan((plan) => ({
            ...plan,
            reviews: [
              ...plan.reviews.filter((review) => review.id !== command.review.id),
              command.review,
            ],
          }));
          break;
        case "agent-plan.status.set":
          updatePlan((plan) => ({ ...plan, status: command.status }));
          break;
        case "thread.create":
          threads.set(
            command.threadId,
            makeThread({ id: command.threadId, projectId: command.projectId }),
          );
          break;
        default:
          break;
      }
    };
    const engine: OrchestrationEngineShape = {
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Effect.gen(function* () {
          dispatchCalls.push(command);
          if (input.failDispatch?.(command) === true) {
            return yield* new OrchestrationCommandInvariantError({
              commandType: command.type,
              detail: "test dispatch failure",
            });
          }
          mutate(command);
          return { sequence: nextSequence++ };
        }),
      streamDomainEvents: Stream.fromPubSub(events),
    };
    const worktrees: WorktreeManager["Service"] = {
      createForAgentTask: (task) =>
        Effect.succeed({
          planId: task.planId,
          taskId: task.id,
          branchName: `agent/plan/${task.id}`,
          worktreePath: `/worktrees/${task.id}`,
        }),
      removeForAgentTask: () => Effect.void,
      createForWorker: (input) =>
        Effect.succeed({
          projectId: input.projectId,
          delegationId: input.delegationId,
          taskKey: input.taskKey,
          branchName: `worker/${input.taskKey}`,
          worktreePath: `/worktrees/${input.taskKey}`,
        }),
      removeForWorker: () => Effect.void,
    };
    const layer = AgentCoordinationReactorLive.pipe(
      Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
      Layer.provide(
        Layer.succeed(
          ProjectionSnapshotQuery,
          makeProjection({ getDetail: () => detail, threads }),
        ),
      ),
      Layer.provide(Layer.succeed(WorktreeManager, worktrees)),
      Layer.provideMerge(NodeServices.layer),
    );

    return yield* Effect.scoped(
      Effect.gen(function* () {
        const reactor = yield* AgentCoordinationReactor;
        yield* reactor.start();
        yield* Effect.yieldNow;
        const publish = (event: OrchestrationEvent) =>
          PubSub.publish(events, event).pipe(Effect.andThen(reactor.drain));
        return yield* test({
          publish,
          dispatchCalls,
          plan: () => detail.plan,
          setPlan: (update) => updatePlan(update),
          threads,
        });
      }).pipe(Effect.provide(layer)),
    );
  });
}

describe("AgentCoordinationReactor", () => {
  it.effect("ignores streaming assistant messages and user messages", () =>
    runWithHarness({}, ({ publish, dispatchCalls }) =>
      Effect.gen(function* () {
        yield* publish(
          messageEvent({
            threadId: WORKER_A_THREAD_ID,
            text: workerReport("progress"),
            streaming: true,
          }),
        );
        yield* publish(
          messageEvent({
            threadId: WORKER_A_THREAD_ID,
            role: "user",
            text: workerReport("progress"),
          }),
        );
        assert.deepStrictEqual(dispatchCalls, []);
      }),
    ),
  );

  it.effect("dedupes duplicate worker report processing", () =>
    runWithHarness(
      {
        detail: makePlan({
          coordinationMessages: [
            makeCoordinationMessage({
              dedupeKey: `worker-report:${PLAN_ID}:${TASK_A_ID}:message-a`,
              status: "acknowledged",
            }),
          ],
        }),
      },
      ({ publish, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-a"),
              text: workerReport("progress"),
            }),
          );
          assert.deepStrictEqual(dispatchCalls, []);
        }),
    ),
  );

  it.effect("processes worker progress, blocker, done, and contract update reports", () =>
    runWithHarness(
      {
        detail: makePlan({
          tasks: [
            makeTask({ id: TASK_A_ID, status: "running", workerThreadId: WORKER_A_THREAD_ID }),
            makeTask({
              id: TASK_B_ID,
              title: "Task B",
              status: "pending",
              workerThreadId: null,
              dependsOn: [TASK_A_ID],
            }),
          ],
          contracts: [makeContract()],
        }),
      },
      ({ publish, plan, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-progress"),
              text: workerReport("progress"),
            }),
          );
          assert.equal(plan().tasks.find((task) => task.id === TASK_A_ID)?.status, "running");
          assert.equal(plan().sharedUpdates.at(-1)?.type, "progress");

          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-blocked"),
              text: workerReport("blocked"),
            }),
          );
          assert.equal(plan().tasks.find((task) => task.id === TASK_A_ID)?.status, "blocked");

          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-contract"),
              text: workerReport("progress", {
                changedContracts: [
                  {
                    contractId: "agent-contract:agent-plan-reactor:api",
                    description: "Changed API.",
                    status: "changed",
                  },
                ],
              }),
            }),
          );
          assert.equal(
            plan().contracts.find((contract) => contract.id === makeContract().id)?.version,
            2,
          );

          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-done"),
              text: workerReport("done"),
            }),
          );
          assert.equal(plan().tasks.find((task) => task.id === TASK_A_ID)?.status, "done");
          assert.equal(
            dispatchCalls.some(
              (command) => command.type === "thread.create" && command.title === "Worker: Task B",
            ),
            true,
          );
        }),
    ),
  );

  it.effect("queues owner notification when a worker blocker arrives while owner is busy", () =>
    runWithHarness(
      {
        threads: [busyThread(OWNER_THREAD_ID), makeThread({ id: WORKER_A_THREAD_ID })],
      },
      ({ publish, plan }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({ threadId: WORKER_A_THREAD_ID, text: workerReport("blocked") }),
          );
          const ownerMessage = plan().coordinationMessages.find(
            (message) => message.toTarget === "owner" && message.status === "queued",
          );
          assert.equal(ownerMessage?.status, "queued");
        }),
    ),
  );

  it.effect("records failed coordination and risk update on worker parse failure", () =>
    runWithHarness({}, ({ publish, plan }) =>
      Effect.gen(function* () {
        yield* publish(messageEvent({ threadId: WORKER_A_THREAD_ID, text: "not json" }));
        assert.equal(plan().coordinationMessages.at(-1)?.status, "failed");
        assert.equal(plan().sharedUpdates.at(-1)?.type, "risk");
      }),
    ),
  );

  it.effect("routes owner messages to idle workers and queues them for busy workers", () =>
    runWithHarness(
      {
        threads: [
          makeThread({ id: OWNER_THREAD_ID }),
          busyThread(WORKER_A_THREAD_ID),
          makeThread({ id: WORKER_B_THREAD_ID }),
        ],
      },
      ({ publish, plan, setPlan, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({
              threadId: OWNER_THREAD_ID,
              messageId: MessageId.make("message-owner-busy"),
              text: ownerRouting({
                routeMessages: [
                  {
                    targetTaskIds: [TASK_A_ID],
                    targetTaskKeys: [],
                    kind: "sync",
                    title: "Sync",
                    body: "Sync body.",
                    requiresResponse: true,
                  },
                ],
              }),
            }),
          );
          assert.equal(plan().coordinationMessages.at(-1)?.status, "queued");
          assert.equal(
            dispatchCalls.some((command) => command.type === "thread.turn.start"),
            false,
          );

          setPlan((current) => ({
            ...current,
            tasks: current.tasks.map((task) =>
              task.id === TASK_A_ID ? { ...task, workerThreadId: WORKER_B_THREAD_ID } : task,
            ),
          }));
          yield* publish(
            messageEvent({
              threadId: OWNER_THREAD_ID,
              messageId: MessageId.make("message-owner-idle"),
              text: ownerRouting({
                routeMessages: [
                  {
                    targetTaskIds: [TASK_A_ID],
                    targetTaskKeys: [],
                    kind: "sync",
                    title: "Sync idle",
                    body: "Sync idle body.",
                    requiresResponse: true,
                  },
                ],
              }),
            }),
          );
          assert.equal(plan().coordinationMessages.at(-1)?.status, "sent");
          assert.equal(
            dispatchCalls.some(
              (command) =>
                command.type === "thread.turn.start" && command.threadId === WORKER_B_THREAD_ID,
            ),
            true,
          );
        }),
    ),
  );

  it.effect(
    "appends blocker updates for owner ask-user and starts review only when tasks are terminal",
    () =>
      runWithHarness(
        { detail: makePlan({ tasks: [makeTask({ status: "done" })] }) },
        ({ publish, plan, dispatchCalls }) =>
          Effect.gen(function* () {
            yield* publish(
              messageEvent({
                threadId: OWNER_THREAD_ID,
                text: ownerRouting({ askUser: "Need input.", readyForReview: true }),
              }),
            );
            assert.equal(plan().sharedUpdates.at(-1)?.type, "blocker");
            assert.equal(plan().status, "reviewing");
            assert.equal(
              dispatchCalls.some((command) => command.type === "agent-review.upsert"),
              true,
            );
          }),
      ),
  );

  it.effect("updates review result and sets plan completed or failed", () =>
    runWithHarness(
      { detail: makePlan({ status: "reviewing", reviews: [makeReview()] }) },
      ({ publish, plan }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({ threadId: REVIEWER_THREAD_ID, text: reviewerOutput("failed") }),
          );
          assert.equal(plan().reviews[0]?.status, "failed");
          assert.equal(plan().status, "failed");
        }),
    ),
  );

  it.effect("stops autonomous routing at depth limit and records user-needed blocker", () =>
    runWithHarness(
      {
        detail: makePlan({
          coordinationMessages: [
            makeCoordinationMessage({ correlationId: "message-a" }),
            makeCoordinationMessage({
              id: AgentCoordinationMessageId.make("coordination-b"),
              dedupeKey: "b",
              correlationId: "message-a",
            }),
            makeCoordinationMessage({
              id: AgentCoordinationMessageId.make("coordination-c"),
              dedupeKey: "c",
              correlationId: "message-a",
            }),
          ],
        }),
      },
      ({ publish, plan, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(
            messageEvent({
              threadId: WORKER_A_THREAD_ID,
              messageId: MessageId.make("message-a"),
              text: workerReport("blocked", { requiresOwnerResponse: true }),
            }),
          );
          assert.equal(plan().sharedUpdates.at(-1)?.title, "Autonomous routing paused");
          assert.equal(
            dispatchCalls.some(
              (command) =>
                command.type === "thread.turn.start" && command.threadId === OWNER_THREAD_ID,
            ),
            false,
          );
        }),
    ),
  );

  it.effect("flushes queued worker messages after worker thread becomes idle", () =>
    runWithHarness(
      {
        detail: makePlan({
          tasks: [makeTask({ workerThreadId: WORKER_A_THREAD_ID })],
          coordinationMessages: [makeCoordinationMessage()],
        }),
      },
      ({ publish, plan, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(idleSessionEvent(WORKER_A_THREAD_ID));
          assert.equal(plan().coordinationMessages[0]?.status, "sent");
          assert.equal(
            dispatchCalls.some(
              (command) =>
                command.type === "thread.turn.start" && command.threadId === WORKER_A_THREAD_ID,
            ),
            true,
          );
        }),
    ),
  );

  it.effect("flushes queued owner messages after owner thread becomes idle", () =>
    runWithHarness(
      {
        detail: makePlan({
          tasks: [makeTask({ workerThreadId: WORKER_A_THREAD_ID })],
          coordinationMessages: [
            makeCoordinationMessage({
              toTarget: "owner",
              fromTaskId: TASK_A_ID,
              fromThreadId: WORKER_A_THREAD_ID,
              toTaskIds: [],
              toThreadIds: [OWNER_THREAD_ID],
            }),
          ],
        }),
      },
      ({ publish, plan, dispatchCalls }) =>
        Effect.gen(function* () {
          yield* publish(idleSessionEvent(OWNER_THREAD_ID));
          assert.equal(plan().coordinationMessages[0]?.status, "sent");
          assert.equal(
            dispatchCalls.some(
              (command) =>
                command.type === "thread.turn.start" && command.threadId === OWNER_THREAD_ID,
            ),
            true,
          );
        }),
    ),
  );
});
