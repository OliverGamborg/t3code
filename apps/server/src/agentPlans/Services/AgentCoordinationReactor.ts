import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface AgentCoordinationReactorShape {
  readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  readonly drain: Effect.Effect<void>;
}

export class AgentCoordinationReactor extends Context.Service<
  AgentCoordinationReactor,
  AgentCoordinationReactorShape
>()("t3/agentPlans/Services/AgentCoordinationReactor") {}
