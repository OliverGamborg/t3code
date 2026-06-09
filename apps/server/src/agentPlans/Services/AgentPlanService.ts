import type {
  AgentContract,
  AgentCoordinationMessage,
  AgentPlanId,
  AgentReview,
  AgentReviewId,
  AgentSharedUpdate,
  AgentCoordinationMessageId,
  AgentTask,
  AgentTaskId,
  CommandId,
  MessageId,
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

export interface ImportOwnerPlanOutputInput {
  readonly planId: AgentPlanId;
  readonly source?: "latest_owner_message" | "provided_json" | undefined;
  readonly ownerMessageId?: MessageId | undefined;
  readonly jsonText?: string | undefined;
  readonly replaceDraft?: boolean | undefined;
}

export interface ImportOwnerPlanOutputResult {
  readonly planId: AgentPlanId;
  readonly taskCount: number;
  readonly contractCount: number;
  readonly sequence: number;
}

export interface ApproveAgentPlanTasksInput {
  readonly planId: AgentPlanId;
  readonly taskIds?: ReadonlyArray<AgentTaskId> | undefined;
  readonly launch?: boolean | undefined;
  readonly allowPathOverlaps?: boolean | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}

export interface LaunchAgentPlanReadyWorkersInput {
  readonly planId: AgentPlanId;
  readonly taskIds?: ReadonlyArray<AgentTaskId> | undefined;
  readonly reason?: "approval" | "dependency_completed" | "retry" | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}

export interface LaunchAgentPlanReadyWorkersResult {
  readonly planId: AgentPlanId;
  readonly launchedTaskIds: ReadonlyArray<AgentTaskId>;
  readonly skippedTaskIds: ReadonlyArray<AgentTaskId>;
  readonly sequence: number;
}

export interface SendWorkerMessageInput {
  readonly planId: AgentPlanId;
  readonly taskId: AgentTaskId;
  readonly kind: "progress_request" | "assignment" | "clarification_response" | "sync";
  readonly title: string;
  readonly body: string;
  readonly requiresResponse?: boolean | undefined;
}

export interface StartAgentPlanReviewInput {
  readonly planId: AgentPlanId;
  readonly modelSelection?: ModelSelection | undefined;
  readonly runtimeMode?: RuntimeMode | undefined;
  readonly interactionMode?: ProviderInteractionMode | undefined;
}

export interface StartAgentPlanReviewResult {
  readonly planId: AgentPlanId;
  readonly reviewId: AgentReviewId;
  readonly reviewerThreadId: ThreadId;
  readonly sequence: number;
}

export interface RetryCoordinationMessageInput {
  readonly planId: AgentPlanId;
  readonly messageId: AgentCoordinationMessageId;
}

export interface AgentPlanServiceShape {
  readonly createManualPlan: (
    input: CreateManualAgentPlanInput,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
  readonly startOwnerPlanning: (
    input: StartOwnerPlanningInput,
  ) => Effect.Effect<StartOwnerPlanningResult, OrchestrationDispatchCommandError>;
  readonly importOwnerPlanOutput: (
    input: ImportOwnerPlanOutputInput,
  ) => Effect.Effect<ImportOwnerPlanOutputResult, OrchestrationDispatchCommandError>;
  readonly approveAgentPlanTasks: (
    input: ApproveAgentPlanTasksInput,
  ) => Effect.Effect<LaunchAgentPlanReadyWorkersResult, OrchestrationDispatchCommandError>;
  readonly launchReadyWorkers: (
    input: LaunchAgentPlanReadyWorkersInput,
  ) => Effect.Effect<LaunchAgentPlanReadyWorkersResult, OrchestrationDispatchCommandError>;
  readonly sendWorkerMessage: (
    input: SendWorkerMessageInput,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  readonly queueCoordinationMessage: (
    message: AgentCoordinationMessage,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  readonly flushQueuedCoordinationMessages: (
    planId: AgentPlanId,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  readonly retryCoordinationMessage: (
    input: RetryCoordinationMessageInput,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchCommandError>;
  readonly startReviewer: (
    input: StartAgentPlanReviewInput,
  ) => Effect.Effect<StartAgentPlanReviewResult, OrchestrationDispatchCommandError>;
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
  readonly upsertReview: (
    planId: AgentPlanId,
    commandId: CommandId,
    review: AgentReview,
  ) => Effect.Effect<{ readonly sequence: number }, OrchestrationDispatchError>;
}

export class AgentPlanService extends Context.Service<AgentPlanService, AgentPlanServiceShape>()(
  "t3/agentPlans/Services/AgentPlanService",
) {}
