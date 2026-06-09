import {
  AgentCoordinationMessageId,
  AgentPlanId,
  AgentTaskId,
  DEFAULT_MODEL,
  MessageId,
  ModelSelection,
  OrchestrationDispatchCommandError,
  TurnId,
  type AgentPlanDetailSnapshot,
  type AgentCoordinationMessage,
  type AgentTask,
  type OrchestrationCommand,
  type OrchestrationMessage,
  type OrchestrationProjectShell,
  type OrchestrationThread,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { OrchestrationCommandInvariantError } from "../../orchestration/Errors.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "../../orchestration/Services/OrchestrationEngine.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  ServerRuntimeStartup,
  type ServerRuntimeStartupShape,
} from "../../serverRuntimeStartup.ts";
import { AgentPlanServiceLive } from "./AgentPlanService.ts";
import { AgentPlanService } from "../Services/AgentPlanService.ts";
import { WorktreeManager } from "../../worktrees/Services/WorktreeManager.ts";

const PLAN_ID = AgentPlanId.make("agent-plan-owner");
const PROJECT_ID = ProjectId.make("project-owner");
const NOW = "2026-06-09T00:00:00.000Z";
const TASK_A_ID = AgentTaskId.make("agent-task:agent-plan-owner:task-a");
const TASK_B_ID = AgentTaskId.make("agent-task:agent-plan-owner:task-b");
const OWNER_THREAD_ID = ThreadId.make("thread-owner");
const WORKER_THREAD_ID = ThreadId.make("thread-worker-a");

type CommandOf<TType extends OrchestrationCommand["type"]> = Extract<
  OrchestrationCommand,
  { readonly type: TType }
>;

function expectCommand<TType extends OrchestrationCommand["type"]>(
  commands: ReadonlyArray<OrchestrationCommand>,
  index: number,
  type: TType,
): CommandOf<TType> {
  const command = commands[index];
  assert.equal(command?.type, type);
  if (!command || command.type !== type) {
    assert.fail(`Expected command ${index} to be ${type}.`);
  }
  return command as CommandOf<TType>;
}

function makePlan(
  overrides: Partial<AgentPlanDetailSnapshot["plan"]> = {},
): AgentPlanDetailSnapshot {
  return {
    snapshotSequence: 1,
    plan: {
      id: PLAN_ID,
      title: "Owner plan",
      userPrompt: "Coordinate backend and frontend archive work.",
      status: "draft",
      projectIds: [PROJECT_ID],
      primaryProjectId: PROJECT_ID,
      ownerThreadId: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
      tasks: [],
      sharedUpdates: [],
      contracts: [],
      coordinationMessages: [],
      reviews: [],
      ...overrides,
    },
  };
}

