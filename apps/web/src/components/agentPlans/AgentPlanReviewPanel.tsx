import { ExternalLinkIcon } from "lucide-react";
import type { AgentReview, AgentTask, EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

export function AgentPlanReviewPanel({
  environmentId,
  reviews,
  tasks,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly reviews: ReadonlyArray<AgentReview>;
  readonly tasks: ReadonlyArray<AgentTask>;
}) {
  const review =
    reviews.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
  const taskTitle = (taskId: AgentTask["id"]) =>
    tasks.find((task) => task.id === taskId)?.title ?? String(taskId);

  return (
    <section className="rounded-md border border-border bg-card/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Review</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Reviewer recommendations before merge.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              review
                ? review.status === "failed"
                  ? "error"
                  : review.status === "passed"
                    ? "success"
                    : "warning"
                : "outline"
            }
          >
            {review?.status ?? "not started"}
          </Badge>
          {review?.reviewerThreadId && environmentId ? (
            <Button
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId, threadId: review.reviewerThreadId }}
                />
              }
              size="sm"
              variant="outline"
            >
              <ExternalLinkIcon />
              Open reviewer
            </Button>
          ) : null}
        </div>
      </div>
      {!review ? (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
          Review has not started.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <ReviewList title="Merge order" values={review.mergeOrder.map(taskTitle)} />
          <ReviewList title="Required fixes" values={review.requiredFixes} />
          <ReviewList title="Risks" values={review.risks} />
          <ReviewList title="Tests" values={review.testRecommendations} />
        </div>
      )}
    </section>
  );
}

function ReviewList({
  title,
  values,
}: {
  readonly title: string;
  readonly values: ReadonlyArray<string>;
}) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <h3 className="text-xs font-semibold text-muted-foreground">{title}</h3>
      {values.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">None</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {values.map((value) => (
            <li className="truncate" key={value}>
              {value}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
