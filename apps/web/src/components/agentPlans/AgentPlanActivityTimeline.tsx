import { AlertCircleIcon, CheckCircle2Icon, PlayIcon, RotateCcwIcon } from "lucide-react";

import type { AgentCoordinationMessage } from "@t3tools/contracts";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  canRetryMessage,
  formatTime,
  makeActivity,
  type AgentPlan,
  type AgentActivityItemModel,
} from "./agentPlanPresentation";

export function AgentPlanActivityTimeline({
  busy,
  onRetryMessage,
  plan,
}: {
  readonly busy: boolean;
  readonly onRetryMessage: (message: AgentCoordinationMessage) => void;
  readonly plan: AgentPlan;
}) {
  const activity = makeActivity(plan.sharedUpdates, plan.coordinationMessages, plan.reviews);

  return (
    <section className="rounded-md border border-border bg-card/45">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Owner activity</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Summary updates from owner, workers, coordination, and review
          </p>
        </div>
        <Badge variant="outline">{activity.length} events</Badge>
      </div>
      <div className="space-y-3 p-4">
        {activity.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
            No owner activity yet.
          </p>
        ) : (
          activity.map((item) => (
            <ActivityItem busy={busy} item={item} key={item.id} onRetryMessage={onRetryMessage} />
          ))
        )}
      </div>
    </section>
  );
}

function ActivityItem({
  busy,
  item,
  onRetryMessage,
}: {
  readonly busy: boolean;
  readonly item: AgentActivityItemModel;
  readonly onRetryMessage: (message: AgentCoordinationMessage) => void;
}) {
  const failed = item.status === "failed" || item.type === "blocker" || item.type === "error";
  const complete = item.status === "acknowledged" || item.type === "completion";
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <div className="relative flex justify-center pt-1">
        <div className="absolute bottom-[-0.75rem] top-7 border-l border-border" />
        <div
          className={`z-10 flex size-6 items-center justify-center rounded-full border ${
            failed
              ? "border-red-500/40 bg-red-500/10 text-red-500"
              : complete
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
                : "border-blue-500/40 bg-blue-500/10 text-blue-500"
          }`}
        >
          {failed ? (
            <AlertCircleIcon className="size-3.5" />
          ) : complete ? (
            <CheckCircle2Icon className="size-3.5" />
          ) : (
            <PlayIcon className="size-3.5" />
          )}
        </div>
      </div>
      <div className="rounded-md border border-border bg-background/60 px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{item.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{formatTime(item.at)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge size="sm" variant={failed ? "error" : "outline"}>
              {item.status ?? item.type}
            </Badge>
            {item.message && canRetryMessage(item.message) ? (
              <Button
                aria-label={`Retry ${item.message.title}`}
                disabled={busy}
                onClick={() => onRetryMessage(item.message!)}
                size="icon-xs"
                title="Retry message"
                variant="ghost"
              >
                <RotateCcwIcon />
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{item.body}</p>
      </div>
    </div>
  );
}
