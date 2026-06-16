import {
  DEFAULT_THREAD_AGENT_METADATA,
  ThreadId,
  WorkerReportActivityPayload,
  WorkerSpawnedActivityPayload,
  type ThreadAgentTaskStatus,
  type WorkerReportActivityPayload as WorkerReportActivityPayloadType,
  type WorkerSpawnedActivityPayload as WorkerSpawnedActivityPayloadType,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import type { Thread } from "./types";

const isWorkerReportActivityPayload = Schema.is(WorkerReportActivityPayload);
const isWorkerSpawnedActivityPayload = Schema.is(WorkerSpawnedActivityPayload);

export type WorkerThreadReport = WorkerReportActivityPayloadType & {
  readonly createdAt: string;
};

export function readWorkerReportPayload(payload: unknown): WorkerReportActivityPayloadType | null {
  return isWorkerReportActivityPayload(payload) ? payload : null;
}

export function readWorkerSpawnedPayload(
  payload: unknown,
): WorkerSpawnedActivityPayloadType | null {
  return isWorkerSpawnedActivityPayload(payload) ? payload : null;
}

export function latestWorkerReport(
  ownerThread: Thread,
  workerThreadId: ThreadId,
): WorkerThreadReport | null {
  for (let index = ownerThread.activities.length - 1; index >= 0; index -= 1) {
    const activity = ownerThread.activities[index];
    if (!activity || activity.kind !== "worker.report") {
      continue;
    }
    const payload = readWorkerReportPayload(activity.payload);
    if (!payload || payload.workerThreadId !== workerThreadId) {
      continue;
    }
    return {
      ...payload,
      createdAt: activity.createdAt,
    };
  }
  return null;
}

export function resolveWorkerStatus(
  ownerThread: Thread,
  workerThread: Thread,
): ThreadAgentTaskStatus {
  const metadata = workerThread.agentMetadata ?? DEFAULT_THREAD_AGENT_METADATA;
  return (
    latestWorkerReport(ownerThread, workerThread.id)?.status ?? metadata.taskStatus ?? "running"
  );
}

export function workerStatusClassName(status: ThreadAgentTaskStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "blocked":
    case "failed":
      return "border-destructive/35 bg-destructive/10 text-destructive";
    case "cancelled":
      return "border-muted-foreground/25 bg-muted text-muted-foreground";
    case "running":
      return "border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300";
  }
}
