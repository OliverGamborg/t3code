import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_plans (
      plan_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      user_prompt TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_thread_id TEXT,
      primary_project_id TEXT,
      project_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_plans_updated
    ON projection_agent_plans(deleted_at, updated_at DESC, plan_id ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_tasks (
      task_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      project_id TEXT NOT NULL,
      worker_thread_id TEXT,
      worktree_path TEXT,
      branch_name TEXT,
      allowed_paths_json TEXT NOT NULL,
      blocked_paths_json TEXT NOT NULL,
      depends_on_json TEXT NOT NULL,
      related_task_ids_json TEXT NOT NULL,
      required_contract_ids_json TEXT NOT NULL,
      produced_contract_ids_json TEXT NOT NULL,
      assigned_provider TEXT,
      summary TEXT,
      risk_notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_tasks_plan_created
    ON projection_agent_tasks(plan_id, created_at ASC, task_id ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_shared_updates (
      update_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      task_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      visibility TEXT NOT NULL,
      related_task_ids_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_shared_updates_plan_created
    ON projection_agent_shared_updates(plan_id, created_at ASC, update_id ASC)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_contracts (
      contract_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      producer_task_id TEXT,
      consumer_task_ids_json TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_contracts_plan_created
    ON projection_agent_contracts(plan_id, created_at ASC, contract_id ASC)
  `;
});
