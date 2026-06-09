import {
  CommandId,
  DEFAULT_MODEL,
  MessageId,
  type OrchestrationCommand,
  OrchestrationDispatchCommandError,
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
import { buildOwnerPlanningPrompt } from "../prompts.ts";
import { AgentPlanService, type AgentPlanServiceShape } from "../Services/AgentPlanService.ts";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);
const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const makeAgentPlanService = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const startup = yield* ServerRuntimeStartup;

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
        const detail = yield* projectionSnapshotQuery
          .getAgentPlanDetailById(input.planId)
          .pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(cause, `Failed to load agent plan ${input.planId}`),
            ),
          );

        if (Option.isNone(detail)) {
          return yield* new OrchestrationDispatchCommandError({
            message: `Agent plan ${input.planId} was not found`,
            cause: input.planId,
          });
        }

        const plan = detail.value.plan;
        if (
          plan.ownerThreadId !== null &&
          (plan.status === "planning" || plan.status === "running")
        ) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Agent plan already has an active owner planning thread.",
            cause: plan.ownerThreadId,
          });
        }

        const projectShells = yield* Effect.forEach(plan.projectIds, (projectId) =>
          projectionSnapshotQuery.getProjectShellById(projectId).pipe(
            Effect.mapError((cause) =>
              toDispatchCommandError(
                cause,
                `Failed to load project ${projectId} for agent plan ${plan.id}`,
              ),
            ),
            Effect.flatMap((project) =>
              Option.isSome(project)
                ? Effect.succeed(project.value)
                : Effect.fail(
                    new OrchestrationDispatchCommandError({
                      message: `Project ${projectId} for agent plan ${plan.id} was not found.`,
                      cause: projectId,
                    }),
                  ),
            ),
          ),
        );

        const primaryProject =
          projectShells.find((project) => project.id === plan.primaryProjectId) ??
          projectShells[0] ??
          null;
        if (primaryProject === null) {
          return yield* new OrchestrationDispatchCommandError({
            message: "Agent plan must include at least one project before owner planning.",
            cause: plan.id,
          });
        }

        const modelSelection = input.modelSelection ??
          primaryProject.defaultModelSelection ?? {
            instanceId: ProviderInstanceId.make("codex"),
            model: DEFAULT_MODEL,
          };
        const runtimeMode = input.runtimeMode ?? "approval-required";
        const interactionMode = input.interactionMode ?? "plan";
        const now = yield* nowIso;
        const ownerThreadId = yield* randomUUID.pipe(Effect.map(ThreadId.make));
        const messageId = yield* randomUUID.pipe(Effect.map(MessageId.make));
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
            messageId,
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
          sequence: Math.max(
            createThreadResult.sequence,
            updateResult.sequence,
            statusResult.sequence,
            turnResult.sequence,
          ),
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
  } satisfies AgentPlanServiceShape;
});

export const AgentPlanServiceLive = Layer.effect(AgentPlanService, makeAgentPlanService);
