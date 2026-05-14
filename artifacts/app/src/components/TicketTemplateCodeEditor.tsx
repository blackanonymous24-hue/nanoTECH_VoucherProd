import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { php } from "@codemirror/lang-php";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import { cn } from "@/lib/utils";

/** Coloration PHP + HTML (templates Mikhmon) — variables et noms mis en avant. */
const ticketTemplateHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#a16207", fontWeight: "500" },
  { tag: t.string, color: "#15803d" },
  { tag: t.variableName, color: "#0369a1", fontWeight: "600" },
  { tag: t.propertyName, color: "#7c3aed" },
  { tag: t.attributeName, color: "#9333ea" },
  { tag: t.tagName, color: "#be185d", fontWeight: "500" },
  { tag: t.comment, color: "#64748b", fontStyle: "italic" },
  { tag: t.meta, color: "#64748b" },
  { tag: t.number, color: "#c2410c" },
  { tag: t.operator, color: "#475569" },
  { tag: t.bracket, color: "#334155" },
  { tag: t.punctuation, color: "#64748b" },
  { tag: t.atom, color: "#0d9488" },
  { tag: t.bool, color: "#0d9488" },
  { tag: t.className, color: "#4338ca" },
]);

const editorChromeTheme = EditorView.theme({
  "&": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace' },
  ".cm-content": { caretColor: "#1e293b", paddingBlock: "8px" },
  ".cm-gutters": {
    backgroundColor: "#f8fafc",
    color: "#94a3b8",
    border: "none",
    borderRight: "1px solid #e2e8f0",
  },
  ".cm-activeLineGutter": { backgroundColor: "#e0e7ff" },
  ".cm-activeLine": { backgroundColor: "rgba(238, 242, 255, 0.55)" },
  ".cm-selectionBackground": { backgroundColor: "#c7d2fe !important" },
  "&.cm-focused .cm-selectionBackground": { backgroundColor: "#a5b4fc !important" },
});

/** Remplit la hauteur du parent flex (carte alignée avec le panneau Variables). */
const editorFillParentTheme = EditorView.theme({
  "&": { height: "100%", display: "flex", flexDirection: "column", outline: "none" },
  ".cm-scroller": {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  },
});

export type TicketTemplateCodeEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Hauteur CSS du viewport éditeur (ex. "320px", "min(50vh, 420px)"). Utiliser `"100%"` pour remplir un parent en flex (alignement cartes). */
  height?: string;
  placeholder?: string;
  readOnly?: boolean;
  className?: string;
};

export function TicketTemplateCodeEditor({
  value,
  onChange,
  height = "min(50vh, 420px)",
  placeholder,
  readOnly,
  className,
}: TicketTemplateCodeEditorProps) {
  const fillParent = height === "100%";

  const extensions = useMemo(
    () => [
      php({ html: true }),
      syntaxHighlighting(ticketTemplateHighlightStyle, { fallback: true }),
      editorChromeTheme,
      ...(fillParent ? [editorFillParentTheme] : []),
    ],
    [fillParent],
  );

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-white text-xs overflow-hidden focus-within:ring-1 focus-within:ring-ring",
        fillParent && "flex h-full min-h-0 flex-col",
        className,
      )}
    >
      <div className={cn(fillParent && "flex h-full min-h-0 flex-1 flex-col overflow-hidden")}>
        <CodeMirror
          value={value}
          height={fillParent ? "100%" : height}
          theme="light"
          extensions={extensions}
          onChange={onChange}
          editable={!readOnly}
          placeholder={placeholder}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
          }}
        />
      </div>
    </div>
  );
}
