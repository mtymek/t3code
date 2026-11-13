import type { UiAssistantExchange } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";

const MAX_RECENT_PROMPTS = 5;
const MAX_HISTORY = 6;

interface UiAssistantState {
  open: boolean;
  /** Earlier exchanges per thread, sent as context so "now make it smaller" works. Session only. */
  historyByThreadKey: Record<string, UiAssistantExchange[]>;
  recentPrompts: string[];
}

export const useUiAssistantStore = create<UiAssistantState>()(
  persist((): UiAssistantState => ({ open: false, historyByThreadKey: {}, recentPrompts: [] }), {
    name: "t3code:ui-assistant:v1",
    version: 1,
    storage: createJSONStorage(() =>
      resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
    ),
    partialize: (state) => ({ recentPrompts: state.recentPrompts }),
  }),
);

export function setUiAssistantOpen(open: boolean) {
  useUiAssistantStore.setState({ open });
}

export function recordUiAssistantExchange(threadKey: string, exchange: UiAssistantExchange) {
  useUiAssistantStore.setState((state) => ({
    historyByThreadKey: {
      ...state.historyByThreadKey,
      [threadKey]: [...(state.historyByThreadKey[threadKey] ?? []), exchange].slice(-MAX_HISTORY),
    },
    recentPrompts: [
      exchange.prompt,
      ...state.recentPrompts.filter((prompt) => prompt !== exchange.prompt),
    ].slice(0, MAX_RECENT_PROMPTS),
  }));
}
