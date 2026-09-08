export type RawTokenKind =
  | "number"
  | "identifier"
  | "string"
  | "operator"
  | "punctuation"
  | "comment";

export type RawToken = {
  kind: RawTokenKind;
  text: string;
  from: number;
  to: number;
};

const multiCharacterOperators = [
  "===",
  "!==",
  "<=",
  ">=",
  "!=",
  "==",
  "&&",
  "||",
  "<<",
  ">>",
  "%%",
  "//",
  "**",
  "^^",
  "->",
  "→",
  "−>",
].sort((left, right) => right.length - left.length);

const singleCharacterOperators = new Set([
  "+",
  "-",
  "*",
  "/",
  "^",
  "%",
  "=",
  "&",
  "|",
  "!",
  "<",
  ">",
  "~",
  "\\",
  "×",
  "⋅",
  "·",
  "∙",
  "•",
  "÷",
  "∕",
  "−",
  "＋",
  "±",
  "∨",
  "∧",
  "⊻",
  "¬",
  "≈",
  "≅",
  "≤",
  "≥",
  "≠",
]);

function codePointAt(source: string, position: number): string {
  return String.fromCodePoint(source.codePointAt(position) ?? 0);
}

function codePointLength(character: string): number {
  return character.length;
}

function isIdentifierStart(character: string): boolean {
  return character === "_" || /[\p{L}\p{Nl}\p{Sc}\p{So}]/u.test(character);
}

function isIdentifierPart(character: string): boolean {
  return character === "_" || /[\p{L}\p{Nl}\p{M}\p{N}]/u.test(character);
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function consumeDigits(source: string, position: number, valid: (character: string) => boolean): number {
  while (position < source.length && valid(source[position])) position++;
  return position;
}

function numberEnd(source: string, position: number): number {
  if (source[position] !== "0" || position + 1 >= source.length) {
    let end = consumeDigits(source, position, isDigit);
    if (source[end] === ".") end = consumeDigits(source, end + 1, isDigit);
    if ((source[end] === "e" || source[end] === "E") && isDigit(source[end + 1] ?? "")) {
      end = consumeDigits(source, end + 1, isDigit);
    } else if ((source[end] === "e" || source[end] === "E") && (source[end + 1] === "+" || source[end + 1] === "-") && isDigit(source[end + 2] ?? "")) {
      end = consumeDigits(source, end + 2, isDigit);
    }
    return end;
  }

  const baseMarker = source[position + 1]?.toLowerCase();
  const baseDigits = baseMarker === "x"
    ? (character: string) => /[0-9a-f]/i.test(character)
    : baseMarker === "b"
      ? (character: string) => character === "0" || character === "1"
      : baseMarker === "o"
        ? (character: string) => /[0-7]/.test(character)
        : baseMarker === "d"
          ? (character: string) => /[0-9exab]/i.test(character)
          : undefined;
  if (baseDigits && baseDigits(source[position + 2] ?? "")) {
    return consumeDigits(source, position + 2, baseDigits);
  }

  let end = consumeDigits(source, position, isDigit);
  if (source[end] === ".") end = consumeDigits(source, end + 1, isDigit);
  if ((source[end] === "e" || source[end] === "E") && isDigit(source[end + 1] ?? "")) {
    end = consumeDigits(source, end + 1, isDigit);
  } else if ((source[end] === "e" || source[end] === "E") && (source[end + 1] === "+" || source[end + 1] === "-") && isDigit(source[end + 2] ?? "")) {
    end = consumeDigits(source, end + 2, isDigit);
  }
  return end;
}

function operatorAt(source: string, position: number): string | undefined {
  const candidate = multiCharacterOperators.find((operator) => source.startsWith(operator, position));
  if (candidate) return candidate;
  const character = codePointAt(source, position);
  return singleCharacterOperators.has(character) ? character : undefined;
}

export function scanTokens(source: string, documentOffset = 0): RawToken[] {
  const tokens: RawToken[] = [];
  let position = 0;

  while (position < source.length) {
    const character = codePointAt(source, position);
    if (/\s/u.test(character)) {
      position += codePointLength(character);
      continue;
    }

    const from = position;
    if (character === "#") {
      tokens.push({ kind: "comment", text: source.slice(position), from: documentOffset + position, to: documentOffset + source.length });
      break;
    }

    if (character === '"' || character === "'") {
      position += codePointLength(character);
      while (position < source.length) {
        const current = codePointAt(source, position);
        position += codePointLength(current);
        if (current === character) break;
      }
      tokens.push({ kind: "string", text: source.slice(from, position), from: documentOffset + from, to: documentOffset + position });
      continue;
    }

    if (isDigit(character) || (character === "." && isDigit(codePointAt(source, position + 1)))) {
      position = character === "." ? numberEnd(source, position + 1) : numberEnd(source, position);
      tokens.push({ kind: "number", text: source.slice(from, position), from: documentOffset + from, to: documentOffset + position });
      continue;
    }

    const operator = operatorAt(source, position);
    if (operator) {
      position += operator.length;
      tokens.push({ kind: "operator", text: operator, from: documentOffset + from, to: documentOffset + position });
      continue;
    }

    if (isIdentifierStart(character)) {
      position += codePointLength(character);
      const canHaveParts = character === "_" || /[\p{L}\p{Nl}]/u.test(character);
      if (canHaveParts) {
        while (position < source.length) {
          const current = codePointAt(source, position);
          if (!isIdentifierPart(current)) break;
          position += codePointLength(current);
        }
      }
      tokens.push({ kind: "identifier", text: source.slice(from, position), from: documentOffset + from, to: documentOffset + position });
      continue;
    }

    position += codePointLength(character);
    tokens.push({ kind: "punctuation", text: character, from: documentOffset + from, to: documentOffset + position });
  }

  return tokens;
}

export type SourceLine = {
  line: number;
  from: number;
  to: number;
  text: string;
};

export function sourceLines(source: string): SourceLine[] {
  let from = 0;
  return source.split("\n").map((raw, index) => {
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    const line = { line: index + 1, from, to: from + text.length, text };
    from += raw.length + 1;
    return line;
  });
}

export function expressionSource(text: string): string {
  const comment = scanTokens(text).find((token) => token.kind === "comment");
  return (comment ? text.slice(0, comment.from) : text).trimEnd();
}

export function isComment(text: string): boolean {
  const tokens = scanTokens(text);
  return tokens.length > 0 && tokens.every((token) => token.kind === "comment");
}

export function isEmpty(text: string): boolean {
  return text.trim().length === 0;
}

export function assignmentName(text: string): string | undefined {
  const tokens = scanTokens(expressionSource(text));
  const first = tokens[0];
  const second = tokens[1];
  return first?.kind === "identifier" && second?.kind === "operator" && second.text === "="
    ? first.text
    : undefined;
}
