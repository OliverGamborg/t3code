import { MessageId, type EnvironmentId } from "@t3tools/contracts";
import { Loader2Icon, SendIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { readEnvironmentApi } from "~/environmentApi";
import { newCommandId, randomUUID } from "~/lib/utils";
import type { Thread } from "~/types";
import { isThreadIdle, type AgentPlan } from "./agentPlanPresentation";

export function AgentPlanOwnerComposer({
  environmentId,
  ownerThread,
  plan,
}: {
  readonly environmentId: EnvironmentId | null | undefined;
  readonly ownerThread: Thread | null;
  readonly plan: AgentPlan;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = text.trim();
  const disabledReason = resolveDisabledReason(plan, ownerThread, environmentId);

  const send = async () => {
    if (!environmentId || !ownerThread || disabledReason || trimmed.length === 0) return;
    const api = readEnvironmentApi(environmentId);
    if (!api) {
      setError("Environment connection is not ready.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: ownerThread.id,
        message: {
          messageId: MessageId.make(randomUUID()),
          role: "user",
          text: trimmed,
          attachments: [],
        },
        modelSelection: ownerThread.modelSelection,
        runtimeMode: ownerThread.runtimeMode,
        interactionMode: ownerThread.interactionMode,
        titleSeed: plan.title,
        createdAt: new Date().toISOString(),
      });
      setText("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Failed to send owner message.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-md border border-border bg-card/55 p-3">
      <Textarea
        className="min-h-24 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
        disabled={Boolean(disabledReason) || sending}
        onChange={(event) => setText(event.currentTarget.value)}
        placeholder="Ask owner anything, request rerouting, or summarize next actions..."
        value={text}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          {disabledReason ?? "Message goes to the owner controller thread."}
        </p>
        <Button
          disabled={Boolean(disabledReason) || sending || trimmed.length === 0}
          onClick={send}
        >
          {sending ? <Loader2Icon className="animate-spin" /> : <SendIcon />}
          Send to owner
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}

function resolveDisabledReason(
  plan: AgentPlan,
  ownerThread: Thread | null,
  environmentId: EnvironmentId | null | undefined,
): string | null {
  if (!environmentId) return "Environment connection is not ready.";
  if (!plan.ownerThreadId) return "Start owner planning before sending owner messages.";
  if (!ownerThread) return "Loading owner thread.";
  if (!isThreadIdle(ownerThread)) return "Owner thread is busy.";
  return null;
}
