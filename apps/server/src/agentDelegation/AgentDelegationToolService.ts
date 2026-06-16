import {
  CommandId,
  DEFAULT_THREAD_AGENT_METADATA,
  EventId,
  MessageId,
  ThreadId,
  WorkerReportActivityPayload,
  WorkerSpawnedActivityPayload,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as EffectCodexSchema from "effect-codex-app-server/schema";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager } from "../worktrees/Services/WorktreeManager.ts";

const MAX_WORKERS_PER_CALL = 8;

const WorkerSpec = Schema.Struct({
  key: Schema.String.check(Schema.isNonEmpty()),
  title: Schema.String.check(Schema.isNonEmpty()),
  prompt: Schema.String.check(Schema.isNonEmpty()),
  successCriteria: Schema.Array(Schema.String),
  allowedPaths: Schema.Array(Schema.String),
  blockedPaths: Schema.Array(Schema.String),
});

const SpawnWorkersInput = Schema.Struct({
  summary: Schema.String.check(Schema.isNonEmpty()),
  workers: Schema.Array(WorkerSpec),
});

const WorkerReportStatus = Schema.Literals(["running", "blocked", "done", "failed", "cancelled"]);

const ReportToOwnerInput = Schema.Struct({
  status: WorkerReportStatus,
  title: Schema.String.check(Schema.isNonEmpty()),
  summary: Schema.String.check(Schema.isNonEmpty()),
  details: Schema.String,
  changedFiles: Schema.Array(Schema.String),
  testResults: Schema.Array(Schema.String),
  blockers: Schema.Array(Schema.String),
  needsOwnerResponse: Schema.Boolean,
});

const decodeSpawnWorkersInput = Schema.decodeUnknownEffect(SpawnWorkersInput);
const decodeReportToOwnerInput = Schema.decodeUnknownEffect(ReportToOwnerInput);
const encodeWorkerSpawnedActivityPayload = Schema.encodeEffect(WorkerSpawnedActivityPayload);
const encodeWorkerReportActivityPayload = Schema.encodeEffect(WorkerReportActivityPayload);

function resolveThreadAgentMetadata(thread: OrchestrationThread) {
  return thread.agentMetadata ?? DEFAULT_THREAD_AGENT_METADATA;
}

export interface AgentDelegationToolCallInput {
  readonly ownerThreadId: ThreadId;
  readonly params: EffectCodexSchema.DynamicToolCallParams;
}

export interface AgentDelegationToolServiceShape {
  readonly dynamicTools: ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec>;
  readonly execute: (
    input: AgentDelegationToolCallInput,
  ) => Effect.Effect<EffectCodexSchema.DynamicToolCallResponse>;
}

export class AgentDelegationToolService extends Context.Service<
  AgentDelegationToolService,
  AgentDelegationToolServiceShape
>()("t3/agentDelegation/AgentDelegationToolService") {}

