import {
  AgentContract,
  AgentCoordinationMessage,
  AgentPlanId,
  AgentPlanStatus,
  AgentReview,
  AgentSharedUpdate,
  AgentTask,
  IsoDateTime,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionAgentPlan = Schema.Struct({
  planId: AgentPlanId,
  title: Schema.String,
  userPrompt: Schema.String,
  status: AgentPlanStatus,
  ownerThreadId: Schema.NullOr(ThreadId),
  primaryProjectId: Schema.NullOr(ProjectId),
  projectIds: Schema.Array(ProjectId),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime),
});
export type ProjectionAgentPlan = typeof ProjectionAgentPlan.Type;

export const GetProjectionAgentPlanInput = Schema.Struct({
  planId: AgentPlanId,
});
export type GetProjectionAgentPlanInput = typeof GetProjectionAgentPlanInput.Type;

export interface ProjectionAgentPlanRepositoryShape {
  readonly upsertPlan: (row: ProjectionAgentPlan) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getPlanById: (
    input: GetProjectionAgentPlanInput,
  ) => Effect.Effect<Option.Option<ProjectionAgentPlan>, ProjectionRepositoryError>;
  readonly upsertTask: (task: AgentTask) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertSharedUpdate: (
    update: AgentSharedUpdate,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertContract: (
    contract: AgentContract,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertCoordinationMessage: (
    message: AgentCoordinationMessage,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly upsertReview: (review: AgentReview) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionAgentPlanRepository extends Context.Service<
  ProjectionAgentPlanRepository,
  ProjectionAgentPlanRepositoryShape
>()("t3/persistence/Services/ProjectionAgentPlans/ProjectionAgentPlanRepository") {}
