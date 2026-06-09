import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { AgentPlanService, type AgentPlanServiceShape } from "../Services/AgentPlanService.ts";

const makeAgentPlanService = Effect.gen(function* () {
  const orchestrationEngine = yield* OrchestrationEngineService;

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
