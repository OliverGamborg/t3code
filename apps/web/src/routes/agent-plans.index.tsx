import { createFileRoute } from "@tanstack/react-router";

import { AgentPlansPage } from "~/components/agentPlans/AgentPlansPage";

export const Route = createFileRoute("/agent-plans/")({
  component: AgentPlansPage,
});
