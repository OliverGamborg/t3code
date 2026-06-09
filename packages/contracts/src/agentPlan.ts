import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentPlanId,
  AgentReviewId,
  AgentSharedUpdateId,
  AgentTaskId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
  TurnId,
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

export const AgentCoordinationRole = Schema.Literals(["owner", "worker", "reviewer", "system"]);
export type AgentCoordinationRole = typeof AgentCoordinationRole.Type;

export const AgentCoordinationTarget = Schema.Literals([
  "owner",
  "worker",
  "all_workers",
  "related_workers",
  "user",
]);
export type AgentCoordinationTarget = typeof AgentCoordinationTarget.Type;

export const AgentCoordinationKind = Schema.Literals([
  "owner_plan_import",
  "progress_request",
  "progress_report",
  "assignment",
  "clarification_request",
  "clarification_response",
  "contract_update",
  "blocker",
  "completion",
  "sync",
  "review_note",
  "error",
]);
export type AgentCoordinationKind = typeof AgentCoordinationKind.Type;

export const AgentCoordinationStatus = Schema.Literals([
  "queued",
  "sent",
  "acknowledged",
  "failed",
  "ignored",
]);
export type AgentCoordinationStatus = typeof AgentCoordinationStatus.Type;

export const AgentReviewStatus = Schema.Literals(["pending", "passed", "warning", "failed"]);
export type AgentReviewStatus = typeof AgentReviewStatus.Type;

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

export const AgentCoordinationMessage = Schema.Struct({
  id: AgentCoordinationMessageId,
  planId: AgentPlanId,
  dedupeKey: TrimmedNonEmptyString,
  kind: AgentCoordinationKind,
  status: AgentCoordinationStatus,
  fromRole: AgentCoordinationRole,
  fromTaskId: Schema.NullOr(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  fromThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  toTarget: AgentCoordinationTarget,
  toTaskIds: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  toThreadIds: Schema.Array(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  sourceMessageId: Schema.NullOr(MessageId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  sourceTurnId: Schema.NullOr(TurnId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  correlationId: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  title: TrimmedNonEmptyString,
  body: Schema.String,
  requiresResponse: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  deliveryAttempts: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  createdAt: IsoDateTime,
  sentAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  acknowledgedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  failedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  failureReason: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type AgentCoordinationMessage = typeof AgentCoordinationMessage.Type;

export const AgentReview = Schema.Struct({
  id: AgentReviewId,
  planId: AgentPlanId,
  reviewerThreadId: Schema.NullOr(ThreadId).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  status: AgentReviewStatus,
  summary: Schema.String,
  mergeOrder: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requiredFixes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  risks: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  testRecommendations: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentReview = typeof AgentReview.Type;

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
  coordinationMessages: Schema.Array(AgentCoordinationMessage).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  reviews: Schema.Array(AgentReview).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
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
  coordinationMessageCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  reviewCount: NonNegativeInt.pipe(Schema.withDecodingDefault(Effect.succeed(0))),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AgentPlanShell = typeof AgentPlanShell.Type;

export const AgentPlanDetailSnapshot = Schema.Struct({
  snapshotSequence: NonNegativeInt,
  plan: AgentPlan,
});
export type AgentPlanDetailSnapshot = typeof AgentPlanDetailSnapshot.Type;

export const AgentOwnerPlanOutputTask = Schema.Struct({
  taskKey: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  projectId: ProjectId,
  allowedPaths: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  blockedPaths: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  dependsOn: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  relatedTasks: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  requiredContracts: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  producedContracts: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  riskNotes: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type AgentOwnerPlanOutputTask = typeof AgentOwnerPlanOutputTask.Type;

export const AgentOwnerPlanOutputContract = Schema.Struct({
  contractKey: TrimmedNonEmptyString,
  type: AgentContractType,
  title: TrimmedNonEmptyString,
  description: TrimmedNonEmptyString,
  producerTaskKey: Schema.NullOr(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
  consumerTaskKeys: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentOwnerPlanOutputContract = typeof AgentOwnerPlanOutputContract.Type;

export const AgentOwnerPlanOutput = Schema.Struct({
  schema: Schema.Literal("t3.agent.owner_plan.v1"),
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  tasks: Schema.Array(AgentOwnerPlanOutputTask),
  contracts: Schema.Array(AgentOwnerPlanOutputContract).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  reviewPlan: Schema.Struct({
    mergeOrder: Schema.Array(TrimmedNonEmptyString).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    requiredChecks: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
    ),
    risks: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  }).pipe(
    Schema.withDecodingDefault(Effect.succeed({ mergeOrder: [], requiredChecks: [], risks: [] })),
  ),
  openQuestions: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type AgentOwnerPlanOutput = typeof AgentOwnerPlanOutput.Type;

export const AgentWorkerReportStatus = Schema.Literals(["progress", "blocked", "done", "failed"]);
export type AgentWorkerReportStatus = typeof AgentWorkerReportStatus.Type;

export const AgentWorkerContractUpdate = Schema.Struct({
  contractId: Schema.optional(AgentContractId),
  contractTitle: Schema.optional(TrimmedNonEmptyString),
  type: Schema.optional(AgentContractType),
  description: TrimmedNonEmptyString,
  status: AgentContractStatus,
});
export type AgentWorkerContractUpdate = typeof AgentWorkerContractUpdate.Type;

export const AgentWorkerReport = Schema.Struct({
  schema: Schema.Literal("t3.agent.worker_report.v1"),
  status: AgentWorkerReportStatus,
  title: TrimmedNonEmptyString,
  summary: Schema.String,
  details: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  requiresOwnerResponse: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  changedContracts: Schema.Array(AgentWorkerContractUpdate).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  testResults: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  blockers: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  nextSuggestedAction: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed(null)),
  ),
});
export type AgentWorkerReport = typeof AgentWorkerReport.Type;

export const AgentOwnerRouteMessage = Schema.Struct({
  targetTaskKeys: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  targetTaskIds: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  kind: Schema.Literals(["progress_request", "assignment", "clarification_response", "sync"]),
  title: TrimmedNonEmptyString,
  body: Schema.String,
  requiresResponse: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type AgentOwnerRouteMessage = typeof AgentOwnerRouteMessage.Type;

export const AgentOwnerRoutingTaskUpdate = Schema.Struct({
  taskKey: Schema.optional(TrimmedNonEmptyString),
  taskId: Schema.optional(AgentTaskId),
  status: Schema.optional(AgentTaskStatus),
  summary: Schema.optional(Schema.String),
  riskNotes: Schema.optional(Schema.String),
});
export type AgentOwnerRoutingTaskUpdate = typeof AgentOwnerRoutingTaskUpdate.Type;

export const AgentOwnerRoutingOutput = Schema.Struct({
  schema: Schema.Literal("t3.agent.owner_routing.v1"),
  summary: Schema.String,
  routeMessages: Schema.Array(AgentOwnerRouteMessage).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  taskUpdates: Schema.Array(AgentOwnerRoutingTaskUpdate).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  contractUpdates: Schema.Array(AgentWorkerContractUpdate).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
  askUser: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
  readyForReview: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type AgentOwnerRoutingOutput = typeof AgentOwnerRoutingOutput.Type;

export const AgentReviewerOutput = Schema.Struct({
  schema: Schema.Literal("t3.agent.review.v1"),
  status: AgentReviewStatus,
  summary: Schema.String,
  mergeOrder: Schema.Array(AgentTaskId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  requiredFixes: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  risks: Schema.Array(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
  testRecommendations: Schema.Array(Schema.String).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
  ),
});
export type AgentReviewerOutput = typeof AgentReviewerOutput.Type;
