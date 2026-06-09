import { AgentPlanId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AgentPlansPage } from "~/components/agentPlans/AgentPlansPage";

export const Route = createFileRoute("/agent-plans/$planId")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: AgentPlanRoute,
});

function AgentPlanRoute() {
  const { planId } = Route.useParams();
  return <AgentPlansPage planId={AgentPlanId.make(planId)} />;
}
