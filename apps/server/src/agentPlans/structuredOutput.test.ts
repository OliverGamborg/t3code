import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { parseOwnerPlanOutput } from "./structuredOutput.ts";

const ownerPlanJson = JSON.stringify({
  schema: "t3.agent.owner_plan.v1",
  title: "Owner worker plan",
  summary: "Split the work into worker tasks.",
  tasks: [],
  contracts: [],
  reviewPlan: {
    mergeOrder: [],
    requiredChecks: [],
    risks: [],
  },
  openQuestions: [],
});

describe("structured output parsing", () => {
  it.effect("parses owner output from a generic JSON fence", () =>
    parseOwnerPlanOutput(`Here is the plan:\n\n\`\`\`json\n${ownerPlanJson}\n\`\`\``).pipe(
      Effect.map((output) => {
        assert.equal(output.schema, "t3.agent.owner_plan.v1");
        assert.equal(output.title, "Owner worker plan");
      }),
    ),
  );

  it.effect("parses owner output from an XML-style marker", () =>
    parseOwnerPlanOutput(`<t3-agent-owner-plan>${ownerPlanJson}</t3-agent-owner-plan>`).pipe(
      Effect.map((output) => {
        assert.equal(output.summary, "Split the work into worker tasks.");
      }),
    ),
  );

  it.effect("prefers schema-matching fenced JSON over unrelated raw JSON", () =>
    parseOwnerPlanOutput(`{"note":"ignore this"}\n\n\`\`\`json\n${ownerPlanJson}\n\`\`\``).pipe(
      Effect.map((output) => {
        assert.equal(output.schema, "t3.agent.owner_plan.v1");
      }),
    ),
  );
});
