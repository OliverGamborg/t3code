import type { AgentContract, AgentPlan, AgentTask } from "@t3tools/contracts";

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
  readonly sharedDecisions: ReadonlyArray<{
    readonly title: string;
    readonly body: string;
  }>;
}

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
    "",
    "Return only JSON matching this shape:",
    JSON.stringify(
      {
        title: "Short plan title",
        summary: "What the coordinated work should accomplish",
        tasks: [
          {
            title: "Scoped worker task",
            description: "Concrete implementation scope",
            projectId: "project id",
            allowedPaths: ["path/prefix"],
            blockedPaths: ["path/prefix"],
            dependsOn: ["task title or id"],
            relatedTasks: ["task title or id"],
            requiredContracts: ["contract title"],
            producedContracts: ["contract title"],
            riskNotes: "Known risk or empty string",
          },
        ],
        contracts: [
          {
            type: "api | type | database | event | file_format | config | ui_behavior | other",
            title: "Shared contract title",
            description: "Shape, behavior, compatibility, and consumers",
            producerTaskTitle: "Task that owns this contract",
            consumerTaskTitles: ["Tasks that must consume it"],
          },
        ],
        reviewPlan: {
          mergeOrder: ["task title"],
          requiredChecks: ["check command or scenario"],
          risks: ["cross-task risk"],
        },
        openQuestions: ["question that blocks safe worker launch"],
      },
      null,
      2,
    ),
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
    "Report progress as structured updates. If scope or contracts are unclear, stop and report a blocker instead of guessing.",
  ].join("\n");
}
