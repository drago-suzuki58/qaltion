import { createContext, useContext } from "react";
import type { DocumentRuntime } from "../types";

export const RuntimeContext = createContext<DocumentRuntime>({
  blocks: {},
  variables: [],
  engine: "development-fallback",
});

export function useRuntime(): DocumentRuntime {
  return useContext(RuntimeContext);
}
