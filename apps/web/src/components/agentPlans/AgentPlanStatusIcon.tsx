import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  Clock3Icon,
  PlayIcon,
  SquareIcon,
} from "lucide-react";
import type { AgentTaskStatus } from "@t3tools/contracts";

export function AgentTaskStatusIcon({ status }: { readonly status: AgentTaskStatus }) {
  switch (status) {
    case "done":
      return <CheckCircle2Icon className="size-4 text-emerald-500" />;
    case "running":
      return <PlayIcon className="size-4 text-emerald-500" />;
    case "blocked":
    case "failed":
      return <AlertCircleIcon className="size-4 text-red-500" />;
    case "pending":
      return <Clock3Icon className="size-4 text-amber-500" />;
    case "cancelled":
      return <SquareIcon className="size-4 text-muted-foreground" />;
  }
}

export function ProgressCheckIcon({ done }: { readonly done: boolean }) {
  return done ? (
    <CheckCircle2Icon className="size-3.5 text-emerald-500" />
  ) : (
    <CircleIcon className="size-3.5 text-muted-foreground" />
  );
}
