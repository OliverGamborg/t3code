import type {
  AgentContract,
  AgentCoordinationMessage,
  AgentPlan,
  AgentSharedUpdate,
  AgentTask,
} from "@t3tools/contracts";

export interface OwnerPlanningPromptInput {
  readonly userPrompt: string;
  readonly projectSummaries: ReadonlyArray<{
    readonly projectId: string;
    readonly title: string;
    readonly workspaceRoot: string;
    readonly role?: string;
  }>;
}

export interface WorkerExecutionPromptInput {
  readonly plan: Pick<AgentPlan, "id" | "title" | "userPrompt">;
  readonly task: AgentTask;
  readonly relatedTasks: ReadonlyArray<AgentTask>;
  readonly contracts: ReadonlyArray<AgentContract>;
  readonly sharedDecisions: ReadonlyArray<Pick<AgentSharedUpdate, "title" | "body">>;
}

export interface OwnerWorkerReportPromptInput {
  readonly plan: Pick<AgentPlan, "id" | "title">;
  readonly task: AgentTask;
  readonly reportTitle: string;
  readonly reportBody: string;
  readonly contracts: ReadonlyArray<AgentContract>;
  readonly relatedMessages: ReadonlyArray<AgentCoordinationMessage>;
}

export interface WorkerMessagePromptInput {
  readonly plan: Pick<AgentPlan, "id" | "title">;
  readonly task: AgentTask;
  readonly kind: "progress_request" | "assignment" | "clarification_response" | "sync";
  readonly title: string;
  readonly body: string;
  readonly contracts: ReadonlyArray<AgentContract>;
  readonly sharedUpdates: ReadonlyArray<AgentSharedUpdate>;
}

export interface ReviewerPromptInput {
  readonly plan: AgentPlan;
  readonly workerSummaries: ReadonlyArray<{
    readonly task: AgentTask;
    readonly updates: ReadonlyArray<AgentSharedUpdate>;
  }>;
}

const ownerPlanExample = {
  schema: "t3.agent.owner_plan.v1",
  title: "Short plan title",
  summary: "What the coordinated work should accomplish",
  tasks: [
    {
      taskKey: "backend_api",
      title: "Scoped worker task",
      description: "Concrete implementation scope",
      projectId: "project id",
      allowedPaths: ["path/prefix"],
      blockedPaths: ["path/prefix"],
      dependsOn: ["shared_types"],
      relatedTasks: ["frontend_consumer"],
      requiredContracts: ["search_response"],
      producedContracts: ["search_response"],
      riskNotes: "Known risk or empty string",
    },
  ],
  contracts: [
    {
      contractKey: "search_response",
      type: "api",
      title: "Shared contract title",
      description: "Shape, behavior, compatibility, and consumers",
      producerTaskKey: "backend_api",
      consumerTaskKeys: ["frontend_consumer"],
    },
  ],
  reviewPlan: {
    mergeOrder: ["backend_api"],
    requiredChecks: ["vp check"],
    risks: ["cross-task risk"],
  },
  openQuestions: ["question that blocks safe worker launch"],
};

const workerReportExample = {
  schema: "t3.agent.worker_report.v1",
  status: "progress",
  title: "Short worker update",
  summary: "What changed or what is blocked",
  details: "Relevant implementation details, files, commands, and decisions.",
  requiresOwnerResponse: false,
  changedContracts: [],
  testResults: ["vp test run ... passed"],
  blockers: [],
  nextSuggestedAction: null,
};

const ownerRoutingExample = {
  schema: "t3.agent.owner_routing.v1",
  summary: "How the owner interpreted the worker report.",
  routeMessages: [
    {
      targetTaskKeys: ["frontend_consumer"],
      targetTaskIds: [],
      kind: "sync",
      title: "Backend contract updated",
      body: "Use the accepted response shape from the backend task.",
      requiresResponse: false,
    },
  ],
  taskUpdates: [],
  contractUpdates: [],
  askUser: null,
  readyForReview: false,
};

const reviewerExample = {
  schema: "t3.agent.review.v1",
  status: "warning",
  summary: "Merge recommendation.",
  mergeOrder: ["agent-task-id"],
  requiredFixes: [],
  risks: ["Risk to verify before merge."],
  testRecommendations: ["vp check", "vp run typecheck"],
};

export function buildOwnerPlanningPrompt(input: OwnerPlanningPromptInput): string {
  const projects = input.projectSummaries
    .map(
      (project) =>
        `- ${project.title} (${project.projectId})\n  root: ${project.workspaceRoot}${
          project.role ? `\n  role: ${project.role}` : ""
        }`,
    )
    .join("\n");

  return [
    "You are the owner agent for a coordinated coding task.",
    "",
    "Inspect the request and produce a structured implementation plan. Do not perform implementation edits.",
    "Return exactly one fenced JSON block tagged t3-agent-owner-plan. Do not include prose outside the block.",
    "",
    "Required JSON shape:",
    "```t3-agent-owner-plan",
    JSON.stringify(ownerPlanExample, null, 2),
    "```",
    "",
    "Projects:",
    projects || "- No projects were provided.",
    "",
    "User request:",
    input.userPrompt,
  ].join("\n");
}

