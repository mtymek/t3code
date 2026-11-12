import { ProviderThreadEnvironment } from "@t3tools/provider-core/server/threadEnvironment";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { JjThreadLayer } from "../jj/JjThreadLayer.ts";

/** Gives per-thread provider processes the thread's jj config layer (patches/jujutsu.md). */
export const layer = Layer.effect(
  ProviderThreadEnvironment,
  Effect.gen(function* () {
    const threadLayer = yield* JjThreadLayer;
    return {
      forThread: threadLayer.environmentFor,
      forOpenCodeServer: Effect.fn("ProviderThreadEnvironment.forOpenCodeServer")(
        function (threadId, environment) {
          return threadLayer
            .environmentFor(threadId)
            .pipe(Effect.map((threadEnvironment) => ({ ...environment, ...threadEnvironment })));
        },
      ),
    };
  }),
);
