import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AgentContractId,
  AgentPlanId,
  AgentSharedUpdateId,
  AgentTaskId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const AgentPlanStatus = Schema.Literals([
  "draft",
  "planning",
  "awaiting_approval",
  "running",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentPlanStatus = typeof AgentPlanStatus.Type;

export const AgentTaskStatus = Schema.Literals([
  "pending",
  "running",
  "blocked",
  "done",
  "failed",
  "cancelled",
]);
export type AgentTaskStatus = typeof AgentTaskStatus.Type;

export const AgentSharedUpdateType = Schema.Literals([
  "progress",
  "decision",
  "contract",
  "blocker",
  "test_result",
  "risk",
  "review_note",
]);
export type AgentSharedUpdateType = typeof AgentSharedUpdateType.Type;

export const AgentSharedUpdateVisibility = Schema.Literals([
  "owner_only",
  "all_workers",
  "related_workers",
]);
export type AgentSharedUpdateVisibility = typeof AgentSharedUpdateVisibility.Type;

export const AgentContractType = Schema.Literals([
  "api",
  "type",
  "database",
  "event",
  "file_format",
  "config",
  "ui_behavior",
  "other",
]);
export type AgentContractType = typeof AgentContractType.Type;

export const AgentContractStatus = Schema.Literals([
  "draft",
  "proposed",
  "accepted",
  "changed",
  "deprecated",
]);
export type AgentContractStatus = typeof AgentContractStatus.Type;

export const AgentTask = Schema.Struct({
  id: AgentTaskId,
  planId: AgentPlanId,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  status: AgentTaskStatus,
  projectId: ProjectId,
  workerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  worktreePath: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  branchName: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  allowedPaths: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  blockedPaths: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependsOn: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  relatedTaskIds: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requiredContracts: Schema.Array(AgentContractId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  producedContracts: Schema.Array(AgentContractId).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  assignedProvider: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  summary: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  riskNotes: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentTask = typeof AgentTask.Type;

export const AgentSharedUpdate = Schema.Struct({
  id: AgentSharedUpdateId,
  planId: AgentPlanId,
  taskId: Schema.NullOr(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  type: AgentSharedUpdateType,
  title: TrimmedNonEmptyString,
  body: Schema.String,
  visibility: AgentSharedUpdateVisibility,
  relatedTaskIds: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  createdAt: IsoDateTime,
});
export type AgentSharedUpdate = typeof AgentSharedUpdate.Type;

export const AgentContract = Schema.Struct({
  id: AgentContractId,
  planId: AgentPlanId,
  producerTaskId: Schema.NullOr(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  consumerTaskIds: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  type: AgentContractType,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  status: AgentContractStatus,
  version: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentContract = typeof AgentContract.Type;

export const AgentPlan = Schema.Struct({
  id: AgentPlanId,
  title: TrimmedNonEmptyString,
  userPrompt: TrimmedNonEmptyString,
  status: AgentPlanStatus,
  projectIds: Schema.Array(ProjectId),
  primaryProjectId: Schema.NullOr(ProjectId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  ownerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  tasks: Schema.Array(AgentTask).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sharedUpdates: Schema.Array(AgentSharedUpdate).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  contracts: Schema.Array(AgentContract).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type AgentPlan = typeof AgentPlan.Type;

export const AgentPlanShell = Schema.Struct({
  id: AgentPlanId,
  title: TrimmedNonEmptyString,
  status: AgentPlanStatus,
  projectIds: Schema.Array(ProjectId),
  primaryProjectId: Schema.NullOr(ProjectId),
  ownerThreadId: Schema.NullOr(ThreadId),
  taskCount: NonNegativeInt,
  runningTaskCount: NonNegativeInt,
  blockedTaskCount: NonNegativeInt,
  doneTaskCount: NonNegativeInt,
  contractCount: NonNegativeInt,
  updateCount: NonNegativeInt,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentPlanShell = typeof AgentPlanShell.Type;

export const AgentPlanDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  plan: AgentPlan,
});
export type AgentPlanDetailSnapshot = typeof AgentPlanDetailSnapshot.Type;
