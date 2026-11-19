import { useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import "monaco-editor/editor/browser/coreCommands.js";
import "monaco-editor/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-editor/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/editor/contrib/parameterHints/browser/parameterHints.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/editor/contrib/comment/browser/comment.js";
import "monaco-editor/editor/contrib/find/browser/findController.js";
import "monaco-editor/editor/contrib/folding/browser/folding.js";
import "monaco-editor/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-editor/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-editor/editor/contrib/codeAction/browser/codeActionContributions.js";
import "monaco-editor/editor/contrib/inlayHints/browser/inlayHintsContribution.js";
import "monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/editor/contrib/semanticTokens/browser/documentSemanticTokens.js";
import "monaco-editor/editor/common/standaloneStrings.js";
import "../../node_modules/monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.css";
import "monaco-editor/languages/definitions/javascript/register.js";
import * as ts from "monaco-editor/languages/features/typescript/register.js";
import editorWorker from "monaco-editor/editor/editor.worker?worker";
import tsWorker from "monaco-editor/language/typescript/ts.worker?worker";

// Bundle Monaco locally (no CDN) and wire up its web workers.
self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => (label === "javascript" || label === "typescript" ? new tsWorker() : new editorWorker()),
};
loader.config({ monaco });

// Infer a TypeScript type literal from a sample JSON value, so `request.body.` completes real fields.
function tsType(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (depth > 6) return "any";
  if (Array.isArray(v)) return v.length ? `Array<${tsType(v[0], depth + 1)}>` : "any[]";
  switch (typeof v) {
    // Leaves stay loose: transformations legitimately change types (`amount = "49"`), so a strict type would
    // report false errors. Only the structure (keys and nesting) is inferred, for completion.
    case "string":
    case "number":
    case "boolean": return "any";
    case "object": {
      // Optional fields, so pushing or assigning a partial / differently shaped object is valid; the index
      // signature keeps `request.body.new_field = ...` valid while still completing known keys.
      const fields = Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}?: ${tsType(x, depth + 1)};`);
      return `{ ${fields.join(" ")} [key: string]: any }`;
    }
    default: return "any";
  }
}

// What the transformation runtime (goja, see backend/internal/transform) exposes to user code.
function runtimeTypes(sample?: Partial<Record<"method" | "path" | "query" | "headers" | "body", unknown>>): string {
  const body = sample && "body" in sample && sample.body !== undefined ? tsType(sample.body) : "any";
  const headers =
    sample?.headers && typeof sample.headers === "object"
      ? `{ ${Object.keys(sample.headers).map((k) => `${JSON.stringify(k)}?: string;`).join(" ")} [name: string]: string }`
      : "Record<string, string>";
  return `
interface TransformRequest {
  /** HTTP method, e.g. "POST". */
  method: string;
  /** Request path, e.g. "/webhooks/stripe". */
  path: string;
  /** Raw query string without the leading "?". */
  query: string;
  /** Request headers (lower-case names). Assign to add or override a header. */
  headers: ${headers};
  /** Parsed JSON body, or a raw string when the payload is not JSON. */
  body: ${body};
}
interface TransformContext {
  /** The connection this event is being delivered through. */
  connection: { id: string; name: string; source_id: string; destination_id: string };
}
/** Register the transformation. The handler must return the (modified) request. */
declare function addHandler(
  name: "transform",
  handler: (request: TransformRequest, context: TransformContext) => TransformRequest
): void;
/** Variables defined on this transformation (Variables tab). */
declare const process: { env: Record<string, string> };
`;
}

const SNIPPETS: { label: string; detail: string; body: string }[] = [
  { label: "handler", detail: "addHandler boilerplate", body: 'addHandler("transform", (request, context) => {\n\t${0}\n\treturn request;\n});' },
  { label: "header", detail: "Set a request header", body: 'request.headers["${1:x-custom}"] = "${2:value}";' },
  { label: "delheader", detail: "Remove a request header", body: 'delete request.headers["${1:authorization}"];' },
  { label: "setbody", detail: "Replace the body", body: "request.body = {\n\t${0}\n};" },
  { label: "pick", detail: "Keep only some body fields", body: 'const { ${1:id}, ${2:type} } = request.body;\nrequest.body = { ${1:id}, ${2:type} };' },
  { label: "env", detail: "Read a transformation variable", body: "process.env.${1:API_KEY}" },
  { label: "log", detail: "console.log (shown in Output)", body: "console.log(${1:request.body});" },
  { label: "guard", detail: "Only act on JSON object bodies", body: 'if (request.body && typeof request.body === "object") {\n\t${0}\n}' },
];

let configured = false;
// Monaco loads asynchronously, after the component's first effect; keep the newest sample for configure().
let latestSample: Parameters<typeof runtimeTypes>[0];
function setRuntimeTypes(sample?: Parameters<typeof runtimeTypes>[0]) {
  latestSample = sample;
  // Same path => Monaco replaces the previous content in place.
  ts.javascriptDefaults.addExtraLib(runtimeTypes(sample), "ts:easewebhook-runtime.d.ts");
}

export function configure() {
  if (configured) return;
  configured = true;
  const js = ts.javascriptDefaults;
  js.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    checkJs: true,
    noLib: false,
  });
  js.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
  setRuntimeTypes(latestSample);

  monaco.languages.registerCompletionItemProvider("javascript", {
    provideCompletionItems(model, position) {
      // No snippets in member position (after a "."): there only real properties belong.
      const before = model.getValueInRange({ startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: 1, endColumn: position.column });
      if (/\.\s*\w*$/.test(before)) return { suggestions: [] };
      const w = model.getWordUntilPosition(position);
      const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn };
      return {
        suggestions: SNIPPETS.map((x) => ({
          label: x.label,
          detail: x.detail,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: x.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
      };
    },
  });

  monaco.languages.register({ id: "ewjson" });
  monaco.languages.setMonarchTokensProvider("ewjson", {
    tokenizer: {
      root: [
        [/"(?:[^"\\]|\\.)*"(?=\s*:)/, "string.key.json"],
        [/"(?:[^"\\]|\\.)*"/, "string.value.json"],
        [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, "number"],
        [/\b(?:true|false|null)\b/, "keyword"],
        [/[{}[\],:]/, "delimiter"],
      ],
    },
  });

  monaco.editor.defineTheme("easewebhook", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "string.key.json", foreground: "9cdcfe" },
      { token: "string.value.json", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "keyword", foreground: "569cd6" },
      { token: "delimiter", foreground: "808080" },
    ],
    colors: {
      "editor.background": "#161616",
      "editorGutter.background": "#161616",
      "editor.lineHighlightBackground": "#1d1d1d",
      "editorLineNumber.foreground": "#4a4a4a",
      "editorSuggestWidget.background": "#212121",
      "editorSuggestWidget.border": "#3a3a3a",
    },
  });
}

export function CodeEditor({
  value,
  onChange,
  onRun,
  onSave,
  sample,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onRun?: () => void;
  onSave?: () => void;
  /** Sample request (the Input pane); its shape drives `request.*` completions. */
  sample?: Parameters<typeof runtimeTypes>[0];
  /** Last run error; "line N" / ":N:" references are marked in the gutter. */
  error?: string | null;
}) {
  // Commands are registered once at mount, so they must read the latest callbacks through refs.
  const runRef = useRef(onRun);
  const saveRef = useRef(onSave);
  runRef.current = onRun;
  saveRef.current = onSave;
  const editorRef = useRef<Parameters<OnMount>[0]>(null);

  const onMount: OnMount = (editor, m) => {
    editorRef.current = editor;
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => runRef.current?.());
    editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => saveRef.current?.());
  };

  const sampleKey = JSON.stringify(sample ?? null);
  useEffect(() => {
    setRuntimeTypes(sample);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampleKey]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    const m = error?.match(/(?:line |:)(\d+)(?::(\d+))?/i);
    const line = m ? Math.min(Number(m[1]), model.getLineCount()) : 0;
    monaco.editor.setModelMarkers(model, "run", error && line
      ? [{ severity: monaco.MarkerSeverity.Error, message: error, startLineNumber: line, endLineNumber: line, startColumn: 1, endColumn: model.getLineMaxColumn(line) }]
      : []);
  }, [error, value]);

  return (
    <Editor
      height="100%"
      language="javascript"
      path="transformation.js"
      theme="easewebhook"
      value={value}
      beforeMount={configure}
      onMount={onMount}
      onChange={(v) => onChange(v ?? "")}
      options={{
        fontFamily: '"JetBrains Mono", ui-monospace, Menlo, monospace',
        fontSize: 13,
        lineHeight: 21,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 12 },
        renderLineHighlight: "line",
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        snippetSuggestions: "inline",
        bracketPairColorization: { enabled: true },
        fixedOverflowWidgets: true,
        // Render Monaco's right-click menu in the page, not in a shadow root: inside a shadow root the editor's theme
        // variables never reach it and it comes out black-on-dark.
        useShadowDOM: false,
        formatOnPaste: true,
        guides: { indentation: true },
      }}
    />
  );
}
