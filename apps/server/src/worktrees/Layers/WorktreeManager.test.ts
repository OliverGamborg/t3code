import {
  GitCommandError,
  OrchestrationDispatchCommandError,
  ProjectId,
  type AgentTask,
  type OrchestrationProjectShell,
  type VcsCreateWorktreeInput,
  type VcsRemoveWorktreeInput,
  type VcsStatusLocalResult,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerConfig } from "../../config.ts";
import { GitWorkflowService, type GitWorkflowServiceShape } from "../../git/GitWorkflowService.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager } from "../Services/WorktreeManager.ts";
import { WorktreeManagerLive } from "./WorktreeManager.ts";

const PROJECT_ID = ProjectId.make("project-worktree");
const NOW = "2026-06-09T00:00:00.000Z";
const TEST_BASE_DIR = "/tmp/t3-worktree-manager-base";
const TEST_WORKTREES_DIR = `${TEST_BASE_DIR}/worktrees`;

function makeProject(
  overrides: Partial<OrchestrationProjectShell> = {},
): OrchestrationProjectShell {
  return {
    id: PROJECT_ID,
    title: "Worktree Project",
    workspaceRoot: "/workspace/project",
    repositoryIdentity: null,
    defaultModelSelection: null,
    scripts: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "agent-task:agent-plan-owner:task-a" as AgentTask["id"],
    planId: "agent-plan-owner" as AgentTask["planId"],
    title: "Task A",
    description: "Task A.",
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

function cleanStatus(overrides: Partial<VcsStatusLocalResult> = {}): VcsStatusLocalResult {
  return {
    isRepo: true,
    hasPrimaryRemote: true,
    isDefaultRef: false,
    refName: "main",
    hasWorkingTreeChanges: false,
    workingTree: {
      files: [],
      insertions: 0,
      deletions: 0,
    },
    ...overrides,
  };
}

function makeProjection(
  project: Option.Option<OrchestrationProjectShell>,
): ProjectionSnapshotQueryShape {
  return {
    getCommandReadModel: () => Effect.die("unused"),
    getSnapshot: () => Effect.die("unused"),
    getShellSnapshot: () => Effect.die("unused"),
    getArchivedShellSnapshot: () => Effect.die("unused"),
    getSnapshotSequence: () => Effect.die("unused"),
    getCounts: () => Effect.die("unused"),
    getActiveProjectByWorkspaceRoot: () => Effect.die("unused"),
    getProjectShellById: () => Effect.succeed(project),
    getFirstActiveThreadIdByProjectId: () => Effect.die("unused"),
    getThreadCheckpointContext: () => Effect.die("unused"),
    getFullThreadDiffContext: () => Effect.die("unused"),
    getThreadShellById: () => Effect.die("unused"),
    getThreadDetailById: () => Effect.die("unused"),
    getAgentPlanShellById: () => Effect.die("unused"),
    getAgentPlanDetailById: () => Effect.die("unused"),
  };
}

function makeHarness(
  input: {
    readonly project?: Option.Option<OrchestrationProjectShell>;
    readonly status?: VcsStatusLocalResult;
    readonly createFailure?: GitCommandError;
    readonly removeFailure?: GitCommandError;
  } = {},
) {
  const createCalls: VcsCreateWorktreeInput[] = [];
  const removeCalls: VcsRemoveWorktreeInput[] = [];
  const git: GitWorkflowServiceShape = {
    status: () => Effect.die("unused"),
    localStatus: () => Effect.succeed(input.status ?? cleanStatus()),
    remoteStatus: () => Effect.die("unused"),
    invalidateLocalStatus: () => Effect.void,
    invalidateRemoteStatus: () => Effect.void,
    invalidateStatus: () => Effect.void,
    pullCurrentBranch: () => Effect.die("unused"),
    runStackedAction: () => Effect.die("unused"),
    resolvePullRequest: () => Effect.die("unused"),
    preparePullRequestThread: () => Effect.die("unused"),
    listRefs: () => Effect.die("unused"),
    createWorktree: (call) =>
      Effect.gen(function* () {
        createCalls.push(call);
        if (input.createFailure) {
          return yield* input.createFailure;
        }
        return {
          worktree: {
            path: call.path ?? `${TEST_WORKTREES_DIR}/project/task-a`,
            refName: call.newRefName ?? call.refName,
          },
        };
      }),
    removeWorktree: (call) =>
      Effect.gen(function* () {
        removeCalls.push(call);
        if (input.removeFailure) {
          return yield* input.removeFailure;
        }
      }),
    createRef: () => Effect.die("unused"),
    switchRef: () => Effect.die("unused"),
    renameBranch: () => Effect.die("unused"),
  };
  const layer = WorktreeManagerLive.pipe(
    Layer.provide(Layer.succeed(GitWorkflowService, git)),
    Layer.provide(
      Layer.succeed(
        ProjectionSnapshotQuery,
        makeProjection(input.project ?? Option.some(makeProject())),
      ),
    ),
    Layer.provide(ServerConfig.layerTest("/workspace", TEST_BASE_DIR)),
    Layer.provideMerge(NodeServices.layer),
  );
  return { createCalls, removeCalls, layer };
}

describe("WorktreeManager", () => {
  it.effect("rejects missing projects", () => {
    const harness = makeHarness({ project: Option.none() });

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      const error = yield* manager.createForAgentTask(makeTask()).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.createCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("rejects non-repositories, dirty repos, and detached refs", () =>
    Effect.gen(function* () {
      for (const status of [
        cleanStatus({ isRepo: false }),
        cleanStatus({ hasWorkingTreeChanges: true }),
        cleanStatus({ refName: null }),
      ]) {
        const harness = makeHarness({ status });
        const error = yield* Effect.gen(function* () {
          const manager = yield* WorktreeManager;
          return yield* manager.createForAgentTask(makeTask());
        }).pipe(Effect.provide(harness.layer), Effect.flip);

        assert.instanceOf(error, OrchestrationDispatchCommandError);
        assert.deepStrictEqual(harness.createCalls, []);
      }
    }),
  );

  it.effect("generates a safe branch and calls createWorktree with cwd, ref, and new ref", () => {
    const harness = makeHarness();
    const task = makeTask({
      id: "agent-task:agent-plan-owner:Task_1234567890" as AgentTask["id"],
      title: "Task With Weird Chars !!! And A Very Very Very Very Very Long Tail",
    });

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      const result = yield* manager.createForAgentTask(task);

      assert.equal(
        result.branchName,
        "agent/agent-plan-owner/task-with-weird-chars-and-a-very-very-v-34567890",
      );
      assert.deepStrictEqual(harness.createCalls[0], {
        cwd: "/workspace/project",
        refName: "main",
        newRefName: "agent/agent-plan-owner/task-with-weird-chars-and-a-very-very-v-34567890",
        path: null,
      });
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("removes existing task worktrees without force", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      yield* manager.removeForAgentTask(
        makeTask({ worktreePath: `${TEST_WORKTREES_DIR}/project/task-a` }),
      );

      assert.equal(harness.removeCalls[0]?.force, false);
      assert.equal(harness.removeCalls[0]?.path, `${TEST_WORKTREES_DIR}/project/task-a`);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("refuses removal when task has no worktree", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      const error = yield* manager.removeForAgentTask(makeTask()).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.removeCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("refuses removal outside the configured worktree root", () => {
    const harness = makeHarness();

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      const error = yield* manager
        .removeForAgentTask(makeTask({ worktreePath: "/outside/task-a" }))
        .pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
      assert.deepStrictEqual(harness.removeCalls, []);
    }).pipe(Effect.provide(harness.layer));
  });

  it.effect("propagates VCS failures as dispatch errors", () => {
    const harness = makeHarness({
      createFailure: new GitCommandError({
        operation: "createWorktree",
        command: "git worktree add",
        cwd: "/workspace/project",
        detail: "boom",
      }),
    });

    return Effect.gen(function* () {
      const manager = yield* WorktreeManager;
      const error = yield* manager.createForAgentTask(makeTask()).pipe(Effect.flip);

      assert.instanceOf(error, OrchestrationDispatchCommandError);
    }).pipe(Effect.provide(harness.layer));
  });
});
