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

interface JsonCandidate {
  readonly text: string;
  readonly score: number;
}

const schemaLiteralByMarker: Record<string, string> = {
  "t3-agent-owner-plan": "t3.agent.owner_plan.v1",
  "t3-agent-worker-report": "t3.agent.worker_report.v1",
  "t3-agent-owner-routing": "t3.agent.owner_routing.v1",
  "t3-agent-review": "t3.agent.review.v1",
};

function extractTaggedBlocks(text: string, marker: string): JsonCandidate[] {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<\\s*${escapedMarker}\\s*>\\s*([\\s\\S]*?)\\s*<\\s*/\\s*${escapedMarker}\\s*>`,
    "gi",
  );
  const candidates: JsonCandidate[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1]?.trim();
    if (value) {
      candidates.push({ text: value, score: 95 });
    }
  }
  return candidates;
}

function extractFencedBlocks(text: string, marker: string): JsonCandidate[] {
  const schemaLiteral = schemaLiteralByMarker[marker] ?? marker;
  const candidates: JsonCandidate[] = [];
  const pattern = /```([^\r\n`]*)\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(pattern)) {
    const info = match[1]?.trim().toLowerCase() ?? "";
    const value = match[2]?.trim();
    if (!value) continue;

    const score =
      info === marker
        ? 100
        : info.includes(marker)
          ? 90
          : value.includes(schemaLiteral)
            ? info.includes("json")
              ? 80
              : 70
            : info.includes("json")
              ? 50
              : 20;
    candidates.push({ text: value, score });
  }
  return candidates;
}

function extractBalancedJsonObjects(text: string, marker: string): JsonCandidate[] {
  const schemaLiteral = schemaLiteralByMarker[marker] ?? marker;
  const trimmed = text.trim();
  const candidates: JsonCandidate[] = [];
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (startIndex < 0) {
      if (char === "{") {
        startIndex = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char !== "}") {
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      const value = trimmed.slice(startIndex, index + 1).trim();
      candidates.push({
        text: value,
        score: value.includes(schemaLiteral) ? 65 : trimmed === value ? 45 : 35,
      });
      startIndex = -1;
    }
  }

  return candidates;
}

function extractJsonCandidates(text: string, marker: string): ReadonlyArray<string> {
  const candidates = [
    ...extractFencedBlocks(text, marker),
    ...extractTaggedBlocks(text, marker),
    ...extractBalancedJsonObjects(text, marker),
  ].toSorted((left, right) => right.score - left.score);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.text)) continue;
    seen.add(candidate.text);
    deduped.push(candidate.text);
  }
  return deduped;
}

function parseUnknownJson(
  text: string,
  marker: string,
): Effect.Effect<unknown, AgentStructuredOutputParseError> {
  return Effect.gen(function* () {
    const candidates = extractJsonCandidates(text, marker);
    if (candidates.length === 0) {
      return yield* new AgentStructuredOutputParseError({
        message: `No JSON output found for ${marker}.`,
      });
    }

    let cause: unknown = undefined;
    for (const candidate of candidates) {
      const exit = yield* Effect.exit(decodeUnknownJsonString(candidate));
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      cause = exit.cause;
    }

    return yield* new AgentStructuredOutputParseError({
      message: `Failed to parse JSON output for ${marker}.`,
      cause,
    });
  });
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
