import { useEffect, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import { configure } from "./CodeEditor";

export type LineMark = { line: number; kind: "added" | "changed" };

/**
 * JSON editor in the same theme as the code editor. Editable for the request input (with a marker where the JSON
 * is invalid), read-only for the output, where `marks` highlight the lines the transformation added or changed.
 */
export function JsonEditor({
  value,
  onChange,
  readOnly,
  marks,
  path,
  height = "100%",
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  marks?: LineMark[];
  path: string;
  height?: string | number;
}) {
  const editorRef = useRef<Parameters<OnMount>[0]>(null);
  const [ready, setReady] = useState(false); // Monaco loads async: effects that need the model re-run once it exists
  const decoRef = useRef<ReturnType<Parameters<OnMount>[0]["createDecorationsCollection"]>>(null);
  const marksRef = useRef(marks);
  marksRef.current = marks;

  const applyMarks = () => {
    const ed = editorRef.current;
    if (!ed) return;
    decoRef.current?.clear();
    decoRef.current = ed.createDecorationsCollection(
      (marksRef.current ?? []).map((m) => ({
        range: new monaco.Range(m.line, 1, m.line, 1),
        options: { isWholeLine: true, className: `jd-${m.kind}`, linesDecorationsClassName: `jd-${m.kind}-bar` },
      })),
    );
  };

  const onMount: OnMount = (editor) => {
    editorRef.current = editor;
    applyMarks();
    setReady(true);
  };
  useEffect(applyMarks, [marks, value]);

  // flag invalid JSON in the editable pane
  useEffect(() => {
    if (readOnly) return;
    const model = editorRef.current?.getModel();
    if (!model) return;
    let markers: monaco.editor.IMarkerData[] = [];
    try {
      JSON.parse(value);
    } catch (e) {
      const msg = (e as Error).message;
      const lc = msg.match(/line (\d+) column (\d+)/);
      const pos = msg.match(/position (\d+)/);
      const at = lc ? { lineNumber: +lc[1], column: +lc[2] } : pos ? model.getPositionAt(+pos[1]) : { lineNumber: 1, column: 1 };
      markers = [{ severity: monaco.MarkerSeverity.Error, message: msg, startLineNumber: at.lineNumber, startColumn: at.column, endLineNumber: at.lineNumber, endColumn: at.column + 1 }];
    }
    monaco.editor.setModelMarkers(model, "json", markers);
  }, [value, readOnly, ready]);

  return (
    <Editor
      height={height}
      language="ewjson"
      path={path}
      theme="easewebhook"
      value={value}
      beforeMount={configure}
      onMount={onMount}
      onChange={(v) => onChange?.(v ?? "")}
      options={{
        readOnly,
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
        fontSize: 12.5,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: readOnly ? "none" : "line",
        lineNumbers: "on",
        lineNumbersMinChars: 3,
        folding: true,
        guides: { indentation: true },
        quickSuggestions: false,
        suggestOnTriggerCharacters: false,
        contextmenu: !readOnly,
        useShadowDOM: false, // keep the context menu in the page so the theme colours reach it (see CodeEditor)
        scrollbar: { alwaysConsumeMouseWheel: false, vertical: readOnly ? "hidden" : "auto" },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        fixedOverflowWidgets: true,
        domReadOnly: readOnly,
      }}
    />
  );
}
