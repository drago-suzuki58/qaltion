export type AppBlock = {
  id: string;
  type: string;
  props: Record<string, boolean | number | string>;
  content: unknown;
  children: AppBlock[];
};

export type StoredNote = {
  id: string;
  title: string;
  blocks: unknown[];
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
};

export type RuntimeErrorKind =
  | "syntax"
  | "undefined"
  | "unit"
  | "function"
  | "calculation";

export type RuntimeError = {
  kind: RuntimeErrorKind;
  message: string;
};

export type SemanticTokenKind =
  | "comment"
  | "definition"
  | "reference"
  | "number"
  | "unit"
  | "currency"
  | "function"
  | "constant"
  | "operator"
  | "undefined";

export type SemanticToken = {
  text: string;
  from: number;
  to: number;
  kind: SemanticTokenKind;
};

export type RuntimeBlock = {
  result?: string;
  error?: RuntimeError;
  variables?: CalculationVariable[];
  tokens: SemanticToken[];
};

export type CalculationVariable = {
  name: string;
  value: string;
};

export type DocumentRuntime = {
  blocks: Record<string, RuntimeBlock>;
  variables: CalculationVariable[];
  engine: "libqalculate" | "development-fallback";
  status: "idle" | "pending" | "ready" | "error";
  failure?: string;
};
