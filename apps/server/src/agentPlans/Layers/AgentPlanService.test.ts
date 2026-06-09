import {
  AgentPlanId,
  DEFAULT_MODEL,
  OrchestrationDispatchCommandError,
  type AgentPlanDetailSnapshot,
  type OrchestrationCommand,
  type OrchestrationProjectShell,
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

const PLAN_ID = AgentPlanId.make("agent-plan-owner");
const PROJECT_ID = ProjectId.make("project-owner");
const NOW = "2026-06-09T00:00:00.000Z";

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

function makeProjectionQuery(input: {
  readonly detail?: Option.Option<AgentPlanDetailSnapshot>;
  readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
}): ProjectionSnapshotQueryShape {
  const projects = new Map(
    (input.projects ?? [makeProject()]).map((project) => [project.id, project]),
  );
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
    getThreadDetailById: () => Effect.die("unused"),
    getAgentPlanShellById: () => Effect.die("unused"),
    getAgentPlanDetailById: () => Effect.succeed(input.detail ?? Option.some(makePlan())),
  };
}

function makeHarness(
  input: {
    readonly detail?: Option.Option<AgentPlanDetailSnapshot>;
    readonly projects?: ReadonlyArray<OrchestrationProjectShell>;
    readonly failDispatch?: (command: OrchestrationCommand) => boolean;
  } = {},
) {
  const dispatchCalls: OrchestrationCommand[] = [];
  let nextSequence = 1;
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
  const layer = AgentPlanServiceLive.pipe(
    Layer.provide(Layer.succeed(OrchestrationEngineService, engine)),
    Layer.provide(Layer.succeed(ProjectionSnapshotQuery, makeProjectionQuery(input))),
    Layer.provide(Layer.succeed(ServerRuntimeStartup, startup)),
    Layer.provideMerge(NodeServices.layer),
  );
  return { dispatchCalls, layer };
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
});
