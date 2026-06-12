import type {
  AgentPlanId,
  AgentTask,
  OrchestrationDispatchCommandError,
  ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface WorkerWorktreeInput {
  readonly projectId: ProjectId;
  readonly delegationId: string;
  readonly taskKey: string;
  readonly title: string;
}

export interface WorkerWorktreeResult {
  readonly branchName: string;
  readonly worktreePath: string;
}

export interface RemoveWorkerWorktreeInput {
  readonly projectId: ProjectId;
  readonly worktreePath: string;
}

export interface AgentTaskWorktreeResult {
  readonly planId: AgentPlanId;
  readonly taskId: AgentTask["id"];
  readonly branchName: string;
  readonly worktreePath: string;
}

export interface WorktreeManagerShape {
  readonly createForWorker: (
    input: WorkerWorktreeInput,
  ) => Effect.Effect<WorkerWorktreeResult, OrchestrationDispatchCommandError>;
  readonly removeForWorker: (
    input: RemoveWorkerWorktreeInput,
  ) => Effect.Effect<void, OrchestrationDispatchCommandError>;
  readonly createForAgentTask: (
    task: AgentTask,
  ) => Effect.Effect<AgentTaskWorktreeResult, OrchestrationDispatchCommandError>;
  readonly removeForAgentTask: (
    task: AgentTask,
  ) => Effect.Effect<void, OrchestrationDispatchCommandError>;
}

export class WorktreeManager extends Context.Service<WorktreeManager, WorktreeManagerShape>()(
  "t3/worktrees/Services/WorktreeManager",
) {}
