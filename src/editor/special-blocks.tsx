import { BlockNoteSchema, defaultBlockSpecs } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useRuntime } from "./runtime-context";

export const VariablesBlock = createReactBlockSpec(
  {
    type: "variables",
    propSchema: {},
    content: "none",
  },
  {
    render: (props) => {
      const runtime = useRuntime();
      const variables = runtime.blocks[props.block.id]?.variables ?? [];
      return (
        <div className="special-block variables-block" contentEditable={false}>
          <div className="special-block-label">Variables</div>
          {variables.length === 0 ? (
            <div className="special-block-empty">No variables above this block.</div>
          ) : (
            <dl>
              {variables.map((variable) => (
                <div key={variable.name}>
                  <dt>{variable.name}</dt>
                  <dd>{variable.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      );
    },
  },
);

export const ResultBlock = createReactBlockSpec(
  {
    type: "result",
    propSchema: {
      mode: { default: "dynamic", values: ["dynamic", "frozen"] },
      frozenValue: { default: "" },
    },
    content: "inline",
  },
  {
    render: (props) => {
      const runtime = useRuntime();
      const current = runtime.blocks[props.block.id];
      const value = props.block.props.mode === "frozen" ? props.block.props.frozenValue : current?.result;
      return (
        <div className="special-block result-block">
          <div className="result-block-expression" ref={props.contentRef} />
          <output>{value || current?.error?.message || ""}</output>
        </div>
      );
    },
  },
);

export const schema = BlockNoteSchema.create().extend({
  blockSpecs: {
    ...defaultBlockSpecs,
    variables: VariablesBlock(),
    result: ResultBlock(),
  },
});
