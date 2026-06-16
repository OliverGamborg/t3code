import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_THREAD_AGENT_METADATA,
  ProjectId,
  ThreadId,
  WorkerReportActivityPayload,
  WorkerSpawnedActivityPayload,
  type OrchestrationCommand,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { ProviderInstanceId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager } from "../worktrees/Services/WorktreeManager.ts";
import {
  AgentDelegationToolService,
  AgentDelegationToolServiceLive,
} from "./AgentDelegationToolService.ts";

const decodeWorkerSpawnedActivityPayload = Schema.decodeUnknownEffect(WorkerSpawnedActivityPayload);
const decodeWorkerReportActivityPayload = Schema.decodeUnknownEffect(WorkerReportActivityPayload);

const PROJECT_ID = ProjectId.make("project-1");
const OWNER_THREAD_ID = ThreadId.make("thread-owner");
const WORKER_THREAD_ID = ThreadId.make("thread-worker");

function makeThread(
  id: ThreadId,
  overrides: Partial<OrchestrationThread> = {},
): OrchestrationThread {
  return {
    id,
    projectId: PROJECT_ID,
    title: id === OWNER_THREAD_ID ? "Owner thread" : "Worker thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
    worktreePath: null,
    agentMetadata: DEFAULT_THREAD_AGENT_METADATA,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    ...overrides,
  };
}

function makeToolParams(tool: string, args: unknown): EffectCodexSchema.DynamicToolCallParams {
  return {
    arguments: args,
    callId: "call-1",
    namespace: "t3",
    threadId: "provider-thread-1",
    tool,
    turnId: "turn-1",
  };
}

function responseText(response: EffectCodexSchema.DynamicToolCallResponse): string {
  return response.contentItems
    .map((item) => (item.type === "inputText" ? item.text : ""))
    .join("\n");
}

function runWithFakes<A>(
  threads: Map<ThreadId, OrchestrationThread>,
  dispatchedCommands: OrchestrationCommand[],
  effect: Effect.Effect<A, never, AgentDelegationToolService>,
) {
  const dependencies = Layer.mergeAll(
    Layer.succeed(ProjectionSnapshotQuery, {
      getThreadDetailById: (threadId: ThreadId) =>
        Effect.succeed(threads.has(threadId) ? Option.some(threads.get(threadId)!) : Option.none()),
    } as never),
    Layer.succeed(OrchestrationEngineService, {
      readEvents: () => Stream.empty,
      streamDomainEvents: Stream.empty,
      dispatch: (command: OrchestrationCommand) =>
        Effect.sync(() => {
          dispatchedCommands.push(command);
          return { sequence: dispatchedCommands.length };
        }),
    }),
    Layer.succeed(WorktreeManager, {
      createForWorker: (input) =>
        Effect.succeed({
          branchName: `worker/${input.taskKey}`,
          worktreePath: `/repo/.t3/worktrees/${input.taskKey}`,
        }),
      removeForWorker: () => Effect.void,
      createForAgentTask: () => Effect.die("unused"),
      removeForAgentTask: () => Effect.void,
    }),
    NodeServices.layer,
  );
  return effect.pipe(
    Effect.provide(AgentDelegationToolServiceLive.pipe(Layer.provide(dependencies))),
  );
}

