import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_coordination_messages (
      message_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      from_role TEXT NOT NULL,
      from_task_id TEXT,
      from_thread_id TEXT,
      to_target TEXT NOT NULL,
      to_task_ids_json TEXT NOT NULL,
      to_thread_ids_json TEXT NOT NULL,
      source_message_id TEXT,
      source_turn_id TEXT,
      correlation_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      requires_response INTEGER NOT NULL,
      delivery_attempts INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      sent_at TEXT,
      acknowledged_at TEXT,
      failed_at TEXT,
      failure_reason TEXT
    )
  `;

  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projection_agent_coordination_dedupe
    ON projection_agent_coordination_messages(dedupe_key)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_coordination_plan_created
    ON projection_agent_coordination_messages(plan_id, created_at ASC, message_id ASC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_coordination_status_created
    ON projection_agent_coordination_messages(status, created_at ASC)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_coordination_source_message
    ON projection_agent_coordination_messages(source_message_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_agent_reviews (
      review_id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      reviewer_thread_id TEXT,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      merge_order_json TEXT NOT NULL,
      required_fixes_json TEXT NOT NULL,
      risks_json TEXT NOT NULL,
      test_recommendations_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_agent_reviews_plan_created
    ON projection_agent_reviews(plan_id, created_at ASC, review_id ASC)
  `;
});
