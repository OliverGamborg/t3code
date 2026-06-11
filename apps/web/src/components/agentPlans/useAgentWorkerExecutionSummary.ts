import { useMemo } from "react";

import { deriveWorkLogEntries } from "~/session-logic";
import type { Thread, TurnDiffFileChange } from "~/types";

export interface AgentWorkerExecutionSummary {
  readonly changedFiles: ReadonlyArray<TurnDiffFileChange>;
  readonly recentCommands: ReturnType<typeof deriveWorkLogEntries>;
  readonly logEntries: ReturnType<typeof deriveWorkLogEntries>;
}

export function useAgentWorkerExecutionSummary(thread: Thread | null): AgentWorkerExecutionSummary {
  return useMemo(() => deriveAgentWorkerExecutionSummary(thread), [thread]);
}

export function deriveAgentWorkerExecutionSummary(
  thread: Thread | null,
): AgentWorkerExecutionSummary {
  if (!thread) {
    return {
      changedFiles: [],
      recentCommands: [],
      logEntries: [],
    };
  }

  const fileByPath = new Map<string, TurnDiffFileChange>();
  for (const summary of thread.turnDiffSummaries) {
    for (const file of summary.files) {
      const existing = fileByPath.get(file.path);
      fileByPath.set(file.path, {
        path: file.path,
        kind: file.kind ?? existing?.kind,
        additions: (existing?.additions ?? 0) + (file.additions ?? 0),
        deletions: (existing?.deletions ?? 0) + (file.deletions ?? 0),
      });
    }
  }

  const workLogEntries = deriveWorkLogEntries(thread.activities);
  const recentCommands = workLogEntries
    .filter((entry) => entry.command || entry.rawCommand)
    .slice(-6)
    .toReversed();
  const logEntries = workLogEntries
    .filter((entry) => entry.detail && entry.detail.trim().length > 0)
    .slice(-6)
    .toReversed();

  return {
    changedFiles: [...fileByPath.values()].toSorted((left, right) =>
      left.path.localeCompare(right.path),
    ),
    recentCommands,
    logEntries,
  };
}
