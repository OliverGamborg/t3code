import { OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../../config.ts";
import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { WorktreeManager, type WorktreeManagerShape } from "../Services/WorktreeManager.ts";

const isOrchestrationDispatchCommandError = Schema.is(OrchestrationDispatchCommandError);

const toWorktreeError = (cause: unknown, message: string) =>
  isOrchestrationDispatchCommandError(cause)
    ? cause
    : new OrchestrationDispatchCommandError({
        message: cause instanceof Error ? cause.message : message,
        cause,
      });

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug.length > 0 ? slug : "task";
}

function shortId(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-8)
      .toLowerCase() || "task"
  );
}

function taskBranchSegment(title: string, id: string): string {
  const suffix = `-${shortId(id)}`;
  const maxBaseLength = Math.max(1, 48 - suffix.length);
  const base = slugify(title).slice(0, maxBaseLength).replace(/-+$/g, "") || "task";
  return `${base}${suffix}`;
}

const make = Effect.gen(function* () {
  const gitWorkflow = yield* GitWorkflowService;
  const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
  const config = yield* ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const canonicalizePath = (value: string) =>
    fileSystem.realPath(path.resolve(value)).pipe(Effect.orElseSucceed(() => path.resolve(value)));

  const isWithinRoot = (candidate: string, root: string) => {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };

  const createForAgentTask: WorktreeManagerShape["createForAgentTask"] = (task) =>
    Effect.gen(function* () {
      const project = yield* projectionSnapshotQuery
        .getProjectShellById(task.projectId)
        .pipe(
          Effect.mapError((cause) =>
            toWorktreeError(cause, `Failed to load project ${task.projectId}.`),
          ),
        );
      if (Option.isNone(project)) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Project ${task.projectId} for task ${task.id} was not found.`,
          cause: task.projectId,
        });
      }

      const cwd = project.value.workspaceRoot;
      const status = yield* gitWorkflow
        .localStatus({ cwd })
        .pipe(
          Effect.mapError((cause) =>
            toWorktreeError(cause, `Failed to inspect Git status in ${cwd}.`),
          ),
        );
      if (!status.isRepo) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Project ${project.value.title} is not a Git repository.`,
          cause: cwd,
        });
      }
      if (status.hasWorkingTreeChanges) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Project ${project.value.title} must be clean before creating worker worktrees.`,
          cause: cwd,
        });
      }
      if (status.refName === null) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Project ${project.value.title} is detached and cannot create a worker branch.`,
          cause: cwd,
        });
      }

      const branchName = [
        "agent",
        slugify(String(task.planId)),
        taskBranchSegment(task.title, String(task.id)),
      ].join("/");
      const created = yield* gitWorkflow
        .createWorktree({
          cwd,
          refName: status.refName,
          newRefName: branchName,
          path: null,
        })
        .pipe(
          Effect.mapError((cause) =>
            toWorktreeError(cause, `Failed to create worktree for task ${task.id}.`),
          ),
        );

      return {
        planId: task.planId,
        taskId: task.id,
        branchName: created.worktree.refName,
        worktreePath: created.worktree.path,
      };
    });

  const removeForAgentTask: WorktreeManagerShape["removeForAgentTask"] = (task) =>
    Effect.gen(function* () {
      if (task.worktreePath === null) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Task ${task.id} has no worker worktree to remove.`,
          cause: task.id,
        });
      }
      const project = yield* projectionSnapshotQuery
        .getProjectShellById(task.projectId)
        .pipe(
          Effect.mapError((cause) =>
            toWorktreeError(cause, `Failed to load project ${task.projectId}.`),
          ),
        );
      if (Option.isNone(project)) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Project ${task.projectId} for task ${task.id} was not found.`,
          cause: task.projectId,
        });
      }
      const [candidatePath, worktreesRoot] = yield* Effect.all([
        canonicalizePath(task.worktreePath),
        canonicalizePath(config.worktreesDir),
      ]);
      if (!isWithinRoot(candidatePath, worktreesRoot)) {
        return yield* new OrchestrationDispatchCommandError({
          message: `Refusing to remove worktree outside configured worktree root: ${task.worktreePath}.`,
          cause: { worktreePath: task.worktreePath, worktreesRoot: config.worktreesDir },
        });
      }
      yield* gitWorkflow
        .removeWorktree({
          cwd: project.value.workspaceRoot,
          path: task.worktreePath,
          force: false,
        })
        .pipe(
          Effect.mapError((cause) =>
            toWorktreeError(cause, `Failed to remove worktree ${task.worktreePath}.`),
          ),
        );
    });

  return {
    createForAgentTask,
    removeForAgentTask,
  } satisfies WorktreeManagerShape;
});

export const WorktreeManagerLive = Layer.effect(WorktreeManager, make);
