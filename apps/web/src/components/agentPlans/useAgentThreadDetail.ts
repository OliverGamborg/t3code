import { scopeThreadRef } from "@t3tools/client-runtime";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";

import { retainThreadDetailSubscription } from "~/environments/runtime/service";
import { selectThreadByRef, useStore } from "~/store";
import type { Thread } from "~/types";

export function useAgentThreadDetail(
  environmentId: EnvironmentId | null | undefined,
  threadId: ThreadId | null | undefined,
): {
  readonly thread: Thread | null;
  readonly loading: boolean;
} {
  const threadRef = useMemo(
    () => (environmentId && threadId ? scopeThreadRef(environmentId, threadId) : null),
    [environmentId, threadId],
  );

  useEffect(() => {
    if (!environmentId || !threadId) return undefined;
    return retainThreadDetailSubscription(environmentId, threadId);
  }, [environmentId, threadId]);

  const thread = useStore(
    useMemo(
      () => (state) => (threadRef ? (selectThreadByRef(state, threadRef) ?? null) : null),
      [threadRef],
    ),
  );

  return {
    thread,
    loading: Boolean(threadId) && thread === null,
  };
}
