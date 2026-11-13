import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  ProviderInstanceId,
  type ModelSelection,
  type ServerSettings,
} from "@t3tools/contracts";
import type { UiAssistantPlanInput } from "@t3tools/provider-core/server/textGeneration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";

import * as ServerSettingsModule from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as UiAssistant from "./UiAssistant.ts";

const haiku: ModelSelection = {
  instanceId: ProviderInstanceId.make("claudeAgent"),
  model: "claude-haiku-5-5",
};

const planWith = (settings: ServerSettings) => {
  const calls: Array<UiAssistantPlanInput> = [];
  const dependencies = Layer.mergeAll(
    NodeServices.layer,
    Layer.mock(ServerSettingsModule.ServerSettingsService)({
      getSettings: Effect.succeed(settings),
    }),
    Layer.succeed(
      TextGeneration.TextGeneration,
      TextGeneration.TextGeneration.of({
        generateCommitMessage: () => Effect.die("not used"),
        generatePrContent: () => Effect.die("not used"),
        generateBranchName: () => Effect.die("not used"),
        generateThreadTitle: () => Effect.die("not used"),
        generateReviewGuide: () => Effect.die("not used"),
        generateTranscriptionPostProcessing: () => Effect.die("not used"),
        generateUiAssistantPlan: (input) => {
          calls.push(input);
          return Effect.succeed({ commands: [{ command: "terminal.show" }], reply: "" });
        },
      }),
    ),
  );
  return Effect.gen(function* () {
    const assistant = yield* UiAssistant.UiAssistant;
    const plan = yield* assistant.plan({
      prompt: "terminal at the bottom",
      layout: "Terminal drawer: hidden.",
      history: [{ prompt: "open the diff", reply: "" }],
    });
    return { plan, calls };
  }).pipe(Effect.provide(UiAssistant.layer.pipe(Layer.provide(dependencies))));
};

it.effect("plans with the layout assistant model, or the text generation model when unset", () =>
  Effect.gen(function* () {
    const own = yield* planWith({ ...DEFAULT_SERVER_SETTINGS, uiAssistantModelSelection: haiku });
    expect(own.plan.commands).toEqual([{ command: "terminal.show" }]);
    expect(own.calls[0]?.modelSelection).toEqual(haiku);
    expect(own.calls[0]?.prompt).toContain("Terminal drawer: hidden.");
    expect(own.calls[0]?.prompt).toContain('- "open the diff"');
    expect(own.calls[0]?.prompt).toMatch(/Request:\nterminal at the bottom$/);

    const followed = yield* planWith(DEFAULT_SERVER_SETTINGS);
    expect(followed.calls[0]?.modelSelection).toEqual(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
  }),
);
