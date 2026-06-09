import "../../index.css";

import {
  AgentContractId,
  AgentCoordinationMessageId,
  AgentPlanId,
  AgentReviewId,
  AgentSharedUpdateId,
  AgentTaskId,
  EnvironmentId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type AgentPlan,
  type AgentPlanDetailSnapshot,
  type AgentPlanShell,
  type AgentTask,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { page } from "vite-plus/test/browser";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { createMockEnvironmentApi } from "../../../test/createMockEnvironmentApi";
import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "../../environmentApi";
import { useStore, type EnvironmentState } from "../../store";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type AgentPlanSummary,
  type Project,
  type Thread,
} from "../../types";
import { AgentPlansPage } from "./AgentPlansPage";

const ENVIRONMENT_ID = EnvironmentId.make("environment-agent-ui");
const PROJECT_ID = ProjectId.make("project-agent-ui");
const PLAN_ID = AgentPlanId.make("agent-plan-ui");
const OWNER_THREAD_ID = ThreadId.make("thread-owner-ui");
const WORKER_A_THREAD_ID = ThreadId.make("thread-worker-a-ui");
const WORKER_B_THREAD_ID = ThreadId.make("thread-worker-b-ui");
const REVIEWER_THREAD_ID = ThreadId.make("thread-reviewer-ui");
const TASK_A_ID = AgentTaskId.make("agent-task-ui-a");
const TASK_B_ID = AgentTaskId.make("agent-task-ui-b");
const CONTRACT_ID = AgentContractId.make("agent-contract-ui-api");
const NOW = "2026-06-09T12:00:00.000Z";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: TASK_A_ID,
    planId: PLAN_ID,
    title: "Plan Service",
    description: "Implement expanded plan service and shared helpers.",
    status: "running",
    projectId: PROJECT_ID,
    workerThreadId: WORKER_A_THREAD_ID,
    worktreePath: "/repo/t3code/.worktrees/plan-service",
    branchName: "agent/owner-worker/plan-service-a",
    allowedPaths: ["apps/server/src/agentPlans"],
    blockedPaths: [],
    dependsOn: [],
    relatedTaskIds: [],
    requiredContracts: [CONTRACT_ID],
    producedContracts: [CONTRACT_ID],
    assignedProvider: null,
    summary: "First report received.",
    riskNotes: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makePlan(): AgentPlan {
  const taskA = task();
  const taskB = task({
    id: TASK_B_ID,
    title: "Event Reactor",
    description: "Implement event reactor and worker state machine.",
    status: "blocked",
    workerThreadId: WORKER_B_THREAD_ID,
    dependsOn: [TASK_A_ID],
    summary: "Waiting on owner clarification.",
    riskNotes: "Needs idle timeout clarification.",
  });
  return {
    id: PLAN_ID,
    title: "Owner-worker orchestration plan",
    userPrompt: "Polish owner worker orchestration.",
    status: "running",
    projectIds: [PROJECT_ID],
    primaryProjectId: PROJECT_ID,
    ownerThreadId: OWNER_THREAD_ID,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    tasks: [taskA, taskB],
    sharedUpdates: [
      {
        id: AgentSharedUpdateId.make("agent-update-ui-progress"),
        planId: PLAN_ID,
        taskId: TASK_A_ID,
        type: "progress",
        title: "Plan Service is running",
        body: "Working on service tests and launch flow.",
        visibility: "all_workers",
        relatedTaskIds: [TASK_A_ID],
        createdAt: "2026-06-09T12:01:00.000Z",
      },
    ],
    contracts: [
      {
        id: CONTRACT_ID,
        planId: PLAN_ID,
        producerTaskId: TASK_A_ID,
        consumerTaskIds: [TASK_B_ID],
        type: "api",
        title: "Coordination API",
        description: "Shared coordination message contract.",
        status: "accepted",
        version: 1,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    coordinationMessages: [
      {
        id: AgentCoordinationMessageId.make("agent-message-ui-retry"),
        planId: PLAN_ID,
        dedupeKey: "retry-message",
        kind: "sync",
        status: "queued",
        fromRole: "owner",
        fromTaskId: null,
        fromThreadId: OWNER_THREAD_ID,
        toTarget: "worker",
        toTaskIds: [TASK_A_ID],
        toThreadIds: [WORKER_A_THREAD_ID],
        sourceMessageId: null,
        sourceTurnId: null,
        correlationId: null,
        title: "Sync message",
        body: "Please report progress.",
        requiresResponse: true,
        deliveryAttempts: 1,
        createdAt: "2026-06-09T12:02:00.000Z",
        sentAt: null,
        acknowledgedAt: null,
        failedAt: null,
        failureReason: null,
      },
    ],
    reviews: [
      {
        id: AgentReviewId.make("agent-review-ui"),
        planId: PLAN_ID,
        reviewerThreadId: REVIEWER_THREAD_ID,
        status: "warning",
        summary: "Review found merge risks.",
        mergeOrder: [TASK_A_ID, TASK_B_ID],
        requiredFixes: ["Resolve reactor blocker"],
        risks: ["Worktree cleanup may fail"],
        testRecommendations: ["Run vp check"],
        createdAt: "2026-06-09T12:03:00.000Z",
        updatedAt: "2026-06-09T12:04:00.000Z",
      },
    ],
  };
}

function makeThread(id: ThreadId, overrides: Partial<Thread> = {}): Thread {
  return {
    id,
    environmentId: ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Worker thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: NOW,
    archivedAt: null,
    updatedAt: NOW,
    latestTurn: null,
    branch: "agent/owner-worker/plan-service-a",
    worktreePath: "/repo/t3code/.worktrees/plan-service",
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeWorkerActivity(): OrchestrationThreadActivity {
  return {
    id: EventId.make("activity-command-ui"),
    tone: "tool",
    kind: "tool.completed",
    summary: "Command completed",
    payload: {
      itemType: "command_execution",
      detail: "pnpm test --filter contracts\nExit code: 0",
    },
    turnId: TurnId.make("turn-worker-ui"),
    sequence: 1,
    createdAt: "2026-06-09T12:05:00.000Z",
  };
}

function makeStoreState(plan: AgentPlan): EnvironmentState {
  const project: Project = {
    id: PROJECT_ID,
    environmentId: ENVIRONMENT_ID,
    name: "t3code",
    cwd: "/repo/t3code",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
  };
  const ownerThread = makeThread(OWNER_THREAD_ID, { title: "Owner Controller" });
  const workerThread = makeThread(WORKER_A_THREAD_ID, {
    title: "Worker: Plan Service",
    turnDiffSummaries: [
      {
        turnId: TurnId.make("turn-worker-ui"),
        completedAt: "2026-06-09T12:06:00.000Z",
        status: "ready",
        files: [{ path: "packages/contracts/src/rpc.ts", additions: 18, deletions: 1 }],
      },
    ],
    activities: [makeWorkerActivity()],
  });
  const blockedWorkerThread = makeThread(WORKER_B_THREAD_ID, { title: "Worker: Event Reactor" });
  const threads = [ownerThread, workerThread, blockedWorkerThread];
  const shell: AgentPlanShell = {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    projectIds: plan.projectIds,
    primaryProjectId: plan.primaryProjectId,
    ownerThreadId: plan.ownerThreadId,
    taskCount: plan.tasks.length,
    runningTaskCount: plan.tasks.filter((task) => task.status === "running").length,
    blockedTaskCount: plan.tasks.filter((task) => task.status === "blocked").length,
    doneTaskCount: plan.tasks.filter((task) => task.status === "done").length,
    contractCount: plan.contracts.length,
    updateCount: plan.sharedUpdates.length,
    coordinationMessageCount: plan.coordinationMessages.length,
    reviewCount: plan.reviews.length,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
  const planSummary: AgentPlanSummary = { ...shell, environmentId: ENVIRONMENT_ID };

  return {
    projectIds: [PROJECT_ID],
    projectById: { [PROJECT_ID]: project },
    threadIds: threads.map((thread) => thread.id),
    threadIdsByProjectId: { [PROJECT_ID]: threads.map((thread) => thread.id) },
    threadShellById: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        {
          id: thread.id,
          environmentId: thread.environmentId,
          codexThreadId: thread.codexThreadId,
          projectId: thread.projectId,
          title: thread.title,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: thread.interactionMode,
          error: thread.error,
          createdAt: thread.createdAt,
          archivedAt: thread.archivedAt,
          updatedAt: thread.updatedAt,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        },
      ]),
    ) as EnvironmentState["threadShellById"],
    threadSessionById: Object.fromEntries(
      threads.map((thread) => [thread.id, thread.session]),
    ) as EnvironmentState["threadSessionById"],
    threadTurnStateById: Object.fromEntries(
      threads.map((thread) => [thread.id, { latestTurn: thread.latestTurn }]),
    ) as EnvironmentState["threadTurnStateById"],
    messageIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, []]),
    ) as EnvironmentState["messageIdsByThreadId"],
    messageByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, {}]),
    ) as EnvironmentState["messageByThreadId"],
    activityIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, thread.activities.map((activity) => activity.id)]),
    ) as EnvironmentState["activityIdsByThreadId"],
    activityByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.activities.map((activity) => [activity.id, activity])),
      ]),
    ) as EnvironmentState["activityByThreadId"],
    proposedPlanIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, []]),
    ) as EnvironmentState["proposedPlanIdsByThreadId"],
    proposedPlanByThreadId: Object.fromEntries(
      threads.map((thread) => [thread.id, {}]),
    ) as EnvironmentState["proposedPlanByThreadId"],
    turnDiffIdsByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        thread.turnDiffSummaries.map((summary) => summary.turnId),
      ]),
    ) as EnvironmentState["turnDiffIdsByThreadId"],
    turnDiffSummaryByThreadId: Object.fromEntries(
      threads.map((thread) => [
        thread.id,
        Object.fromEntries(thread.turnDiffSummaries.map((summary) => [summary.turnId, summary])),
      ]),
    ) as EnvironmentState["turnDiffSummaryByThreadId"],
    sidebarThreadSummaryById: {},
    agentPlanIds: [plan.id],
    agentPlanShellById: { [plan.id]: planSummary },
    bootstrapComplete: true,
  };
}

