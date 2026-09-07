import { createExtension, createStore } from "@blocknote/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";
import type { DocumentRuntime } from "../types";

const pluginKey = new PluginKey("qaltion-calculation-decorations");

export const CalculationDecorationExtension = createExtension(({ editor }) => {
  const store = createStore<DocumentRuntime>({
    blocks: {},
    variables: [],
    engine: "development-fallback",
    status: "idle",
  }, {
    onUpdate() {
      editor.transact((transaction) => transaction.setMeta(pluginKey, true));
    },
  });

  return {
    key: "qaltionCalculationDecorations",
    store,
    setRuntime(runtime: DocumentRuntime) {
      store.setState(runtime);
    },
    prosemirrorPlugins: [
      new Plugin({
        key: pluginKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];

            state.doc.descendants((node, position) => {
              const id = node.attrs.id as string | undefined;
              const contentNode = node.firstChild;
              const blockRuntime = id ? store.state.blocks[id] : undefined;
              if (!id || !contentNode) return;

              const text = contentNode.textContent;
              const isPendingCalculation = store.state.status === "pending"
                && contentNode.type.name === "paragraph"
                && text.trim().length > 0
                && !text.startsWith("--");
              if (!blockRuntime && !isPendingCalculation) return;
              if (
                blockRuntime
                && !blockRuntime.result
                && !blockRuntime.error
                && blockRuntime.tokens.length === 0
                && !isPendingCalculation
              ) return;

              const tokenKinds = new Set(blockRuntime?.tokens.map((token) => token.kind) ?? []);
              const classes = [
                isPendingCalculation && "qaltion-pending",
                !isPendingCalculation && blockRuntime?.result && "qaltion-calculation",
                !isPendingCalculation && blockRuntime?.error && "qaltion-error",
                tokenKinds.has("comment") && "qaltion-comment",
                tokenKinds.has("definition") && "qaltion-definition",
                tokenKinds.has("reference") && "qaltion-reference",
                tokenKinds.has("undefined") && "qaltion-undefined",
              ].filter((className): className is string => Boolean(className));
              const contentAttributes: Record<string, string> = {
                "data-token-kinds": [...tokenKinds].join(" "),
                "data-qaltion-block-id": id,
              };

              if (!isPendingCalculation && blockRuntime?.result) contentAttributes["data-result"] = blockRuntime.result;
              if (!isPendingCalculation && blockRuntime?.error) contentAttributes["data-error"] = blockRuntime.error.message;
              if (isPendingCalculation) contentAttributes["data-calculation-state"] = "pending";
              if (classes.length > 0) {
                decorations.push(Decoration.node(position, position + node.nodeSize, { class: classes.join(" ") }));
              }
              decorations.push(
                Decoration.node(position + 1, position + 1 + contentNode.nodeSize, contentAttributes),
              );
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ],
  } as const;
});
