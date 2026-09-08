export type StoredNote = {
  id: string;
  title: string;
  content: string;
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

export type LineRuntime = {
  line: number;
  from: number;
  to: number;
  result?: string;
  error?: RuntimeError;
  tokens: SemanticToken[];
};

export type CalculationVariable = {
  name: string;
  value: string;
};

export type DocumentRuntime = {
  lines: LineRuntime[];
  variables: CalculationVariable[];
  engine: "libqalculate" | "development-fallback";
  status: "idle" | "pending" | "ready" | "error";
  failure?: string;
};

export type CalculationRequest = {
  id: number;
  source: string;
};

export type CalculationResponse = {
  id: number;
  runtime: DocumentRuntime;
};