const textToolResponse = (
  success: boolean,
  value: unknown,
): EffectCodexSchema.DynamicToolCallResponse => ({
  success,
  contentItems: [
    {
      type: "inputText",
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const dynamicTools: ReadonlyArray<EffectCodexSchema.V2ThreadStartParams__DynamicToolSpec> = [
  {
    namespace: "t3",
    name: "spawn_workers",
    description:
      "Create and launch up to 8 non-blocking worker threads for parallel subagent work. Prefer using this early for multi-project, multi-package, or test-heavy tasks. For each touched project that needs implementation and tests, default to two workers: <project>-implementation and <project>-verification. Workers inherit the current project, model, and runtime mode and report back with t3.report_to_owner.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "workers"],
      properties: {
        summary: {
          type: "string",
          minLength: 1,
          description:
            "Concise owner-level summary of the delegated work and why it is parallelizable.",
        },
        workers: {
          type: "array",
          minItems: 1,
          maxItems: MAX_WORKERS_PER_CALL,
          description:
            "Subagent assignments. For each project/package with meaningful implementation and required tests, prefer one implementation worker and one verification worker.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "title", "prompt", "successCriteria", "allowedPaths", "blockedPaths"],
            properties: {
              key: {
                type: "string",
                minLength: 1,
                description:
                  "Stable kebab-case task key, such as apps-web-implementation or apps-server-verification.",
              },
              title: {
                type: "string",
                minLength: 1,
                description: "Short human-readable subagent title shown in T3 Code.",
              },
              prompt: {
                type: "string",
                minLength: 1,
                description:
                  "Full worker assignment including scope, relevant guidelines, required files, tests/checks, and report expectations.",
              },
              successCriteria: {
                type: "array",
                description: "Concrete completion criteria the worker should satisfy.",
                items: { type: "string" },
              },
              allowedPaths: {
                type: "array",
                description:
                  "Paths the worker should stay within whenever possible, such as apps/web or packages/contracts.",
                items: { type: "string" },
              },
              blockedPaths: {
                type: "array",
                description: "Paths the worker must avoid unless explicitly instructed otherwise.",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
  {
    namespace: "t3",
    name: "report_to_owner",
    description:
      "Report worker progress, blockers, changed files, and test results to the parent owner thread without blocking the worker thread.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "status",
        "title",
        "summary",
        "details",
        "changedFiles",
        "testResults",
        "blockers",
        "needsOwnerResponse",
      ],
      properties: {
        status: {
          type: "string",
          enum: ["running", "blocked", "done", "failed", "cancelled"],
        },
        title: { type: "string", minLength: 1 },
        summary: { type: "string", minLength: 1 },
        details: { type: "string" },
        changedFiles: { type: "array", items: { type: "string" } },
        testResults: { type: "array", items: { type: "string" } },
        blockers: { type: "array", items: { type: "string" } },
        needsOwnerResponse: { type: "boolean" },
      },
    },
  },
];

function isT3Tool(params: EffectCodexSchema.DynamicToolCallParams, name: string): boolean {
  return (
    (params.namespace === "t3" && params.tool === name) ||
    params.tool === `t3.${name}` ||
    params.tool === name
  );
}

function buildWorkerPrompt(input: {
  readonly owner: OrchestrationThread;
  readonly summary: string;
  readonly worker: typeof WorkerSpec.Type;
}): string {
  const successCriteria = input.worker.successCriteria.length
    ? input.worker.successCriteria.map((item) => `- ${item}`).join("\n")
    : "- Complete the assigned task safely and report what changed.";
  const allowedPaths = input.worker.allowedPaths.length
    ? input.worker.allowedPaths.map((item) => `- ${item}`).join("\n")
    : "- No explicit path allow-list was provided. Stay within the project scope.";
  const blockedPaths = input.worker.blockedPaths.length
    ? input.worker.blockedPaths.map((item) => `- ${item}`).join("\n")
    : "- None";

  return [
    `You are a worker subagent for owner thread ${input.owner.id}.`,
    "",
    `Owner summary: ${input.summary}`,
    "",
    `Task: ${input.worker.title}`,
    "",
    input.worker.prompt,
    "",
    "Success criteria:",
    successCriteria,
    "",
    "Allowed paths:",
    allowedPaths,
    "",
    "Blocked paths:",
    blockedPaths,
    "",
    "When you make meaningful progress, hit a blocker, or finish, call t3.report_to_owner with a concise report.",
  ].join("\n");
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const worktreeManager = yield* WorktreeManager;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const randomId = (prefix: string) =>
    crypto.randomUUIDv4.pipe(Effect.map((uuid) => `${prefix}:${uuid}`));
  const commandId = (prefix: string) =>
    randomId(prefix).pipe(Effect.map((id) => CommandId.make(id)));
  const eventId = (prefix: string) => randomId(prefix).pipe(Effect.map((id) => EventId.make(id)));

  const getThread = (threadId: ThreadId) =>
    projectionSnapshotQuery.getThreadDetailById(threadId).pipe(Effect.map(Option.getOrUndefined));

  const dispatchActivity = (input: {
    readonly threadId: ThreadId;
    readonly kind: string;
    readonly summary: string;
    readonly payload: unknown;
    readonly tone?: "info" | "tool" | "approval" | "error";
  }) =>
    Effect.gen(function* () {
      const createdAt = yield* nowIso;
      yield* orchestrationEngine.dispatch({
        type: "thread.activity.append",
        commandId: yield* commandId("server:agent-delegation-activity"),
        threadId: input.threadId,
        activity: {
          id: yield* eventId("evt:agent-delegation-activity"),
          tone: input.tone ?? "tool",
          kind: input.kind,
          summary: input.summary,
          payload: input.payload,
          turnId: null,
          createdAt,
        },
        createdAt,
      });
    });

  const spawnWorkers = Effect.fn("spawnWorkers")(function* (
    ownerThreadId: ThreadId,
    rawArguments: unknown,
  ) {
    const input = yield* decodeSpawnWorkersInput(rawArguments);
    if (input.workers.length === 0) {
      return textToolResponse(false, "t3.spawn_workers requires at least one worker.");
    }
    if (input.workers.length > MAX_WORKERS_PER_CALL) {
      return textToolResponse(
        false,
        `t3.spawn_workers supports at most ${MAX_WORKERS_PER_CALL} workers per call.`,
      );
    }

    const owner = yield* getThread(ownerThreadId);
    if (!owner) {
      return textToolResponse(false, `Owner thread ${ownerThreadId} was not found.`);
    }
    const ownerAgentMetadata = resolveThreadAgentMetadata(owner);
    if (ownerAgentMetadata.role === "worker") {
      return textToolResponse(false, "Worker threads cannot spawn additional workers.");
    }

    const createdAt = yield* nowIso;
    const delegationId = yield* randomId("delegation");

    yield* orchestrationEngine.dispatch({
      type: "thread.agent-metadata.update",
      commandId: yield* commandId("server:owner-agent-metadata"),
      threadId: owner.id,
      agentMetadata: {
        role: "owner",
        parentThreadId: null,
        delegationId,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
      },
      updatedAt: createdAt,
    });

    const launched: Array<{
      readonly key: string;
      readonly title: string;
      readonly threadId: ThreadId;
      readonly branch: string;
      readonly worktreePath: string;
    }> = [];

    for (const worker of input.workers) {
      const worktree = yield* worktreeManager.createForWorker({
        projectId: owner.projectId,
        delegationId,
        taskKey: worker.key,
        title: worker.title,
      });
      const workerThreadId = ThreadId.make(yield* randomId("thread"));
      const workerCreatedAt = yield* nowIso;

      yield* orchestrationEngine.dispatch({
        type: "thread.create",
        commandId: yield* commandId("server:worker-thread-create"),
        threadId: workerThreadId,
        projectId: owner.projectId,
        title: worker.title,
        modelSelection: owner.modelSelection,
        runtimeMode: owner.runtimeMode,
        interactionMode: owner.interactionMode,
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
        agentMetadata: {
          role: "worker",
          parentThreadId: owner.id,
          delegationId,
          taskKey: worker.key,
          taskTitle: worker.title,
          taskStatus: "running",
        },
        createdAt: workerCreatedAt,
      });

      yield* orchestrationEngine.dispatch({
        type: "thread.turn.start",
        commandId: yield* commandId("server:worker-turn-start"),
        threadId: workerThreadId,
        message: {
          messageId: MessageId.make(yield* randomId("msg:worker-assignment")),
          role: "user",
          text: buildWorkerPrompt({ owner, summary: input.summary, worker }),
          attachments: [],
        },
        modelSelection: owner.modelSelection,
        titleSeed: worker.title,
        runtimeMode: owner.runtimeMode,
        interactionMode: owner.interactionMode,
        createdAt: workerCreatedAt,
      });

      launched.push({
        key: worker.key,
        title: worker.title,
        threadId: workerThreadId,
        branch: worktree.branchName,
        worktreePath: worktree.worktreePath,
      });
    }

    const spawnedPayload = yield* encodeWorkerSpawnedActivityPayload({
      delegationId,
      summary: input.summary,
      workers: launched,
    });

    yield* dispatchActivity({
      threadId: owner.id,
      kind: "worker.spawned",
      summary: `Launched ${launched.length} worker${launched.length === 1 ? "" : "s"}`,
      payload: spawnedPayload,
    });

    return textToolResponse(true, {
      status: "launched",
      delegationId,
      workers: launched.map((worker) => ({
        key: worker.key,
        title: worker.title,
        threadId: worker.threadId,
        branch: worker.branch,
        worktreePath: worker.worktreePath,
      })),
    });
  });

  const reportToOwner = Effect.fn("reportToOwner")(function* (
    workerThreadId: ThreadId,
    rawArguments: unknown,
  ) {
    const input = yield* decodeReportToOwnerInput(rawArguments);
    const worker = yield* getThread(workerThreadId);
    if (!worker) {
      return textToolResponse(false, `Worker thread ${workerThreadId} was not found.`);
    }
    const workerAgentMetadata = resolveThreadAgentMetadata(worker);
    const ownerThreadId = workerAgentMetadata.parentThreadId;
    if (workerAgentMetadata.role !== "worker" || ownerThreadId === null) {
      return textToolResponse(false, "t3.report_to_owner can only be used from a worker thread.");
    }
    const owner = yield* getThread(ownerThreadId);
    if (!owner) {
      return textToolResponse(false, `Owner thread ${ownerThreadId} was not found.`);
    }
    const updatedAt = yield* nowIso;

    yield* orchestrationEngine.dispatch({
      type: "thread.agent-metadata.update",
      commandId: yield* commandId("server:worker-agent-metadata"),
      threadId: worker.id,
      agentMetadata: {
        ...workerAgentMetadata,
        taskStatus: input.status,
      },
      updatedAt,
    });

    const reportPayload = yield* encodeWorkerReportActivityPayload({
      workerThreadId: worker.id,
      workerTitle: worker.title,
      taskKey: workerAgentMetadata.taskKey,
      status: input.status,
      title: input.title,
      summary: input.summary,
      details: input.details,
      changedFiles: input.changedFiles,
      testResults: input.testResults,
      blockers: input.blockers,
      needsOwnerResponse: input.needsOwnerResponse,
      delivery: "visible",
    });

    yield* dispatchActivity({
      threadId: owner.id,
      kind: "worker.report",
      tone: input.status === "failed" || input.status === "blocked" ? "error" : "tool",
      summary: `${worker.title}: ${input.summary}`,
      payload: reportPayload,
    });

    return textToolResponse(true, {
      status: "delivered",
      ownerThreadId: owner.id,
      workerThreadId: worker.id,
    });
  });

  const execute: AgentDelegationToolServiceShape["execute"] = (input) =>
    Effect.gen(function* () {
      if (isT3Tool(input.params, "spawn_workers")) {
        return yield* spawnWorkers(input.ownerThreadId, input.params.arguments);
      }
      if (isT3Tool(input.params, "report_to_owner")) {
        return yield* reportToOwner(input.ownerThreadId, input.params.arguments);
      }
      return textToolResponse(false, `Unknown dynamic tool '${input.params.tool}'.`);
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.succeed(
          textToolResponse(
            false,
            typeof error === "object" &&
              error !== null &&
              "message" in error &&
              typeof error.message === "string"
              ? error.message
              : String(error),
          ),
        ),
      ),
    );

  return {
    dynamicTools,
    execute,
  } satisfies AgentDelegationToolServiceShape;
});

export const AgentDelegationToolServiceLive = Layer.effect(AgentDelegationToolService, make);
