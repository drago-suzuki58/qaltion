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
  | "string"
  | "definition"
  | "reference"
  | "identifier"
  | "number"
  | "unit"
  | "currency"
  | "prefix"
  | "function"
  | "builtin-variable"
  | "keyword"
  | "operator"
  | "punctuation"
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

export type SymbolRegistryCategory =
  | "functions"
  | "variables"
  | "units"
  | "currencies"
  | "prefixes";

export type SymbolRegistryPayload = Record<SymbolRegistryCategory, string[]>;

export type CalculationRequest =
  | { id: number; type: "evaluate"; source: string }
  | { id: number; type: "get-symbol-registry" };

export type CalculationResponse =
  | { id: number; type: "runtime"; runtime: DocumentRuntime }
  | { id: number; type: "symbol-registry"; registry?: SymbolRegistryPayload };
