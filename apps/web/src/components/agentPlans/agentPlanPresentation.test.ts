import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentPlanId,
  AgentReviewId,
  AgentSharedUpdateId,
  AgentTaskId,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type AgentCoordinationMessage,
  type AgentReview,
  type AgentSharedUpdate,
  type AgentTask,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { Thread } from "~/types";
import {
  canRetryMessage,
  countTasks,
  launchBlockerReason,
  makeActivity,
  taskProgress,
  workerProgressItems,
  type AgentPlan,
} from "./agentPlanPresentation";
import { deriveAgentWorkerExecutionSummary } from "./useAgentWorkerExecutionSummary";

const PLAN_ID = AgentPlanId.make("agent-plan-ui-test");
const PROJECT_ID = ProjectId.make("project-ui-test");
const TASK_A_ID = AgentTaskId.make("agent-task-ui-a");
const TASK_B_ID = AgentTaskId.make("agent-task-ui-b");
const CONTRACT_ID = AgentContractId.make("agent-contract-ui-api");
const NOW = "2026-06-09T12:00:00.000Z";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: TASK_A_ID,
    planId: PLAN_ID,
    title: "Task A",
    description: "Implement task A.",
    status: "pending",
    projectId: PROJECT_ID,
    workerThreadId: null,
    worktreePath: null,
    branchName: null,
    allowedPaths: [],
    blockedPaths: [],
    dependsOn: [],
    relatedTaskIds: [],
    requiredContracts: [],
    producedContracts: [],
    assignedProvider: null,
    summary: null,
    riskNotes: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function plan(overrides: Partial<AgentPlan> = {}): AgentPlan {
  return {
    id: PLAN_ID,
    title: "UI plan",
    userPrompt: "Build UI.",
    status: "running",
    projectIds: [PROJECT_ID],
    primaryProjectId: PROJECT_ID,
    ownerThreadId: ThreadId.make("thread-owner-ui"),
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    tasks: [],
    sharedUpdates: [],
    contracts: [
      {
        id: CONTRACT_ID,
        planId: PLAN_ID,
        producerTaskId: TASK_A_ID,
        consumerTaskIds: [TASK_B_ID],
        type: "api",
        title: "API contract",
        description: "Shared API.",
        status: "accepted",
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    coordinationMessages: [],
    reviews: [],
    ...overrides,
  };
}

function message(overrides: Partial<AgentCoordinationMessage> = {}): AgentCoordinationMessage {
  return {
    id: AgentCoordinationMessageId.make("coordination-ui-message"),
    planId: PLAN_ID,
    dedupeKey: "message-key",
    kind: "sync",
    status: "queued",
    fromRole: "owner",
    fromTaskId: null,
    fromThreadId: null,
    toTarget: "worker",
    toTaskIds: [TASK_A_ID],
    toThreadIds: [],
    sourceMessageId: null,
    sourceTurnId: null,
    correlationId: null,
    title: "Sync",
    body: "Sync worker.",
    requiresResponse: true,
    deliveryAttempts: 0,
    createdAt: NOW,
    sentAt: null,
    acknowledgedAt: null,
    failedAt: null,
    failureReason: null,
    ...overrides,
  };
}

describe("agent plan presentation helpers", () => {
  it("counts tasks by status", () => {
    expect(
      countTasks([
        task({ status: "pending" }),
        task({ id: TASK_B_ID, status: "running" }),
        task({ id: AgentTaskId.make("agent-task-done"), status: "done" }),
      ]),
    ).toMatchObject({
      pending: 1,
      running: 1,
      done: 1,
    });
  });

  it("derives worker progress from task state", () => {
    const running = task({
      status: "running",
      workerThreadId: ThreadId.make("thread-worker-ui"),
      worktreePath: "/repo/worktree",
      branchName: "agent/ui/task-a",
      summary: "First report.",
    });

    expect(workerProgressItems(running).map((item) => item.done)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(taskProgress(running)).toEqual({ done: 5, total: 7, percent: 71 });
  });

  it("explains why a pending task cannot launch", () => {
    const taskA = task({ id: TASK_A_ID, status: "running" });
    const taskB = task({ id: TASK_B_ID, dependsOn: [TASK_A_ID] });
    expect(launchBlockerReason(plan({ tasks: [taskA, taskB] }), taskB)).toBe(
      "Waiting on 1 dependency.",
    );
  });

  it("merges and sorts activity sources", () => {
    const update: AgentSharedUpdate = {
      id: AgentSharedUpdateId.make("update-ui"),
      planId: PLAN_ID,
      taskId: TASK_A_ID,
      type: "progress",
      title: "Progress",
      body: "Worker progressed.",
      visibility: "all_workers",
      relatedTaskIds: [TASK_A_ID],
      createdAt: "2026-06-09T12:00:00.000Z",
    };
    const review: AgentReview = {
      id: AgentReviewId.make("review-ui"),
      planId: PLAN_ID,
      reviewerThreadId: null,
      status: "warning",
      summary: "Review warning.",
      mergeOrder: [TASK_A_ID],
      requiredFixes: [],
      risks: [],
      testRecommendations: [],
      createdAt: "2026-06-09T12:01:00.000Z",
      updatedAt: "2026-06-09T12:02:00.000Z",
    };

    expect(makeActivity([update], [message()], [review]).map((item) => item.title)).toEqual([
      "Review warning",
      "Progress",
      "Sync",
    ]);
  });

  it("detects retryable coordination messages", () => {
    expect(canRetryMessage(message({ status: "queued", toTarget: "worker" }))).toBe(true);
    expect(canRetryMessage(message({ status: "failed", toTarget: "owner" }))).toBe(true);
    expect(canRetryMessage(message({ status: "sent", toTarget: "worker" }))).toBe(false);
    expect(canRetryMessage(message({ status: "queued", toTarget: "user" }))).toBe(false);
  });

  it("derives execution summary from thread activities and checkpoints", () => {
    const activity: OrchestrationThreadActivity = {
      id: EventId.make("activity-command"),
      tone: "tool",
      kind: "tool.completed",
      summary: "Command completed",
      payload: {
        itemType: "command_execution",
        detail: "pnpm test --filter contracts\nExit code: 0",
      },
      turnId: TurnId.make("turn-ui"),
      sequence: 1,
      createdAt: NOW,
    };
    const thread = {
      activities: [activity],
      turnDiffSummaries: [
        {
          turnId: TurnId.make("turn-ui"),
          completedAt: NOW,
          status: "ready",
          files: [
            { path: "packages/contracts/src/rpc.ts", additions: 4, deletions: 1 },
            { path: "packages/contracts/src/rpc.ts", additions: 2, deletions: 0 },
          ],
        },
      ],
    } as Thread;

    const summary = deriveAgentWorkerExecutionSummary(thread);
    expect(summary.changedFiles).toEqual([
      { path: "packages/contracts/src/rpc.ts", kind: undefined, additions: 6, deletions: 1 },
    ]);
    expect(summary.recentCommands[0]?.command).toContain("pnpm test");
    expect(summary.logEntries[0]?.detail).toContain("Exit code: 0");
  });
});
