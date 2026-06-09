# Agent Plan Orchestration Review Todo

Branch review against local `main...HEAD` after the owner/worker orchestration alpha and mission-control UI work.

## High Priority

- [ ] Persist task approval before launch.
  - `apps/server/src/agentPlans/Layers/AgentPlanService.ts`
  - `packages/contracts/src/agentPlan.ts`
  - Current `approveAgentPlanTasks` validates path overlap but does not record approval. `launchReadyWorkers` can launch imported `pending` tasks directly, so the intended edit/approve/launch workflow can be bypassed.
  - Add an explicit approval marker or state, persist it from approval, and require it before user-triggered worker launch.

- [ ] Share hardened worker launch cleanup with the coordination reactor.
  - `apps/server/src/agentPlans/Layers/AgentCoordinationReactor.ts`
  - `apps/server/src/agentPlans/Layers/AgentPlanService.ts`
  - The reactor has a separate dependent-task launch path that creates worktrees, worker threads, task updates, and turns without the cleanup/error recording implemented in the service launch flow.
  - Extract a common internal launch helper or add equivalent cleanup/risk recording to the reactor path.

## Medium Priority

- [ ] Reject duplicate and slug-colliding owner task/contract keys during import.
  - `apps/server/src/agentPlans/Layers/AgentPlanService.ts`
  - Owner import derives deterministic task and contract IDs from keys, then builds maps without uniqueness checks. Duplicate keys or keys that slugify to the same ID can silently overwrite tasks/contracts.
  - Validate raw key uniqueness and derived ID uniqueness before dispatching any upserts.

- [ ] Use one shared task/contract ID derivation helper.
  - `apps/server/src/agentPlans/Layers/AgentPlanService.ts`
  - `apps/server/src/agentPlans/Layers/AgentCoordinationReactor.ts`
  - Import and owner routing currently derive task IDs differently, so owner `targetTaskKeys` can fail to match imported tasks for long or punctuation-heavy keys.
  - Extract shared helper logic and record an error/risk update when owner routing targets an unknown task key.

- [ ] Tighten action availability and disabled reasons in the agent-plan UI.
  - `apps/web/src/components/agentPlans/AgentPlanActionMenu.tsx`
  - `apps/web/src/components/agentPlans/AgentPlansPage.tsx`
  - Several actions are enabled until the RPC rejects them, including import without an owner thread, launch with no launchable tasks, and review in invalid states.
  - Compute action availability from plan status, task state, owner thread state, review state, and import mode. Use exact disabled reasons in the menu.

## Lower Priority

- [ ] Restrict task editing to pending unlaunched tasks.
  - `apps/web/src/components/agentPlans/AgentPlanWorkerInspector.tsx`
  - Editing is currently enabled when a task is pending or the plan is awaiting approval. That can expose editing for cancelled or otherwise non-pending tasks during approval.
  - Require `status === "pending"` and `workerThreadId === null`.

- [ ] Include all agent-plan shell counters in store equality.
  - `apps/web/src/store.ts`
  - `packages/contracts/src/agentPlan.ts`
  - `coordinationMessageCount` and `reviewCount` exist on `AgentPlanShell` but are omitted from shell equality, which can leave sidebar/list summaries stale in edge cases.
  - Add both fields to equality checks and cover with a store test.
