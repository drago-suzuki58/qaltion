import type { Diagnostic } from "@codemirror/lint";
import type { DocumentRuntime } from "../types";

export function runtimeDiagnostics(runtime: DocumentRuntime, documentLength: number): Diagnostic[] {
  return runtime.lines.flatMap((line) => {
    if (!line.error) return [];
    const undefinedToken = line.error.kind === "undefined"
      ? line.tokens.find((token) => token.kind === "undefined")
      : undefined;
    const from = Math.min(undefinedToken?.from ?? line.from, documentLength);
    const proposedTo = undefinedToken?.to ?? line.to;
    const to = Math.min(Math.max(proposedTo, from), documentLength);
    return [{
      from,
      to,
      severity: "error" as const,
      source: "Qaltion",
      message: line.error.message,
    }];
  });
}
