import { BlockNoteView } from "@blocknote/mantine";
import {
  DefaultReactSuggestionItem,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useCreateBlockNote,
} from "@blocknote/react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { useEffect, useLayoutEffect } from "react";
import type { AppBlock, DocumentRuntime, StoredNote } from "../types";
import { RuntimeContext } from "./runtime-context";
import { schema } from "./special-blocks";
import { CalculationDecorationExtension } from "./decorate";

type Props = {
  note: StoredNote;
  runtime: DocumentRuntime;
  onChange: (blocks: AppBlock[]) => void;
};

function customSlashItems(editor: typeof schema.BlockNoteEditor): DefaultReactSuggestionItem[] {
  const customItems: DefaultReactSuggestionItem[] = [
    {
      title: "Variables",
      aliases: ["variables", "vars"],
      group: "Qaltion",
      subtext: "Show values defined above this point",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "variables" }),
    },
    {
      title: "Result",
      aliases: ["result", "calculate"],
      group: "Qaltion",
      subtext: "Keep a dynamic expression result as a block",
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "result", content: "1 + 2" }),
    },
  ];
  return [...customItems, ...getDefaultReactSlashMenuItems(editor)];
}

export function EditorPane({ note, runtime, onChange }: Props) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: note.blocks as never,
    extensions: [CalculationDecorationExtension()],
  });

  useLayoutEffect(() => {
    editor.getExtension(CalculationDecorationExtension)?.setRuntime(runtime);
  }, [editor, runtime]);

  useEffect(() => {
    onChange(editor.document as AppBlock[]);
  }, [editor, onChange]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <div className="editor-host">
        <BlockNoteView
          editor={editor}
          slashMenu={false}
          sideMenu={false}
          formattingToolbar={false}
          onChange={() => onChange(editor.document as AppBlock[])}
        >
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => filterSuggestionItems(customSlashItems(editor), query)}
          />
        </BlockNoteView>
      </div>
    </RuntimeContext.Provider>
  );
}