function makeProject(
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Owner Project",
    workspaceRoot: "C:/repo/owner",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: TASK_A_ID,
    planId: PLAN_ID,
    title: "Task A",
    description: "Implement task A.",
    status: "pending",
    projectId: PROJECT_ID,
    workerThreadId: null,
    worktreePath: null,
    branchName: null,
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

function makeCoordinationMessage(
  overrides: Partial<AgentCoordinationMessage> = {},
): AgentCoordinationMessage {
  return {
    id: AgentCoordinationMessageId.make("coordination-message-a"),
    planId: PLAN_ID,
    dedupeKey: "coordination-message-a",
    kind: "sync",
    status: "queued",
    fromRole: "owner",
    fromTaskId: null,
    fromThreadId: OWNER_THREAD_ID,
    toTarget: "worker",
    toTaskIds: [TASK_A_ID],
    toThreadIds: [WORKER_THREAD_ID],
    sourceMessageId: null,
    sourceTurnId: null,
    correlationId: null,
    title: "Queued update",
    body: "Please sync.",
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

function makeAssistantMessage(overrides: Partial<OrchestrationMessage> = {}): OrchestrationMessage {
  return {
    id: MessageId.make("message-owner-json"),
    role: "assistant",
    text: "{}",
    attachments: [],
    turnId: TurnId.make("turn-owner-json"),
    streaming: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeThread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  const modelSelection: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: DEFAULT_MODEL,
  };
  const threadId = overrides.id ?? OWNER_THREAD_ID;
  return {
    id: threadId,
    projectId: PROJECT_ID,
    title: "Owner thread",
    modelSelection,
    runtimeMode: "approval-required",
    interactionMode: "plan",
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

function ownerPlanJson(
  overrides: {
    readonly tasks?: ReadonlyArray<Record<string, unknown>>;
    readonly contracts?: ReadonlyArray<Record<string, unknown>>;
  } = {},
): string {
  return JSON.stringify({
    schema: "t3.agent.owner_plan.v1",
    title: "Imported plan",
    summary: "Imported summary.",
    tasks: overrides.tasks ?? [
      {
        taskKey: "task-a",
        title: "Task A",
        description: "Implement task A.",
        projectId: PROJECT_ID,
        allowedPaths: ["src/a"],
        blockedPaths: [],
        dependsOn: [],
        relatedTasks: ["task-b"],
        requiredContracts: [],
        producedContracts: ["api"],
        riskNotes: "Risk A",
      },
      {
        taskKey: "task-b",
        title: "Task B",
        description: "Implement task B.",
        projectId: PROJECT_ID,
        allowedPaths: ["src/b"],
        blockedPaths: [],
        dependsOn: ["task-a"],
        relatedTasks: [],
        requiredContracts: ["api"],
        producedContracts: [],
        riskNotes: "",
      },
    ],
    contracts: overrides.contracts ?? [
      {
        contractKey: "api",
        type: "api",
        title: "API contract",
        description: "Shared API contract.",
        producerTaskKey: "task-a",
        consumerTaskKeys: ["task-b"],
      },
    ],
    reviewPlan: {
      mergeOrder: ["task-a", "task-b"],
      requiredChecks: ["vp check"],
      risks: [],
    },
    openQuestions: [],
  });
}

function makeProjectionQuery(input: {
  readonly getDetail: () => Option.Option<AgentPlanDetailSnapshot>;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
  readonly threads?: Map<ThreadId, OrchestrationThread>;
}): ProjectionSnapshotQueryShape {
  const projects = new Map(
    (input.projects ?? [makeProject()]).map((project) => [project.id, project]),
  );
  const threads = input.threads ?? new Map<ThreadId, OrchestrationThread>();
  return {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: (projectId) =>
      Effect.succeed(
        projects.has(projectId) ? Option.some(projects.get(projectId)!) : Option.none(),
      ),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: (threadId) =>
      Effect.succeed(threads.has(threadId) ? Option.some(threads.get(threadId)!) : Option.none()),
    getAgentPlanShellById: () => Effect.die("unused"),
    getAgentPlanDetailById: () => Effect.succeed(input.getDetail()),
  };
}

function makeHarness(
  input: {
    readonly detail?: Option.Option<AgentPlanDetailSnapshot>;
    readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
    readonly threads?: ReadonlyArray<OrchestrationThread>;
    readonly worktrees?: Partial<WorktreeManager["Service"]>;
    readonly failDispatch?: (command: OrchestrationCommand) => boolean;
  } = {},
) {
  const dispatchCalls: OrchestrationCommand[] = [];
  let detail = input.detail ?? Option.some(makePlan());
  const threads = new Map((input.threads ?? []).map((thread) => [thread.id, thread]));
  let nextSequence = 1;
  const updatePlan = (
    update: (plan: AgentPlanDetailSnapshot["plan"]) => AgentPlanDetailSnapshot["plan"],
  ) => {
    if (Option.isNone(detail)) return;
    detail = Option.some({
      ...detail.value,
      snapshotSequence: detail.value.snapshotSequence + 1,
      plan: update(detail.value.plan),
    });
  };
  const mutateForCommand = (command: OrchestrationCommand) => {
    switch (command.type) {
      case "agent-plan.update":
        updatePlan((plan) => ({
          ...plan,
          ...(command.ownerThreadId !== undefined ? { ownerThreadId: command.ownerThreadId } : {}),
          updatedAt: NOW,
        }));
        break;
      case "agent-plan.status.set":
        updatePlan((plan) => ({ ...plan, status: command.status, updatedAt: NOW }));
        break;
      case "agent-task.upsert":
        updatePlan((plan) => ({
          ...plan,
          tasks: [...plan.tasks.filter((task) => task.id !== command.task.id), command.task],
          updatedAt: NOW,
        }));
        break;
      case "agent-contract.upsert":
        updatePlan((plan) => ({
          ...plan,
          contracts: [
            ...plan.contracts.filter((contract) => contract.id !== command.contract.id),
            command.contract,
          ],
          updatedAt: NOW,
        }));
        break;
      case "agent-shared-update.append":
        updatePlan((plan) => ({
          ...plan,
          sharedUpdates: [...plan.sharedUpdates, command.update],
          updatedAt: NOW,
        }));
        break;
      case "agent-coordination-message.upsert":
        updatePlan((plan) => ({
          ...plan,
          coordinationMessages: [
            ...plan.coordinationMessages.filter((message) => message.id !== command.message.id),
            command.message,
          ],
          updatedAt: NOW,
        }));
        break;
      case "agent-review.upsert":
        updatePlan((plan) => ({
          ...plan,
          reviews: [
            ...plan.reviews.filter((review) => review.id !== command.review.id),
            command.review,
          ],
          updatedAt: NOW,
        }));
        break;
      case "thread.create":
        threads.set(
          command.threadId,
          makeThread({
            id: command.threadId,
            projectId: command.projectId,
            title: command.title,
            modelSelection: command.modelSelection,
            runtimeMode: command.runtimeMode,
            interactionMode: command.interactionMode,
            branch: command.branch,
            worktreePath: command.worktreePath,
            session: {
              threadId: command.threadId,
              status: "ready",
              providerName: String(command.modelSelection.instanceId),
              providerInstanceId: command.modelSelection.instanceId,
              runtimeMode: command.runtimeMode,
              activeTurnId: null,
              lastError: null,
              updatedAt: NOW,
            },
          }),
        );
        break;
      case "thread.delete":
        threads.delete(command.threadId);
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
        mutateForCommand(command);
        const sequence = nextSequence;
        nextSequence += 1;
        return { sequence };
      }),
    streamDomainEvents: Stream.empty,
  };
  const startup: ServerRuntimeStartupShape = {
    awaitCommandReady: Effect.void,
    markHttpListening: Effect.void,
    enqueueCommand: (effect) => effect,
  };
  const worktrees: WorktreeManager["Service"] = {
    createForAgentTask:
      input.worktrees?.createForAgentTask ??
      (() => Effect.die("createForAgentTask should not be called in this test")),
    removeForAgentTask:
      input.worktrees?.removeForAgentTask ??
      (() => Effect.die("removeForAgentTask should not be called in this test")),
  };
  const layer = AgentPlanServiceLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provide(
      Layer.succeed(
        ProjectionSnapshotQuery,
        makeProjectionQuery({
          getDetail: () => detail,
          threads,
          ...(input.projects !== undefined ? { projects: input.projects } : {}),
        }),
      ),
    ),
    Layer.provide(Layer.succeed(ServerRuntimeStartup, startup)),
    Layer.provide(Layer.succeed(WorktreeManager, worktrees)),
    Layer.provideMerge(NodeServices.layer),
  );
  return {
    dispatchCalls,
    threads,
    get plan() {
      return Option.isSome(detail) ? detail.value.plan : null;
    },
    layer,
  };
}

describe("AgentPlanService", () => {
  it.effect("starts owner planning with explicit thread creation and prompt turn", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const result = yield* service.startOwnerPlanning({ planId: PLAN_ID });

      assert.deepStrictEqual(
        harness.dispatchCalls.map((command) => command.type),
        ["thread.create", "agent-plan.update", "agent-plan.status.set", "thread.turn.start"],
      );
      const threadCreate = expectCommand(harness.dispatchCalls, 0, "thread.create");
      const planUpdate = expectCommand(harness.dispatchCalls, 1, "agent-plan.update");
      const statusSet = expectCommand(harness.dispatchCalls, 2, "agent-plan.status.set");
      const turnStart = expectCommand(harness.dispatchCalls, 3, "thread.turn.start");

      assert.equal(result.planId, PLAN_ID);
      assert.equal(result.ownerThreadId, threadCreate.threadId);
      assert.equal(planUpdate.ownerThreadId, threadCreate.threadId);
      assert.equal(statusSet.status, "planning");
      assert.equal(threadCreate.runtimeMode, "approval-required");
      assert.equal(threadCreate.interactionMode, "plan");
      assert.equal(turnStart.bootstrap, undefined);
      assert.equal(turnStart.threadId, threadCreate.threadId);
      assert.equal(turnStart.runtimeMode, "approval-required");
      assert.equal(turnStart.interactionMode, "plan");
      assert.match(turnStart.message.text, /Coordinate backend and frontend archive work/);
      assert.match(turnStart.message.text, /Owner Project/);
      assert.equal(result.sequence, 4);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("uses model selection input over project defaults", () => {
    const projectDefault = {
      instanceId: ProviderInstanceId.make("project-provider"),
      model: "project-model",
    };
    const override = {
      instanceId: ProviderInstanceId.make("override-provider"),
      model: "override-model",
    };
    const harness = makeHarness({
      projects: [makeProject({ defaultModelSelection: projectDefault })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.startOwnerPlanning({ planId: PLAN_ID, modelSelection: override });

      const threadCreate = expectCommand(harness.dispatchCalls, 0, "thread.create");
      assert.deepStrictEqual(threadCreate.modelSelection, override);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("uses the primary project default model when no override is provided", () => {
    const projectDefault = {
      instanceId: ProviderInstanceId.make("project-provider"),
      model: "project-model",
    };
    const harness = makeHarness({
      projects: [makeProject({ defaultModelSelection: projectDefault })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.startOwnerPlanning({ planId: PLAN_ID });

      const threadCreate = expectCommand(harness.dispatchCalls, 0, "thread.create");
      assert.deepStrictEqual(threadCreate.modelSelection, projectDefault);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("falls back to the default Codex model when no model is configured", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.startOwnerPlanning({ planId: PLAN_ID });

      const threadCreate = expectCommand(harness.dispatchCalls, 0, "thread.create");
      assert.deepStrictEqual(threadCreate.modelSelection, {
        instanceId: ProviderInstanceId.make("codex"),
        model: DEFAULT_MODEL,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("fails without dispatching when the plan is missing", () => {
    const harness = makeHarness({ detail: Option.none() });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("fails without dispatching when the plan already has an active owner thread", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "planning",
          ownerThreadId: ThreadId.make("thread-owner-active"),
        }),
      ),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("fails without dispatching when a referenced project is missing", () => {
    const harness = makeHarness({ projects: [] });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("deletes the owner thread when plan link update fails", () => {
    const harness = makeHarness({
      failDispatch: (command) =>
        command.type === "agent-plan.update" && command.ownerThreadId !== null,
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(
        harness.dispatchCalls.map((command) => command.type),
        ["thread.create", "agent-plan.update", "thread.delete"],
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("clears the owner thread and deletes the thread when planning status fails", () => {
    const harness = makeHarness({
      failDispatch: (command) =>
        command.type === "agent-plan.status.set" && command.status === "planning",
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(
        harness.dispatchCalls.map((command) => command.type),
        [
          "thread.create",
          "agent-plan.update",
          "agent-plan.status.set",
          "agent-plan.update",
          "thread.delete",
        ],
      );
      const clearUpdate = expectCommand(harness.dispatchCalls, 3, "agent-plan.update");
      assert.equal(clearUpdate.ownerThreadId, null);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect(
    "marks failed, clears the owner thread, and deletes the thread when turn start fails",
    () => {
      const harness = makeHarness({
        failDispatch: (command) => command.type === "thread.turn.start",
      });

      return Effect.gen(function* () {
        const service = yield* AgentPlanService;
        const error = yield* service.startOwnerPlanning({ planId: PLAN_ID }).pipe(Effect.flip);

        assert.instanceOf(error, OrchestrationDispatchCommandError);
        assert.deepStrictEqual(
          harness.dispatchCalls.map((command) => command.type),
          [
            "thread.create",
            "agent-plan.update",
            "agent-plan.status.set",
            "thread.turn.start",
            "agent-plan.status.set",
            "agent-plan.update",
            "thread.delete",
          ],
        );
        const failedStatus = expectCommand(harness.dispatchCalls, 4, "agent-plan.status.set");
        const clearUpdate = expectCommand(harness.dispatchCalls, 5, "agent-plan.update");
        assert.equal(failedStatus.status, "failed");
        assert.equal(clearUpdate.ownerThreadId, null);
      }).pipe(Effect.provide(harness.layer));
    },
  );

  it.effect("imports provided owner JSON into pending tasks and proposed contracts", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const result = yield* service.importOwnerPlanOutput({
        planId: PLAN_ID,
        jsonText: ownerPlanJson(),
      });

      assert.equal(result.taskCount, 2);
      assert.equal(result.contractCount, 1);
      assert.equal(harness.plan?.status, "awaiting_approval");
      assert.equal(harness.plan?.tasks.length, 2);
      assert.equal(harness.plan?.contracts.length, 1);
      assert.equal(harness.plan?.contracts[0]?.status, "proposed");
      assert.equal(
        harness.plan?.coordinationMessages.some((message) => message.kind === "owner_plan_import"),
        true,
      );
      assert.match(
        harness.plan?.sharedUpdates.at(-1)?.body ?? "",
        /Imported 2 tasks and 1 contracts/,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("imports the latest completed owner assistant message when JSON is omitted", () => {
    const olderMessage = makeAssistantMessage({
      id: MessageId.make("message-older"),
      text: ownerPlanJson({ tasks: [] }),
      updatedAt: "2026-06-08T00:00:00.000Z",
    });
    const latestMessage = makeAssistantMessage({
      id: MessageId.make("message-latest"),
      text: ownerPlanJson(),
      updatedAt: "2026-06-09T01:00:00.000Z",
    });
    const harness = makeHarness({
      detail: Option.some(makePlan({ ownerThreadId: OWNER_THREAD_ID })),
      threads: [makeThread({ id: OWNER_THREAD_ID, messages: [olderMessage, latestMessage] })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const result = yield* service.importOwnerPlanOutput({ planId: PLAN_ID });

      assert.equal(result.taskCount, 2);
      assert.equal(
        harness.plan?.coordinationMessages.at(-1)?.sourceMessageId,
        MessageId.make("message-latest"),
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects owner import while running, reviewing, or completed", () =>
    Effect.gen(function* () {
      for (const status of ["running", "reviewing", "completed"] as const) {
        const harness = makeHarness({ detail: Option.some(makePlan({ status })) });
        const error = yield* Effect.gen(function* () {
          const service = yield* AgentPlanService;
          return yield* service.importOwnerPlanOutput({
            planId: PLAN_ID,
            jsonText: ownerPlanJson(),
          });
        }).pipe(Effect.provide(harness.layer), Effect.flip);

        assert.instanceOf(error, OrchestrationDispatchCommandError);
        assert.deepStrictEqual(harness.dispatchCalls, []);
      }
    }),
  );

  it.effect("rejects owner import after any task has a worker thread", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          tasks: [makeTask({ workerThreadId: WORKER_THREAD_ID })],
        }),
      ),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service
        .importOwnerPlanOutput({ planId: PLAN_ID, jsonText: ownerPlanJson(), replaceDraft: true })
        .pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects invalid dependency references in owner output", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service
        .importOwnerPlanOutput({
          planId: PLAN_ID,
          jsonText: ownerPlanJson({
            tasks: [
              {
                taskKey: "task-a",
                title: "Task A",
                description: "Task A.",
                projectId: PROJECT_ID,
                allowedPaths: [],
                blockedPaths: [],
                dependsOn: ["missing-task"],
                relatedTasks: [],
                requiredContracts: [],
                producedContracts: [],
                riskNotes: "",
              },
            ],
            contracts: [],
          }),
        })
        .pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.match(error.message, /unknown dependency/);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects invalid contract producer and consumer task references", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const producerError = yield* service
        .importOwnerPlanOutput({
          planId: PLAN_ID,
          jsonText: ownerPlanJson({
            tasks: [
              {
                taskKey: "task-a",
                title: "Task A",
                description: "Task A.",
                projectId: PROJECT_ID,
                allowedPaths: [],
                blockedPaths: [],
                dependsOn: [],
                relatedTasks: [],
                requiredContracts: [],
                producedContracts: ["api"],
                riskNotes: "",
              },
            ],
            contracts: [
              {
                contractKey: "api",
                type: "api",
                title: "API",
                description: "API.",
                producerTaskKey: "missing-producer",
                consumerTaskKeys: [],
              },
            ],
          }),
        })
        .pipe(Effect.flip);

      const consumerError = yield* service
        .importOwnerPlanOutput({
          planId: PLAN_ID,
          jsonText: ownerPlanJson({
            tasks: [
              {
                taskKey: "task-a",
                title: "Task A",
                description: "Task A.",
                projectId: PROJECT_ID,
                allowedPaths: [],
                blockedPaths: [],
                dependsOn: [],
                relatedTasks: [],
                requiredContracts: [],
                producedContracts: ["api"],
                riskNotes: "",
              },
            ],
            contracts: [
              {
                contractKey: "api",
                type: "api",
                title: "API",
                description: "API.",
                producerTaskKey: "task-a",
                consumerTaskKeys: ["missing-consumer"],
              },
            ],
          }),
        })
        .pipe(Effect.flip);

      assert.match(producerError.message, /unknown producer/);
      assert.match(consumerError.message, /unknown consumer/);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("requires replaceDraft when draft tasks already exist", () => {
    const harness = makeHarness({
      detail: Option.some(makePlan({ tasks: [makeTask()] })),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service
        .importOwnerPlanOutput({ planId: PLAN_ID, jsonText: ownerPlanJson() })
        .pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("cancels omitted unlaunched draft tasks when replaceDraft is true", () => {
    const omittedTask = makeTask({ id: AgentTaskId.make("agent-task:agent-plan-owner:omitted") });
    const harness = makeHarness({
      detail: Option.some(makePlan({ tasks: [omittedTask] })),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.importOwnerPlanOutput({
        planId: PLAN_ID,
        jsonText: ownerPlanJson(),
        replaceDraft: true,
      });

      assert.equal(
        harness.plan?.tasks.find((task) => task.id === omittedTask.id)?.status,
        "cancelled",
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("checks selected task path overlaps and respects allowPathOverlaps", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "awaiting_approval",
          tasks: [
            makeTask({ id: TASK_A_ID, title: "A", allowedPaths: ["src"] }),
            makeTask({ id: TASK_B_ID, title: "B", allowedPaths: ["src/a"] }),
          ],
        }),
      ),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service
        .approveAgentPlanTasks({ planId: PLAN_ID, launch: false })
        .pipe(Effect.flip);
      const allowed = yield* service.approveAgentPlanTasks({
        planId: PLAN_ID,
        launch: false,
        allowPathOverlaps: true,
      });

      assert.match(error.message, /overlapping allowed paths/);
      assert.deepStrictEqual(allowed.skippedTaskIds.toSorted(), [TASK_A_ID, TASK_B_ID].toSorted());
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("treats empty allowedPaths as wildcard overlap", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "awaiting_approval",
          tasks: [
            makeTask({ id: TASK_A_ID, allowedPaths: [] }),
            makeTask({ id: TASK_B_ID, allowedPaths: ["src/b"] }),
          ],
        }),
      ),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service
        .approveAgentPlanTasks({ planId: PLAN_ID, launch: false })
        .pipe(Effect.flip);

      assert.match(error.message, /overlapping allowed paths/);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("approves selected tasks and calls launch flow when requested", () => {
    const worktreeEvents: string[] = [];
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "awaiting_approval",
          tasks: [
            makeTask({ id: TASK_A_ID, allowedPaths: ["src/a"] }),
            makeTask({ id: TASK_B_ID, allowedPaths: ["src/b"] }),
          ],
        }),
      ),
      worktrees: {
        createForAgentTask: (task) =>
          Effect.sync(() => {
            worktreeEvents.push(`create:${task.id}`);
            return {
              planId: task.planId,
              taskId: task.id,
              branchName: `agent/test/${task.id}`,
              worktreePath: `C:/worktrees/${task.id}`,
            };
          }),
        removeForAgentTask: () => Effect.void,
      },
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const result = yield* service.approveAgentPlanTasks({
        planId: PLAN_ID,
        taskIds: [TASK_A_ID],
        launch: true,
      });

      assert.deepStrictEqual(result.launchedTaskIds, [TASK_A_ID]);
      assert.deepStrictEqual(worktreeEvents, [`create:${TASK_A_ID}`]);
      assert.equal(
        harness.dispatchCalls.some((command) => command.type === "thread.turn.start"),
        true,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("launches only pending tasks whose dependencies are done", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "awaiting_approval",
          tasks: [
            makeTask({ id: TASK_A_ID, status: "done" }),
            makeTask({ id: TASK_B_ID, title: "Task B", dependsOn: [TASK_A_ID] }),
            makeTask({
              id: AgentTaskId.make("agent-task:agent-plan-owner:blocked-by-b"),
              title: "Task C",
              dependsOn: [TASK_B_ID],
            }),
          ],
        }),
      ),
      projects: [
        makeProject({
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("project-provider"),
            model: "project-model",
          },
        }),
      ],
      worktrees: {
        createForAgentTask: (task) =>
          Effect.succeed({
            planId: task.planId,
            taskId: task.id,
            branchName: "agent/plan/task-b",
            worktreePath: "C:/worktrees/task-b",
          }),
        removeForAgentTask: () => Effect.void,
      },
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const result = yield* service.launchReadyWorkers({ planId: PLAN_ID });

      assert.deepStrictEqual(result.launchedTaskIds, [TASK_B_ID]);
      assert.equal(harness.plan?.status, "running");
      const task = harness.plan?.tasks.find((candidate) => candidate.id === TASK_B_ID);
      assert.equal(task?.status, "running");
      assert.equal(task?.worktreePath, "C:/worktrees/task-b");
      assert.equal(task?.branchName, "agent/plan/task-b");
      assert.equal(task?.workerThreadId !== null, true);
      assert.equal(harness.plan?.coordinationMessages.at(-1)?.kind, "assignment");
      const turnStart = harness.dispatchCalls.find(
        (command): command is CommandOf<"thread.turn.start"> =>
          command.type === "thread.turn.start",
      );
      assert.match(turnStart?.message.text ?? "", /Task B/);
      assert.deepStrictEqual(turnStart?.modelSelection, {
        instanceId: ProviderInstanceId.make("project-provider"),
        model: "project-model",
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("uses launch model override before project default and Codex default", () => {
    const override = {
      instanceId: ProviderInstanceId.make("override-provider"),
      model: "override-model",
    };
    const harness = makeHarness({
      detail: Option.some(makePlan({ status: "awaiting_approval", tasks: [makeTask()] })),
      projects: [
        makeProject({
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("project-provider"),
            model: "project-model",
          },
        }),
      ],
      worktrees: {
        createForAgentTask: (task) =>
          Effect.succeed({
            planId: task.planId,
            taskId: task.id,
            branchName: "agent/plan/task-a",
            worktreePath: "C:/worktrees/task-a",
          }),
        removeForAgentTask: () => Effect.void,
      },
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.launchReadyWorkers({ planId: PLAN_ID, modelSelection: override });

      const threadCreate = expectCommand(harness.dispatchCalls, 0, "thread.create");
      assert.deepStrictEqual(threadCreate.modelSelection, override);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("cleans up a worktree when worker thread creation fails", () => {
    const removed: AgentTaskId[] = [];
    const harness = makeHarness({
      detail: Option.some(makePlan({ status: "awaiting_approval", tasks: [makeTask()] })),
      failDispatch: (command) => command.type === "thread.create",
      worktrees: {
        createForAgentTask: (task) =>
          Effect.succeed({
            planId: task.planId,
            taskId: task.id,
            branchName: "agent/plan/task-a",
            worktreePath: "C:/worktrees/task-a",
          }),
        removeForAgentTask: (task) =>
          Effect.sync(() => {
            removed.push(task.id);
          }),
      },
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.launchReadyWorkers({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(removed, [TASK_A_ID]);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("records risk when launch cleanup fails", () => {
    const harness = makeHarness({
      detail: Option.some(makePlan({ status: "awaiting_approval", tasks: [makeTask()] })),
      failDispatch: (command) => command.type === "thread.turn.start",
      worktrees: {
        createForAgentTask: (task) =>
          Effect.succeed({
            planId: task.planId,
            taskId: task.id,
            branchName: "agent/plan/task-a",
            worktreePath: "C:/worktrees/task-a",
          }),
        removeForAgentTask: () =>
          Effect.fail(new OrchestrationDispatchCommandError({ message: "cleanup failed" })),
      },
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.launchReadyWorkers({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.equal(
        harness.plan?.coordinationMessages.some(
          (message) => message.title === "Worker worktree cleanup failed",
        ),
        true,
      );
      assert.equal(
        harness.plan?.sharedUpdates.some((update) => update.type === "risk"),
        true,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("queues worker messages when the worker thread is missing or busy", () => {
    const busyThread = makeThread({
      id: WORKER_THREAD_ID,
      session: {
        threadId: WORKER_THREAD_ID,
        status: "running",
        providerName: "codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "approval-required",
        activeTurnId: TurnId.make("turn-busy"),
        lastError: null,
        updatedAt: NOW,
      },
    });
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "running",
          tasks: [
            makeTask({ id: TASK_A_ID, workerThreadId: null }),
            makeTask({ id: TASK_B_ID, workerThreadId: WORKER_THREAD_ID }),
          ],
        }),
      ),
      threads: [busyThread],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.sendWorkerMessage({
        planId: PLAN_ID,
        taskId: TASK_A_ID,
        kind: "progress_request",
        title: "Progress A",
        body: "Report.",
      });
      yield* service.sendWorkerMessage({
        planId: PLAN_ID,
        taskId: TASK_B_ID,
        kind: "progress_request",
        title: "Progress B",
        body: "Report.",
      });

      assert.equal(
        harness.plan?.coordinationMessages.every((message) => message.status === "queued"),
        true,
      );
      assert.equal(
        harness.dispatchCalls.some((command) => command.type === "thread.turn.start"),
        false,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("sends worker messages immediately when the worker thread is idle", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "running",
          tasks: [makeTask({ workerThreadId: WORKER_THREAD_ID })],
        }),
      ),
      threads: [makeThread({ id: WORKER_THREAD_ID })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.sendWorkerMessage({
        planId: PLAN_ID,
        taskId: TASK_A_ID,
        kind: "progress_request",
        title: "Progress",
        body: "Report progress.",
      });

      assert.equal(harness.plan?.coordinationMessages.at(-1)?.status, "sent");
      assert.equal(
        harness.dispatchCalls.filter((command) => command.type === "thread.turn.start").length,
        1,
      );
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("marks queued messages failed after three delivery attempts", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "running",
          tasks: [makeTask({ workerThreadId: WORKER_THREAD_ID })],
          coordinationMessages: [makeCoordinationMessage({ deliveryAttempts: 3 })],
        }),
      ),
      threads: [makeThread({ id: WORKER_THREAD_ID })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.flushQueuedCoordinationMessages(PLAN_ID);

      assert.equal(harness.plan?.coordinationMessages[0]?.status, "failed");
      assert.match(harness.plan?.coordinationMessages[0]?.failureReason ?? "", /delivery limit/);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("retries failed worker messages without resetting delivery attempts", () => {
    const message = makeCoordinationMessage({
      status: "failed",
      deliveryAttempts: 2,
      failedAt: NOW,
      failureReason: "previous failure",
    });
    const harness = makeHarness({
      detail: Option.some(
        makePlan({
          status: "running",
          tasks: [makeTask({ workerThreadId: WORKER_THREAD_ID })],
          coordinationMessages: [message],
        }),
      ),
      threads: [makeThread({ id: WORKER_THREAD_ID })],
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      yield* service.retryCoordinationMessage({ planId: PLAN_ID, messageId: message.id });

      const retried = harness.plan?.coordinationMessages.find(
        (candidate) => candidate.id === message.id,
      );
      assert.equal(retried?.status, "sent");
      assert.equal(retried?.deliveryAttempts, 3);
      assert.equal(retried?.failureReason, null);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects reviewer start while non-cancelled tasks are active", () => {
    const harness = makeHarness({
      detail: Option.some(
        makePlan({ status: "running", tasks: [makeTask({ status: "running" })] }),
      ),
    });

    return Effect.gen(function* () {
      const service = yield* AgentPlanService;
      const error = yield* service.startReviewer({ planId: PLAN_ID }).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.dispatchCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect(
    "creates reviewer thread, persists pending review, starts review turn, and marks reviewing",
    () => {
      const harness = makeHarness({
        detail: Option.some(makePlan({ status: "running", tasks: [makeTask({ status: "done" })] })),
      });

      return Effect.gen(function* () {
        const service = yield* AgentPlanService;
        const result = yield* service.startReviewer({ planId: PLAN_ID });

        assert.equal(result.planId, PLAN_ID);
        assert.deepStrictEqual(
          harness.dispatchCalls.map((command) => command.type),
          ["thread.create", "agent-review.upsert", "agent-plan.status.set", "thread.turn.start"],
        );
        assert.equal(harness.plan?.reviews[0]?.status, "pending");
        assert.equal(harness.plan?.status, "reviewing");
        const turnStart = expectCommand(harness.dispatchCalls, 3, "thread.turn.start");
        assert.match(turnStart.message.text, /review/i);
      }).pipe(Effect.provide(harness.layer));
    },
  );
});
