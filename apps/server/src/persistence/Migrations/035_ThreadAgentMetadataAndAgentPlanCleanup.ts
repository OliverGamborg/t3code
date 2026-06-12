import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "agent_metadata_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN agent_metadata_json TEXT NOT NULL DEFAULT '{"role":"user","parentThreadId":null,"delegationId":null,"taskKey":null,"taskTitle":null,"taskStatus":null}'
    `;
  }

  yield* sql`DROP TABLE IF EXISTS projection_agent_reviews`;
  yield* sql`DROP TABLE IF EXISTS projection_agent_coordination_messages`;
  yield* sql`DROP TABLE IF EXISTS projection_agent_contracts`;
  yield* sql`DROP TABLE IF EXISTS projection_agent_shared_updates`;
  yield* sql`DROP TABLE IF EXISTS projection_agent_tasks`;
  yield* sql`DROP TABLE IF EXISTS projection_agent_plans`;
});
