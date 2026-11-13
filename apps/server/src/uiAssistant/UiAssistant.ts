import {
  TextGenerationError,
  type UiAssistantPlan,
  type UiAssistantPlanInput,
} from "@t3tools/contracts";
import { resolveUiAssistantModelSelection } from "@t3tools/shared/serverSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";

export class UiAssistant extends Context.Service<
  UiAssistant,
  {
    readonly plan: (
      input: UiAssistantPlanInput,
    ) => Effect.Effect<UiAssistantPlan, TextGenerationError>;
  }
>()("t3/uiAssistant/UiAssistant") {}

const COMMANDS = `- {"command":"browser.open","url":string|null}: open a browser tab in the right panel, at url when given. Add "http://" to a bare host such as "localhost:5173".
- {"command":"rightPanel.open","kind":"diff"|"files"|"pull-requests"}: open that tab in the right panel.
- {"command":"rightPanel.hide"}: hide the right panel. Its tabs stay.
- {"command":"rightPanel.maximize","maximized":boolean}: make the right panel cover the chat, or stop covering it.
- {"command":"terminal.show"}: show the terminal drawer, starting a terminal if it has none.
- {"command":"terminal.hide"}: hide the terminal drawer. Its terminals keep running.
- {"command":"terminal.new","place":"drawer"|"panel"}: start another terminal in the drawer, or as a right-panel tab.
- {"command":"terminal.split","place":"drawer"|"panel","direction":"right"|"down"}: start a terminal beside ("right") or below ("down") the active one. "panel" needs a terminal tab to be the active right-panel tab.
- {"command":"terminal.resize","height":number}: set the drawer height in pixels.`;

function buildUiAssistantPrompt(input: UiAssistantPlanInput): string {
  const history =
    input.history.length === 0
      ? "None."
      : input.history
          .map(
            (exchange) =>
              `- ${JSON.stringify(exchange.prompt)}${exchange.reply ? ` -> ${JSON.stringify(exchange.reply)}` : ""}`,
          )
          .join("\n");
  return `You arrange the T3 Code window for the thread the user is looking at. Turn their request into commands.

The window has the chat in the middle, a right panel, and a terminal drawer under the chat.
The right panel is one row of tabs and shows one tab at a time; two tabs cannot be shown side by side.
The drawer holds terminals, split side by side or stacked.

Commands, run in order:
${COMMANDS}

Rules:
- A browser, diff, files or pull requests "on the right" or in a "split right" means the right panel.
- A terminal "at the bottom", "below" or "under" means the drawer: terminal.show, one terminal.
- Use terminal.split or terminal.new only when the request asks for more than one terminal.
- Leave out commands whose result is already true in the current layout.
- When part of the request cannot be done with these commands, do the rest and say what you skipped in reply, in one short sentence. Otherwise reply is "".
- Use only the commands and fields listed above.

Return JSON with keys commands and reply.

Current layout:
${input.layout}

Earlier requests in this conversation, oldest first:
${history}

Request:
${input.prompt}`;
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const fileSystem = yield* FileSystem.FileSystem;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fail = (detail: string) => (cause: unknown) =>
    new TextGenerationError({ operation: "generateUiAssistantPlan", detail, cause });
  return UiAssistant.of({
    plan: Effect.fn("UiAssistant.plan")(function* (input) {
      const settings = yield* settingsService.getSettings.pipe(
        Effect.mapError(fail("Could not read the layout assistant's model setting.")),
      );
      // Providers run in a working directory; planning must not read a checkout.
      const cwd = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: "t3-ui-assistant-" })
        .pipe(Effect.mapError(fail("Could not create a working directory.")));
      return yield* textGeneration.generateUiAssistantPlan({
        cwd,
        prompt: buildUiAssistantPrompt(input),
        modelSelection: resolveUiAssistantModelSelection(settings),
      });
    }, Effect.scoped),
  });
});

export const layer = Layer.effect(UiAssistant, make);
