import type { ChangeSet } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";
import type { DocumentRuntime } from "../types";
import { setRuntime } from "./highlighting";

type ResultPosition = {
  line: number;
  result: string;
  top: number;
  height: number;
};

function drawResults(lane: HTMLElement, positions: ResultPosition[]): void {
  const fragment = document.createDocumentFragment();
  for (const position of positions) {
    const output = document.createElement("output");
    output.className = "line-result";
    output.dataset.line = String(position.line);
    output.textContent = position.result;
    output.title = position.result;
    output.setAttribute("aria-hidden", "true");
    output.style.top = `${position.top}px`;
    output.style.height = `${position.height}px`;
    fragment.append(output);
  }
  lane.replaceChildren(fragment);
}

function resultLanePlugin(lane: HTMLElement) {
  return ViewPlugin.fromClass(class {
    private runtime: DocumentRuntime = {
      lines: [],
      variables: [],
      engine: "development-fallback",
      status: "idle",
    };

    constructor(view: EditorView) {
      this.schedule(view);
    }

    update(update: ViewUpdate): void {
      let runtimeChanged = false;
      for (const transaction of update.transactions) {
        if (transaction.docChanged) {
          this.runtime = {
            ...this.runtime,
            lines: this.runtime.lines
              .filter((line) => this.lineSurvives(line.from, line.to, transaction.changes))
              .map((line) => {
                const from = transaction.changes.mapPos(line.from, 1);
                const to = transaction.changes.mapPos(line.to, -1);
                return {
                  ...line,
                  line: transaction.newDoc.lineAt(from).number,
                  from,
                  to: Math.max(from, to),
                  tokens: line.tokens.map((token) => ({
                    ...token,
                    from: transaction.changes.mapPos(token.from, 1),
                    to: transaction.changes.mapPos(token.to, -1),
                  })),
                };
              }),
          };
        }
        for (const effect of transaction.effects) {
          if (effect.is(setRuntime)) {
            this.runtime = effect.value.status === "pending"
              ? { ...effect.value, lines: this.runtime.lines }
              : effect.value;
            runtimeChanged = true;
          }
        }
      }
      if (runtimeChanged || update.docChanged || update.geometryChanged || update.viewportChanged) {
        this.schedule(update.view);
      }
    }

    destroy(): void {
      lane.replaceChildren();
    }

    private schedule(view: EditorView): void {
      view.requestMeasure({
        key: lane,
        read: () => {
          const hostTop = lane.parentElement?.getBoundingClientRect().top ?? 0;
          return this.runtime.lines.flatMap((line): ResultPosition[] => {
            if (!line.result || line.line > view.state.doc.lines) return [];
            const position = view.state.doc.line(line.line).from;
            const block = view.lineBlockAt(position);
            return [{
              line: line.line,
              result: line.result,
              top: view.documentTop + block.top - hostTop,
              height: block.height,
            }];
          });
        },
        write: (positions) => drawResults(lane, positions),
      });
    }

    private lineSurvives(from: number, to: number, changes: ChangeSet): boolean {
      let survives = true;
      changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!survives) return;
        if (toA > fromA && toA >= from && fromA <= to) {
          survives = false;
          return;
        }
        if (fromA === toA && fromA >= from && fromA <= to) {
          const prependsLines = fromA === from && inserted.toString().endsWith("\n");
          if (!prependsLines) survives = false;
        }
      });
      return survives;
    }
  });
}

export function resultsExtension(lane: HTMLElement) {
  return resultLanePlugin(lane);
}
