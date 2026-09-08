import type { SymbolRegistryCategory, SymbolRegistryPayload } from "../types";

export type QalculateSymbolRegistry = Record<SymbolRegistryCategory, Set<string>>;

const categories: SymbolRegistryCategory[] = [
  "functions",
  "variables",
  "units",
  "currencies",
  "prefixes",
];

export function createSymbolRegistry(
  input: Partial<Record<SymbolRegistryCategory, Iterable<string>>> = {},
): QalculateSymbolRegistry {
  return Object.fromEntries(categories.map((category) => [
    category,
    new Set(input[category] ?? []),
  ])) as QalculateSymbolRegistry;
}

export const emptySymbolRegistry = createSymbolRegistry();

export function symbolRegistryFromPayload(payload?: SymbolRegistryPayload): QalculateSymbolRegistry | undefined {
  if (!payload) return undefined;
  return createSymbolRegistry(payload);
}

const lowercaseIndexes = new WeakMap<QalculateSymbolRegistry, Map<SymbolRegistryCategory, Set<string>>>();

function lowercaseIndex(registry: QalculateSymbolRegistry, category: SymbolRegistryCategory): Set<string> {
  let indexes = lowercaseIndexes.get(registry);
  if (!indexes) {
    indexes = new Map();
    lowercaseIndexes.set(registry, indexes);
  }
  const existing = indexes.get(category);
  if (existing) return existing;
  const index = new Set([...registry[category]].map((name) => name.toLowerCase()));
  indexes.set(category, index);
  return index;
}

export function hasSymbol(
  registry: QalculateSymbolRegistry,
  category: SymbolRegistryCategory,
  text: string,
): boolean {
  return registry[category].has(text) || lowercaseIndex(registry, category).has(text.toLowerCase());
}

export function hasExactSymbol(
  registry: QalculateSymbolRegistry,
  category: SymbolRegistryCategory,
  text: string,
): boolean {
  return registry[category].has(text);
}
