import {
  AgentOwnerPlanOutput,
  AgentOwnerRoutingOutput,
  AgentReviewerOutput,
  AgentWorkerReport,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

export class AgentStructuredOutputParseError extends Data.TaggedError(
  "AgentStructuredOutputParseError",
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const decodeUnknownJsonString = Schema.decodeUnknownEffect(Schema.UnknownFromJsonString);

function extractFencedBlock(text: string, marker: string): string | null {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\`\`\`${escapedMarker}\\s*\\n([\\s\\S]*?)\\n\`\`\``, "i");
  return pattern.exec(text)?.[1]?.trim() ?? null;
}

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) {
    return null;
  }
  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseUnknownJson(
  text: string,
  marker: string,
): Effect.Effect<unknown, AgentStructuredOutputParseError> {
  const jsonText = extractFencedBlock(text, marker) ?? extractJsonObject(text);
  if (jsonText === null) {
    return Effect.fail(
      new AgentStructuredOutputParseError({
        message: `No JSON output found for ${marker}.`,
      }),
    );
  }
  return decodeUnknownJsonString(jsonText).pipe(
    Effect.mapError(
      (cause) =>
        new AgentStructuredOutputParseError({
          message: `Failed to parse JSON output for ${marker}.`,
          cause,
        }),
    ),
  );
}

const decodeOwnerPlanOutput = Schema.decodeUnknownExit(AgentOwnerPlanOutput);
const decodeWorkerReport = Schema.decodeUnknownExit(AgentWorkerReport);
const decodeOwnerRoutingOutput = Schema.decodeUnknownExit(AgentOwnerRoutingOutput);
const decodeReviewerOutput = Schema.decodeUnknownExit(AgentReviewerOutput);

function fromDecodeExit<A>(
  exit: Exit.Exit<A, unknown>,
  marker: string,
): Effect.Effect<A, AgentStructuredOutputParseError> {
  return Exit.isSuccess(exit)
    ? Effect.succeed(exit.value)
    : Effect.fail(
        new AgentStructuredOutputParseError({
          message: `JSON output did not match ${marker}.`,
          cause: exit.cause,
        }),
      );
}

export const parseOwnerPlanOutput = (text: string) =>
  parseUnknownJson(text, "t3-agent-owner-plan").pipe(
    Effect.flatMap((value) => fromDecodeExit(decodeOwnerPlanOutput(value), "t3-agent-owner-plan")),
  );

export const parseWorkerReport = (text: string) =>
  parseUnknownJson(text, "t3-agent-worker-report").pipe(
    Effect.flatMap((value) => fromDecodeExit(decodeWorkerReport(value), "t3-agent-worker-report")),
  );

export const parseOwnerRoutingOutput = (text: string) =>
  parseUnknownJson(text, "t3-agent-owner-routing").pipe(
    Effect.flatMap((value) =>
      fromDecodeExit(decodeOwnerRoutingOutput(value), "t3-agent-owner-routing"),
    ),
  );

export const parseReviewerOutput = (text: string) =>
  parseUnknownJson(text, "t3-agent-review").pipe(
    Effect.flatMap((value) => fromDecodeExit(decodeReviewerOutput(value), "t3-agent-review")),
  );
