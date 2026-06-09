import { useEffect, useState } from "react";
import type { AgentPlanDetailSnapshot, AgentPlanId, EnvironmentId } from "@t3tools/contracts";

import { readEnvironmentApi } from "~/environmentApi";

export function useAgentPlanDetail(
  environmentId: EnvironmentId | null | undefined,
  planId: AgentPlanId | null,
): {
  readonly snapshot: AgentPlanDetailSnapshot | null;
  readonly loading: boolean;
  readonly error: string | null;
} {
  const [snapshot, setSnapshot] = useState<AgentPlanDetailSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!environmentId || !planId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setSnapshot(null);
      setLoading(false);
      setError("Environment connection is not ready.");
      return;
    }

    let disposed = false;
    const refresh = () => {
      setLoading(true);
      setError(null);
      void api.orchestration
        .getAgentPlan({ planId })
        .then((nextSnapshot) => {
          if (!disposed) setSnapshot(nextSnapshot);
        })
        .catch((nextError: unknown) => {
          if (!disposed) {
            setError(nextError instanceof Error ? nextError.message : "Failed to load agent plan.");
          }
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    };

    refresh();
    const unsubscribe = api.orchestration.subscribeAgentPlan({ planId }, (item) => {
      if (item.kind === "snapshot") {
        setSnapshot(item.snapshot);
        setLoading(false);
        setError(null);
        return;
      }
      refresh();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [environmentId, planId]);

  return { snapshot, loading, error };
}