function renderAgentPlanPage(plan = makePlan()) {
  const detail: AgentPlanDetailSnapshot = {
    snapshotSequence: 1,
    plan,
  };
  useStore.setState({
    activeEnvironmentId: ENVIRONMENT_ID,
    environmentStateById: {
      [ENVIRONMENT_ID]: makeStoreState(plan),
    },
  });

  const dispatchCommand = vi.fn(async () => ({ sequence: 10 }));
  const importAgentPlanOwnerOutput = vi.fn(async () => ({
    planId: PLAN_ID,
    taskCount: detail.plan.tasks.length,
    contractCount: detail.plan.contracts.length,
    sequence: 11,
  }));
  const approveAgentPlanTasks = vi.fn(async () => ({
    planId: PLAN_ID,
    launchedTaskIds: [],
    skippedTaskIds: [],
    sequence: 12,
  }));
  const retryAgentPlanCoordinationMessage = vi.fn(async () => ({ sequence: 13 }));
  __setEnvironmentApiOverrideForTests(
    ENVIRONMENT_ID,
    createMockEnvironmentApi({
      orchestration: {
        dispatchCommand,
        getAgentPlan: vi.fn(async () => detail),
        subscribeAgentPlan: vi.fn((_input, callback) => {
          callback({ kind: "snapshot", snapshot: detail });
          return () => undefined;
        }),
        importAgentPlanOwnerOutput,
        approveAgentPlanTasks,
        retryAgentPlanCoordinationMessage,
        launchAgentPlanReadyWorkers: vi.fn(async () => ({
          planId: PLAN_ID,
          launchedTaskIds: [],
          skippedTaskIds: [],
          sequence: 14,
        })),
        startAgentPlanOwnerPlanning: vi.fn(async () => ({
          planId: PLAN_ID,
          ownerThreadId: OWNER_THREAD_ID,
          sequence: 15,
        })),
        startAgentPlanReview: vi.fn(async () => ({
          planId: PLAN_ID,
          reviewId: AgentReviewId.make("agent-review-started"),
          reviewerThreadId: REVIEWER_THREAD_ID,
          sequence: 16,
        })),
        sendAgentPlanWorkerMessage: vi.fn(async () => ({ sequence: 17 })),
      },
    }),
  );

  const rootRoute = createRootRoute({
    component: Outlet,
  });
  const agentPlansRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/agent-plans",
    component: AgentPlansPage,
  });
  const agentPlanRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/agent-plans/$planId",
    component: () => <AgentPlansPage planId={PLAN_ID} />,
  });
  const threadRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/$environmentId/$threadId",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([agentPlansRoute, agentPlanRoute, threadRoute]),
    history: createMemoryHistory({ initialEntries: [`/agent-plans/${PLAN_ID}`] }),
  });

  return {
    dispatchCommand,
    importAgentPlanOwnerOutput,
    approveAgentPlanTasks,
    retryAgentPlanCoordinationMessage,
    renderResult: render(<RouterProvider router={router} />),
  };
}

