import {
  AgentContract,
  AgentCoordinationMessage,
  AgentReview,
  AgentSharedUpdate,
  AgentTask,
  ProjectId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  GetProjectionAgentPlanInput,
  ProjectionAgentPlan,
  ProjectionAgentPlanRepository,
  type ProjectionAgentPlanRepositoryShape,
} from "../Services/ProjectionAgentPlans.ts";

const ProjectionAgentPlanDbRow = ProjectionAgentPlan.mapFields(
  Struct.assign({
    projectIds: Schema.fromJsonString(Schema.Array(ProjectId)),
  }),
);

const makeProjectionAgentPlanRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionAgentPlanRow = SqlSchema.void({
    Request: ProjectionAgentPlan,
    execute: (row) => sql`
      INSERT INTO projection_agent_plans (
        plan_id,
        title,
        user_prompt,
        status,
        owner_thread_id,
        primary_project_id,
        project_ids_json,
        created_at,
        updated_at,
        deleted_at
      )
      VALUES (
        ${row.planId},
        ${row.title},
        ${row.userPrompt},
        ${row.status},
        ${row.ownerThreadId},
        ${row.primaryProjectId},
        ${JSON.stringify(row.projectIds)},
        ${row.createdAt},
        ${row.updatedAt},
        ${row.deletedAt}
      )
      ON CONFLICT (plan_id)
      DO UPDATE SET
        title = excluded.title,
        user_prompt = excluded.user_prompt,
        status = excluded.status,
        owner_thread_id = excluded.owner_thread_id,
        primary_project_id = excluded.primary_project_id,
        project_ids_json = excluded.project_ids_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at
    `,
  });

  const getProjectionAgentPlanRow = SqlSchema.findOneOption({
    Request: GetProjectionAgentPlanInput,
    Result: ProjectionAgentPlanDbRow,
    execute: ({ planId }) => sql`
      SELECT
        plan_id AS "planId",
        title,
        user_prompt AS "userPrompt",
        status,
        owner_thread_id AS "ownerThreadId",
        primary_project_id AS "primaryProjectId",
        project_ids_json AS "projectIds",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        deleted_at AS "deletedAt"
      FROM projection_agent_plans
      WHERE plan_id = ${planId}
    `,
  });

  const upsertProjectionAgentTaskRow = SqlSchema.void({
    Request: AgentTask,
    execute: (task) => sql`
      INSERT INTO projection_agent_tasks (
        task_id,
        plan_id,
        title,
        description,
        status,
        project_id,
        worker_thread_id,
        worktree_path,
        branch_name,
        allowed_paths_json,
        blocked_paths_json,
        depends_on_json,
        related_task_ids_json,
        required_contract_ids_json,
        produced_contract_ids_json,
        assigned_provider,
        summary,
        risk_notes,
        created_at,
        updated_at
      )
      VALUES (
        ${task.id},
        ${task.planId},
        ${task.title},
        ${task.description},
        ${task.status},
        ${task.projectId},
        ${task.workerThreadId},
        ${task.worktreePath},
        ${task.branchName},
        ${JSON.stringify(task.allowedPaths)},
        ${JSON.stringify(task.blockedPaths)},
        ${JSON.stringify(task.dependsOn)},
        ${JSON.stringify(task.relatedTaskIds)},
        ${JSON.stringify(task.requiredContracts)},
        ${JSON.stringify(task.producedContracts)},
        ${task.assignedProvider},
        ${task.summary},
        ${task.riskNotes},
        ${task.createdAt},
        ${task.updatedAt}
      )
      ON CONFLICT (task_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        project_id = excluded.project_id,
        worker_thread_id = excluded.worker_thread_id,
        worktree_path = excluded.worktree_path,
        branch_name = excluded.branch_name,
        allowed_paths_json = excluded.allowed_paths_json,
        blocked_paths_json = excluded.blocked_paths_json,
        depends_on_json = excluded.depends_on_json,
        related_task_ids_json = excluded.related_task_ids_json,
        required_contract_ids_json = excluded.required_contract_ids_json,
        produced_contract_ids_json = excluded.produced_contract_ids_json,
        assigned_provider = excluded.assigned_provider,
        summary = excluded.summary,
        risk_notes = excluded.risk_notes,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const upsertProjectionAgentSharedUpdateRow = SqlSchema.void({
    Request: AgentSharedUpdate,
    execute: (update) => sql`
      INSERT INTO projection_agent_shared_updates (
        update_id,
        plan_id,
        task_id,
        type,
        title,
        body,
        visibility,
        related_task_ids_json,
        created_at
      )
      VALUES (
        ${update.id},
        ${update.planId},
        ${update.taskId},
        ${update.type},
        ${update.title},
        ${update.body},
        ${update.visibility},
        ${JSON.stringify(update.relatedTaskIds)},
        ${update.createdAt}
      )
      ON CONFLICT (update_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        task_id = excluded.task_id,
        type = excluded.type,
        title = excluded.title,
        body = excluded.body,
        visibility = excluded.visibility,
        related_task_ids_json = excluded.related_task_ids_json,
        created_at = excluded.created_at
    `,
  });

  const upsertProjectionAgentContractRow = SqlSchema.void({
    Request: AgentContract,
    execute: (contract) => sql`
      INSERT INTO projection_agent_contracts (
        contract_id,
        plan_id,
        producer_task_id,
        consumer_task_ids_json,
        type,
        title,
        description,
        status,
        version,
        created_at,
        updated_at
      )
      VALUES (
        ${contract.id},
        ${contract.planId},
        ${contract.producerTaskId},
        ${JSON.stringify(contract.consumerTaskIds)},
        ${contract.type},
        ${contract.title},
        ${contract.description},
        ${contract.status},
        ${contract.version},
        ${contract.createdAt},
        ${contract.updatedAt}
      )
      ON CONFLICT (contract_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        producer_task_id = excluded.producer_task_id,
        consumer_task_ids_json = excluded.consumer_task_ids_json,
        type = excluded.type,
        title = excluded.title,
        description = excluded.description,
        status = excluded.status,
        version = excluded.version,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const upsertProjectionAgentCoordinationMessageRow = SqlSchema.void({
    Request: AgentCoordinationMessage,
    execute: (message) => sql`
      INSERT INTO projection_agent_coordination_messages (
        message_id,
        plan_id,
        dedupe_key,
        kind,
        status,
        from_role,
        from_task_id,
        from_thread_id,
        to_target,
        to_task_ids_json,
        to_thread_ids_json,
        source_message_id,
        source_turn_id,
        correlation_id,
        title,
        body,
        requires_response,
        delivery_attempts,
        created_at,
        sent_at,
        acknowledged_at,
        failed_at,
        failure_reason
      )
      VALUES (
        ${message.id},
        ${message.planId},
        ${message.dedupeKey},
        ${message.kind},
        ${message.status},
        ${message.fromRole},
        ${message.fromTaskId},
        ${message.fromThreadId},
        ${message.toTarget},
        ${JSON.stringify(message.toTaskIds)},
        ${JSON.stringify(message.toThreadIds)},
        ${message.sourceMessageId},
        ${message.sourceTurnId},
        ${message.correlationId},
        ${message.title},
        ${message.body},
        ${message.requiresResponse ? 1 : 0},
        ${message.deliveryAttempts},
        ${message.createdAt},
        ${message.sentAt},
        ${message.acknowledgedAt},
        ${message.failedAt},
        ${message.failureReason}
      )
      ON CONFLICT (message_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        dedupe_key = excluded.dedupe_key,
        kind = excluded.kind,
        status = excluded.status,
        from_role = excluded.from_role,
        from_task_id = excluded.from_task_id,
        from_thread_id = excluded.from_thread_id,
        to_target = excluded.to_target,
        to_task_ids_json = excluded.to_task_ids_json,
        to_thread_ids_json = excluded.to_thread_ids_json,
        source_message_id = excluded.source_message_id,
        source_turn_id = excluded.source_turn_id,
        correlation_id = excluded.correlation_id,
        title = excluded.title,
        body = excluded.body,
        requires_response = excluded.requires_response,
        delivery_attempts = excluded.delivery_attempts,
        created_at = excluded.created_at,
        sent_at = excluded.sent_at,
        acknowledged_at = excluded.acknowledged_at,
        failed_at = excluded.failed_at,
        failure_reason = excluded.failure_reason
    `,
  });

  const upsertProjectionAgentReviewRow = SqlSchema.void({
    Request: AgentReview,
    execute: (review) => sql`
      INSERT INTO projection_agent_reviews (
        review_id,
        plan_id,
        reviewer_thread_id,
        status,
        summary,
        merge_order_json,
        required_fixes_json,
        risks_json,
        test_recommendations_json,
        created_at,
        updated_at
      )
      VALUES (
        ${review.id},
        ${review.planId},
        ${review.reviewerThreadId},
        ${review.status},
        ${review.summary},
        ${JSON.stringify(review.mergeOrder)},
        ${JSON.stringify(review.requiredFixes)},
        ${JSON.stringify(review.risks)},
        ${JSON.stringify(review.testRecommendations)},
        ${review.createdAt},
        ${review.updatedAt}
      )
      ON CONFLICT (review_id)
      DO UPDATE SET
        plan_id = excluded.plan_id,
        reviewer_thread_id = excluded.reviewer_thread_id,
        status = excluded.status,
        summary = excluded.summary,
        merge_order_json = excluded.merge_order_json,
        required_fixes_json = excluded.required_fixes_json,
        risks_json = excluded.risks_json,
        test_recommendations_json = excluded.test_recommendations_json,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const upsertPlan: ProjectionAgentPlanRepositoryShape["upsertPlan"] = (row) =>
    upsertProjectionAgentPlanRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentPlanRepository.upsertPlan:query")),
    );

  const getPlanById: ProjectionAgentPlanRepositoryShape["getPlanById"] = (input) =>
    getProjectionAgentPlanRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentPlanRepository.getPlanById:query")),
    );

  const upsertTask: ProjectionAgentPlanRepositoryShape["upsertTask"] = (task) =>
    upsertProjectionAgentTaskRow(task).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentPlanRepository.upsertTask:query")),
    );

  const upsertSharedUpdate: ProjectionAgentPlanRepositoryShape["upsertSharedUpdate"] = (update) =>
    upsertProjectionAgentSharedUpdateRow(update).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionAgentPlanRepository.upsertSharedUpdate:query"),
      ),
    );

  const upsertContract: ProjectionAgentPlanRepositoryShape["upsertContract"] = (contract) =>
    upsertProjectionAgentContractRow(contract).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentPlanRepository.upsertContract:query")),
    );

  const upsertCoordinationMessage: ProjectionAgentPlanRepositoryShape["upsertCoordinationMessage"] =
    (message) =>
      upsertProjectionAgentCoordinationMessageRow(message).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionAgentPlanRepository.upsertCoordinationMessage:query"),
        ),
      );

  const upsertReview: ProjectionAgentPlanRepositoryShape["upsertReview"] = (review) =>
    upsertProjectionAgentReviewRow(review).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionAgentPlanRepository.upsertReview:query")),
    );

  return {
    upsertPlan,
    getPlanById,
    upsertTask,
    upsertSharedUpdate,
    upsertContract,
    upsertCoordinationMessage,
    upsertReview,
  } satisfies ProjectionAgentPlanRepositoryShape;
});

export const ProjectionAgentPlanRepositoryLive = Layer.effect(
  ProjectionAgentPlanRepository,
  makeProjectionAgentPlanRepository,
);