export function buildWorkerExecutionPrompt(input: WorkerExecutionPromptInput): string {
  return [
    `Plan: ${input.plan.title} (${input.plan.id})`,
    `Task: ${input.task.title} (${input.task.id})`,
    "",
    input.task.description,
    "",
    "Allowed paths:",
    input.task.allowedPaths.length > 0
      ? input.task.allowedPaths.map((path) => `- ${path}`).join("\n")
      : "- No explicit allowed paths were provided. Stay within the task scope.",
    "",
    "Blocked paths:",
    input.task.blockedPaths.length > 0
      ? input.task.blockedPaths.map((path) => `- ${path}`).join("\n")
      : "- None.",
    "",
    "Related tasks:",
    input.relatedTasks.length > 0
      ? input.relatedTasks.map((task) => `- ${task.title}: ${task.description}`).join("\n")
      : "- None.",
    "",
    "Shared contracts:",
    input.contracts.length > 0
      ? input.contracts
          .map((contract) => `- ${contract.title} (${contract.status}): ${contract.description}`)
          .join("\n")
      : "- None.",
    "",
    "Known shared decisions:",
    input.sharedDecisions.length > 0
      ? input.sharedDecisions.map((update) => `- ${update.title}: ${update.body}`).join("\n")
      : "- None.",
    "",
    "Do not coordinate directly with other workers. Publish updates for the owner to route.",
    "Finish every response with exactly one fenced JSON block tagged t3-agent-worker-report.",
    "",
    "Required report shape:",
    "```t3-agent-worker-report",
    JSON.stringify(workerReportExample, null, 2),
    "```",
  ].join("\n");
}

export function buildOwnerWorkerReportPrompt(input: OwnerWorkerReportPromptInput): string {
  return [
    `Plan: ${input.plan.title} (${input.plan.id})`,
    `Worker task: ${input.task.title} (${input.task.id})`,
    "",
    "A worker published this report:",
    `Title: ${input.reportTitle}`,
    input.reportBody,
    "",
    "Relevant contracts:",
    input.contracts.length > 0
      ? input.contracts.map((contract) => `- ${contract.title}: ${contract.description}`).join("\n")
      : "- None.",
    "",
    "Recent routed coordination messages:",
    input.relatedMessages.length > 0
      ? input.relatedMessages.map((message) => `- ${message.title}: ${message.body}`).join("\n")
      : "- None.",
    "",
    "Decide whether dependent workers need sync messages, whether this task needs follow-up, or whether the user must answer a question.",
    "Return exactly one fenced JSON block tagged t3-agent-owner-routing.",
    "",
    "Required JSON shape:",
    "```t3-agent-owner-routing",
    JSON.stringify(ownerRoutingExample, null, 2),
    "```",
  ].join("\n");
}

export function buildWorkerProgressRequestPrompt(input: WorkerMessagePromptInput): string {
  return buildWorkerMessagePrompt({ ...input, kind: "progress_request" });
}

export function buildWorkerAssignmentPrompt(input: WorkerMessagePromptInput): string {
  return buildWorkerMessagePrompt({ ...input, kind: "assignment" });
}

export function buildWorkerMessagePrompt(input: WorkerMessagePromptInput): string {
  return [
    `Plan: ${input.plan.title} (${input.plan.id})`,
    `Task: ${input.task.title} (${input.task.id})`,
    `Message kind: ${input.kind}`,
    "",
    input.title,
    "",
    input.body,
    "",
    "Current accepted/proposed contracts:",
    input.contracts.length > 0
      ? input.contracts.map((contract) => `- ${contract.title}: ${contract.description}`).join("\n")
      : "- None.",
    "",
    "Recent shared updates:",
    input.sharedUpdates.length > 0
      ? input.sharedUpdates.map((update) => `- ${update.title}: ${update.body}`).join("\n")
      : "- None.",
    "",
    "Respond with work or status, then finish with exactly one fenced JSON block tagged t3-agent-worker-report.",
    "```t3-agent-worker-report",
    JSON.stringify(workerReportExample, null, 2),
    "```",
  ].join("\n");
}

export function buildReviewerPrompt(input: ReviewerPromptInput): string {
  const taskSummaries = input.workerSummaries
    .map(({ task, updates }) =>
      [
        `- ${task.title} (${task.id})`,
        `  status: ${task.status}`,
        `  branch: ${task.branchName ?? "none"}`,
        `  worktree: ${task.worktreePath ?? "none"}`,
        `  summary: ${task.summary ?? "none"}`,
        ...updates.map((update) => `  update: ${update.title}: ${update.body}`),
      ].join("\n"),
    )
    .join("\n");

  return [
    `Review coordinated implementation plan: ${input.plan.title} (${input.plan.id})`,
    "",
    "User request:",
    input.plan.userPrompt,
    "",
    "Tasks and worker updates:",
    taskSummaries || "- No worker summaries.",
    "",
    "Contracts:",
    input.plan.contracts.length > 0
      ? input.plan.contracts
          .map((contract) => `- ${contract.title} (${contract.status}): ${contract.description}`)
          .join("\n")
      : "- None.",
    "",
    "Inspect compatibility, risks, changed contracts, and merge order. Do not merge.",
    "Return exactly one fenced JSON block tagged t3-agent-review.",
    "",
    "Required JSON shape:",
    "```t3-agent-review",
    JSON.stringify(reviewerExample, null, 2),
    "```",
  ].join("\n");
}