afterEach(() => {
  __resetEnvironmentApiOverridesForTests();
  useStore.setState({ activeEnvironmentId: null, environmentStateById: {} });
  vi.clearAllMocks();
});

describe("AgentPlansPage", () => {
  it("renders mission-control metrics, workers, inspector execution data, and review output", async () => {
    await page.viewport(1440, 920);
    renderAgentPlanPage();

    await expect.element(page.getByText("Mission control")).toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Owner Controller" }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: /W1 Plan Service running/ }))
      .toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: /W2 Event Reactor blocked/ }))
      .toBeInTheDocument();
    await expect.element(page.getByText("Coordination API").first()).toBeInTheDocument();
    await expect.element(page.getByText("packages/contracts/src/rpc.ts")).toBeInTheDocument();
    await expect
      .element(page.getByText("pnpm test --filter contracts").first())
      .toBeInTheDocument();
    await expect.element(page.getByText("Resolve reactor blocker")).toBeInTheDocument();
    await expect.element(page.getByText("Worktree cleanup may fail")).toBeInTheDocument();
  });

  it("uses real RPCs for import, approval, retry, worker progress, and owner composer", async () => {
    const {
      approveAgentPlanTasks,
      dispatchCommand,
      importAgentPlanOwnerOutput,
      retryAgentPlanCoordinationMessage,
    } = renderAgentPlanPage();

    await page.getByRole("button", { name: "Agent plan actions" }).click();
    await page.getByRole("menuitem", { name: "Import owner output" }).click();
    expect(importAgentPlanOwnerOutput).toHaveBeenCalledWith({
      planId: PLAN_ID,
      source: "latest_owner_message",
      replaceDraft: true,
    });

    await page.getByText("Paste JSON").click();
    await page.getByPlaceholder("Paste owner JSON output here.").fill('{"tasks":[]}');
    await page.getByRole("button", { name: "Agent plan actions" }).click();
    await page.getByRole("menuitem", { name: "Import owner output" }).click();
    expect(importAgentPlanOwnerOutput).toHaveBeenLastCalledWith({
      planId: PLAN_ID,
      source: "provided_json",
      jsonText: '{"tasks":[]}',
      replaceDraft: true,
    });

    await page.getByRole("button", { name: "Agent plan actions" }).click();
    await page.getByRole("menuitem", { name: "Approve and launch" }).click();
    expect(approveAgentPlanTasks).toHaveBeenCalledWith({ planId: PLAN_ID, launch: true });

    await page.getByRole("button", { name: "Retry Sync message" }).first().click();
    expect(retryAgentPlanCoordinationMessage).toHaveBeenCalledWith({
      planId: PLAN_ID,
      messageId: AgentCoordinationMessageId.make("agent-message-ui-retry"),
    });

    await page.getByRole("button", { name: "Ask progress" }).click();
    await page
      .getByPlaceholder("Ask owner anything, request rerouting, or summarize next actions...")
      .fill("Summarize current risk.");
    await page.getByRole("button", { name: "Send to owner" }).click();
    expect(dispatchCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "thread.turn.start",
        threadId: OWNER_THREAD_ID,
        message: expect.objectContaining({ text: "Summarize current risk." }),
      }),
    );
  });

  it("shows import prompt for empty imported plans", async () => {
    renderAgentPlanPage(makePlanWithNoTasks());
    await expect
      .element(page.getByText("Import the owner plan output to create worker tasks."))
      .toBeInTheDocument();
  });

  it("stays usable without document overflow on desktop and mobile", async () => {
    await page.viewport(1440, 920);
    renderAgentPlanPage();
    const desktopOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth;
    expect(desktopOverflow).toBe(false);

    await page.viewport(390, 820);
    const mobileOverflow =
      document.documentElement.scrollWidth > document.documentElement.clientWidth;
    expect(mobileOverflow).toBe(false);
    await expect.element(page.getByRole("button", { name: "Agent plan actions" })).toBeVisible();
    await expect.element(page.getByText("Worker inspector")).toBeInTheDocument();
  });
});

function makePlanWithNoTasks(): AgentPlan {
  return {
    ...makePlan(),
    status: "awaiting_approval",
    tasks: [],
    coordinationMessages: [],
    reviews: [],
  };
}
