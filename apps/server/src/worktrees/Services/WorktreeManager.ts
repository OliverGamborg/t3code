import type { AgentPlanId, AgentTask, OrchestrationDispatchCommandError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export interface AgentTaskWorktreeResult {
  readonly planId: AgentPlanId;
  readonly taskId: AgentTask["id"];
  readonly branchName: string;
  readonly worktreePath: string;
}

export interface WorktreeManagerShape {
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
