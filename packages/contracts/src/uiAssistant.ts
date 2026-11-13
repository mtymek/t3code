import * as Schema from "effect/Schema";

export const UiAssistantSplitDirection = Schema.Literals(["right", "down"]);
export type UiAssistantSplitDirection = typeof UiAssistantSplitDirection.Type;

export const UiAssistantTerminalPlace = Schema.Literals(["drawer", "panel"]);
export type UiAssistantTerminalPlace = typeof UiAssistantTerminalPlace.Type;

// Every field is required (nullable when optional) so strict structured-output modes accept the schema.
export const UiAssistantCommand = Schema.Union([
  Schema.Struct({ command: Schema.Literal("browser.open"), url: Schema.NullOr(Schema.String) }),
  Schema.Struct({
    command: Schema.Literal("rightPanel.open"),
    kind: Schema.Literals(["diff", "files", "pull-requests"]),
  }),
  Schema.Struct({ command: Schema.Literal("rightPanel.hide") }),
  Schema.Struct({ command: Schema.Literal("rightPanel.maximize"), maximized: Schema.Boolean }),
  Schema.Struct({ command: Schema.Literal("terminal.show") }),
  Schema.Struct({ command: Schema.Literal("terminal.hide") }),
  Schema.Struct({ command: Schema.Literal("terminal.new"), place: UiAssistantTerminalPlace }),
  Schema.Struct({
    command: Schema.Literal("terminal.split"),
    place: UiAssistantTerminalPlace,
    direction: UiAssistantSplitDirection,
  }),
  Schema.Struct({ command: Schema.Literal("terminal.resize"), height: Schema.Number }),
]);
export type UiAssistantCommand = typeof UiAssistantCommand.Type;

export const UiAssistantPlan = Schema.Struct({
  commands: Schema.Array(UiAssistantCommand),
  reply: Schema.String,
});
export type UiAssistantPlan = typeof UiAssistantPlan.Type;

export const UiAssistantExchange = Schema.Struct({
  prompt: Schema.String,
  reply: Schema.String,
});
export type UiAssistantExchange = typeof UiAssistantExchange.Type;

export const UiAssistantPlanInput = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
  /** The client's description of the thread's current layout. */
  layout: Schema.String.check(Schema.isMaxLength(4_000)),
  history: Schema.Array(UiAssistantExchange).check(Schema.isMaxLength(6)),
});
export type UiAssistantPlanInput = typeof UiAssistantPlanInput.Type;
