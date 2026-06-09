import type {
  AgentContract,
  AgentPlanId,
  AgentSharedUpdate,
  AgentTask,
  CommandId,
  ModelSelection,
  OrchestrationDispatchCommandError,
  ProviderInteractionMode,
  ProjectId,
  RuntimeMode,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { OrchestrationDispatchError } from "../../orchestration/Errors.ts";

export interface CreateManualAgentPlanInput {
  readonly commandId: CommandId;
  readonly planId: AgentPlanId;
  readonly title: string;
  readonly userPrompt: string;
  readonly projectIds: ReadonlyArray<ProjectId>;
  readonly primaryProjectId?: ProjectId | null;
  readonly createdAt: string;
}

export interface StartOwnerPlanningInput {
  readonly planId: AgentPlanId;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}

export interface StartOwnerPlanningResult {
  readonly planId: AgentPlanId;
  readonly ownerThreadId: ThreadId;
  readonly sequence: number;
}

export interface AgentPlanServiceShape {
  readonly createManualPlan: (
    input: CreateManualAgentPlanInput,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  readonly startOwnerPlanning: (
    input: StartOwnerPlanningInput,
  ) => Effect.Effect<StartOwnerPlanningResult, OrchestrationDispatchCommandError>;
  readonly upsertTask: (
    planId: AgentPlanId,
    commandId: CommandId,
    task: AgentTask,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  readonly appendSharedUpdate: (
    planId: AgentPlanId,
    commandId: CommandId,
    update: AgentSharedUpdate,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  readonly upsertContract: (
    planId: AgentPlanId,
    commandId: CommandId,
    contract: AgentContract,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
}

export class AgentPlanService extends Context.Service<AgentPlanService, AgentPlanServiceShape>()(
  "t3/agentPlans/Services/AgentPlanService",
) {}
