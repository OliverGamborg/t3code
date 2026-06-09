import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  AgentPlanId,
  AgentTaskId,
  CommandId,
  EventId,
  type OrchestrationEvent,
  ProjectId,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const asEventId = (value: string): EventId => EventId.make(value);
const asProjectId = (value: string): ProjectId => ProjectId.make(value);
const asAgentPlanId = (value: string): AgentPlanId => AgentPlanId.make(value);
const asAgentTaskId = (value: string): AgentTaskId => AgentTaskId.make(value);

it.layer(NodeServices.layer)("decider agent plans", (it) => {
  it.effect("creates an agent plan and upserts scoped tasks", () =>
    Effect.gen(function* () {
      const now = "2026-01-01T00:00:00.000Z";
      const projectId = asProjectId("project-agent-plan");
      const planId = asAgentPlanId("agent-plan-1");
      const initial = createEmptyReadModel(now);
      const readModel = yield* projectEvent(initial, {
        sequence: 1,
        eventId: asEventId("evt-project-create-agent-plan"),
        aggregateKind: "project",
        aggregateId: projectId,
        type: "project.created",
        occurredAt: now,
        commandId: CommandId.make("cmd-project-create-agent-plan"),
        causationEventId: null,
        correlationId: CommandId.make("cmd-project-create-agent-plan"),
        metadata: {},
        payload: {
          projectId,
          title: "Project",
          workspaceRoot: "/tmp/project",
          defaultModelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5-codex",
          },
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const createResult = yield* decideOrchestrationCommand({
        command: {
          type: "agent-plan.create",
          commandId: CommandId.make("cmd-agent-plan-create"),
          planId,
          title: "Owner plan",
          userPrompt: "Coordinate archive functionality",
          projectIds: [projectId],
          createdAt: now,
        },
        readModel,
      });

      const createEvent = Array.isArray(createResult) ? null : createResult;
      if (createEvent === null) {
        throw new Error("Expected a single agent-plan.created event.");
      }
      expect(createEvent).toMatchObject({
        aggregateKind: "agent-plan",
        aggregateId: planId,
        type: "agent-plan.created",
        payload: {
          planId,
          status: "draft",
          projectIds: [projectId],
          primaryProjectId: projectId,
          ownerThreadId: null,
        },
      });

      const createdPlanEvent = {
        ...createEvent,
        sequence: 2,
      } as OrchestrationEvent;
      const withPlan = yield* projectEvent(readModel, createdPlanEvent);
      const taskId = asAgentTaskId("agent-task-1");
      const taskResult = yield* decideOrchestrationCommand({
        command: {
          type: "agent-task.upsert",
          commandId: CommandId.make("cmd-agent-task-upsert"),
          planId,
          task: {
            id: taskId,
            planId,
            title: "Backend task",
            description: "Add persisted archive behavior",
            status: "pending",
            projectId,
            workerThreadId: null,
            worktreePath: null,
            branchName: null,
            allowedPaths: ["apps/server/src"],
            blockedPaths: [".repos"],
            dependsOn: [],
            relatedTaskIds: [],
            requiredContracts: [],
            producedContracts: [],
            assignedProvider: null,
            summary: null,
            riskNotes: null,
            createdAt: now,
            updatedAt: now,
          },
        },
        readModel: withPlan,
      });

      const taskEvent = Array.isArray(taskResult) ? null : taskResult;
      if (taskEvent === null) {
        throw new Error("Expected a single agent-task.upserted event.");
      }
      expect(taskEvent).toMatchObject({
        aggregateKind: "agent-plan",
        aggregateId: planId,
        type: "agent-task.upserted",
        payload: {
          planId,
          task: {
            id: taskId,
            allowedPaths: ["apps/server/src"],
            blockedPaths: [".repos"],
          },
        },
      });
    }),
  );
});