describe("AgentDelegationToolService", () => {
  it.effect("describes early implementation and verification delegation", () =>
    Effect.gen(function* () {
      const service = yield* AgentDelegationToolService;
      const spawnTool = service.dynamicTools.find((tool) => tool.name === "spawn_workers");

      assert.include(spawnTool?.description ?? "", "Prefer using this early");
      assert.include(spawnTool?.description ?? "", "<project>-implementation");
      assert.include(spawnTool?.description ?? "", "<project>-verification");
    }).pipe(
      Effect.provide(
        AgentDelegationToolServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProjectionSnapshotQuery, {} as never),
              Layer.succeed(OrchestrationEngineService, {} as never),
              Layer.succeed(WorktreeManager, {} as never),
              NodeServices.layer,
            ),
          ),
        ),
      ),
    ),
  );

  it.effect("spawns workers and emits a schema-valid worker.spawned activity", () =>
    Effect.gen(function* () {
      const dispatchedCommands: OrchestrationCommand[] = [];
      const threads = new Map<ThreadId, OrchestrationThread>([
        [OWNER_THREAD_ID, makeThread(OWNER_THREAD_ID)],
      ]);

      const response = yield* runWithFakes(
        threads,
        dispatchedCommands,
        Effect.gen(function* () {
          const service = yield* AgentDelegationToolService;
          return yield* service.execute({
            ownerThreadId: OWNER_THREAD_ID,
            params: makeToolParams("spawn_workers", {
              summary: "Split web implementation and verification.",
              workers: [
                {
                  key: "apps-web-implementation",
                  title: "Apps web implementation",
                  prompt: "Implement the Subagents sidebar.",
                  successCriteria: ["Sidebar renders subagent cards."],
                  allowedPaths: ["apps/web"],
                  blockedPaths: [".repos"],
                },
              ],
            }),
          });
        }),
      );

      assert.strictEqual(response.success, true);
      const activity = dispatchedCommands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append" && command.activity.kind === "worker.spawned",
      );
      assert.ok(activity);
      const payload = yield* decodeWorkerSpawnedActivityPayload(activity.activity.payload);
      assert.strictEqual(payload.summary, "Split web implementation and verification.");
      assert.strictEqual(payload.workers[0]?.key, "apps-web-implementation");
    }),
  );

  it.effect("emits a schema-valid worker.report activity", () =>
    Effect.gen(function* () {
      const dispatchedCommands: OrchestrationCommand[] = [];
      const threads = new Map<ThreadId, OrchestrationThread>([
        [OWNER_THREAD_ID, makeThread(OWNER_THREAD_ID)],
        [
          WORKER_THREAD_ID,
          makeThread(WORKER_THREAD_ID, {
            agentMetadata: {
              role: "worker",
              parentThreadId: OWNER_THREAD_ID,
              delegationId: "delegation-1",
              taskKey: "apps-web-implementation",
              taskTitle: "Apps web implementation",
              taskStatus: "running",
            },
          }),
        ],
      ]);

      const response = yield* runWithFakes(
        threads,
        dispatchedCommands,
        Effect.gen(function* () {
          const service = yield* AgentDelegationToolService;
          return yield* service.execute({
            ownerThreadId: WORKER_THREAD_ID,
            params: makeToolParams("report_to_owner", {
              status: "done",
              title: "Implementation complete",
              summary: "Added Subagents sidebar.",
              details: "Cards render worker status and latest reports.",
              changedFiles: ["apps/web/src/components/SubagentsSidebar.tsx"],
              testResults: ["web typecheck passed"],
              blockers: [],
              needsOwnerResponse: false,
            }),
          });
        }),
      );

      assert.strictEqual(response.success, true);
      const activity = dispatchedCommands.find(
        (command): command is Extract<OrchestrationCommand, { type: "thread.activity.append" }> =>
          command.type === "thread.activity.append" && command.activity.kind === "worker.report",
      );
      assert.ok(activity);
      const payload = yield* decodeWorkerReportActivityPayload(activity.activity.payload);
      assert.strictEqual(payload.workerThreadId, WORKER_THREAD_ID);
      assert.strictEqual(payload.status, "done");
    }),
  );

  it.effect("rejects worker spawn requests from worker threads", () =>
    Effect.gen(function* () {
      const dispatchedCommands: OrchestrationCommand[] = [];
      const threads = new Map<ThreadId, OrchestrationThread>([
        [
          WORKER_THREAD_ID,
          makeThread(WORKER_THREAD_ID, {
            agentMetadata: {
              role: "worker",
              parentThreadId: OWNER_THREAD_ID,
              delegationId: "delegation-1",
              taskKey: "apps-web-implementation",
              taskTitle: "Apps web implementation",
              taskStatus: "running",
            },
          }),
        ],
      ]);

      const response = yield* runWithFakes(
        threads,
        dispatchedCommands,
        Effect.gen(function* () {
          const service = yield* AgentDelegationToolService;
          return yield* service.execute({
            ownerThreadId: WORKER_THREAD_ID,
            params: makeToolParams("spawn_workers", {
              summary: "Nested delegation.",
              workers: [
                {
                  key: "nested",
                  title: "Nested worker",
                  prompt: "Should not launch.",
                  successCriteria: [],
                  allowedPaths: [],
                  blockedPaths: [],
                },
              ],
            }),
          });
        }),
      );

      assert.strictEqual(response.success, false);
      assert.include(responseText(response), "Worker threads cannot spawn");
      assert.deepStrictEqual(dispatchedCommands, []);
    }),
  );

  it.effect("rejects more than 8 workers", () =>
    Effect.gen(function* () {
      const dispatchedCommands: OrchestrationCommand[] = [];
      const threads = new Map<ThreadId, OrchestrationThread>([
        [OWNER_THREAD_ID, makeThread(OWNER_THREAD_ID)],
      ]);

      const response = yield* runWithFakes(
        threads,
        dispatchedCommands,
        Effect.gen(function* () {
          const service = yield* AgentDelegationToolService;
          return yield* service.execute({
            ownerThreadId: OWNER_THREAD_ID,
            params: makeToolParams("spawn_workers", {
              summary: "Too many workers.",
              workers: Array.from({ length: 9 }, (_, index) => ({
                key: `worker-${index}`,
                title: `Worker ${index}`,
                prompt: "Should not launch.",
                successCriteria: [],
                allowedPaths: [],
                blockedPaths: [],
              })),
            }),
          });
        }),
      );

      assert.strictEqual(response.success, false);
      assert.include(responseText(response), "at most 8 workers");
      assert.deepStrictEqual(dispatchedCommands, []);
    }),
  );
});
