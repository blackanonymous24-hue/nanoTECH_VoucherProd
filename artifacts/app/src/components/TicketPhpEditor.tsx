import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { php } from "@codemirror/lang-php";
import { EditorView } from "@codemirror/view";

const DEFAULT_EDITOR_MIN_HEIGHT = "min(70vh, 520px)";

export function TicketPhpEditor({
  value,
  onChange,
  readOnly,
  placeholder,
  /** Hauteur minimale de la zone d’édition (ex. `min(36vh, 280px)` pour compacter une page). */
  editorMinHeight = DEFAULT_EDITOR_MIN_HEIGHT,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  editorMinHeight?: string;
}) {
  const extensions = useMemo(
    () => [
      php(),
      EditorView.lineWrapping,
      EditorView.theme({
        "&": { fontSize: "12px" },
        ".cm-scroller": {
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          minHeight: editorMinHeight,
        },
        ".cm-content": { paddingBlock: "6px" },
        ".cm-gutters": {
          fontSize: "11px",
          backgroundColor: "hsl(var(--muted))",
          color: "hsl(var(--muted-foreground))",
          borderRight: "1px solid hsl(var(--border))",
        },
        ".cm-activeLineGutter": { backgroundColor: "hsl(var(--accent) / 0.45)" },
        ".cm-activeLine": { backgroundColor: "hsl(var(--accent) / 0.12)" },
      }),
    ],
    [editorMinHeight],
  );

  return (
    <div className="w-full rounded-md border border-input overflow-hidden text-left focus-within:ring-1 focus-within:ring-ring [&_.cm-editor]:outline-none [&_.cm-editor]:rounded-md">
      <CodeMirror
        value={value}
        height={editorMinHeight}
        extensions={extensions}
        onChange={onChange}
        editable={!readOnly}
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: false,
        }}
        className="text-xs"
      />
    </div>
  );
}
