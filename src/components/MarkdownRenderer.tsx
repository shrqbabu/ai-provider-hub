import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { useMemo, useState } from "react";
import { Check, Copy, Terminal, WrapText, Download } from "lucide-react";
import { cn } from "@/utils";
import "highlight.js/styles/github.css";

interface Props {
  content: string;
  streaming?: boolean;
}

export function MarkdownRenderer({ content, streaming }: Props) {
  return (
    <div className={cn("markdown text-sm", streaming && "streaming-cursor")}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pre: ({ children }: any) => <PremiumCodeBlock>{children}</PremiumCodeBlock>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const LANG_LABEL: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JSX",
  py: "Python",
  python: "Python",
  rb: "Ruby",
  ruby: "Ruby",
  go: "Go",
  rs: "Rust",
  rust: "Rust",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  c: "C",
  cpp: "C++",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  bash: "Bash",
  zsh: "Zsh",
  ps1: "PowerShell",
  powershell: "PowerShell",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  xml: "XML",
  md: "Markdown",
  markdown: "Markdown",
  dockerfile: "Dockerfile",
  vue: "Vue",
  svelte: "Svelte",
};

function PremiumCodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [wrap, setWrap] = useState(false);

  // Extract raw code and language from the highlighted <code> element.
  const { rawCode, lang } = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = flatFind(children as any, "code");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = extractText(code as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const className: string = (code as any)?.props?.className ?? "";
    const match = /language-([a-zA-Z0-9+-]+)/.exec(className);
    return { rawCode: raw, lang: match?.[1]?.toLowerCase() ?? "" };
  }, [children]);

  const label = LANG_LABEL[lang] ?? (lang ? lang.toUpperCase() : "Code");
  const lineCount = rawCode.split("\n").length;

  const copy = () => {
    navigator.clipboard.writeText(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const download = () => {
    const ext = lang && lang.length < 8 ? lang : "txt";
    const blob = new Blob([rawCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `snippet.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-4 rounded-xl overflow-hidden border border-border bg-white dark:bg-zinc-50 shadow-sm">
      {/* Header — light, minimal */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-100 border-b border-zinc-200">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono min-w-0">
          <Terminal className="w-3 h-3 shrink-0" />
          <span className="font-semibold text-zinc-700 truncate">{label}</span>
          <span className="opacity-50 hidden sm:inline">·</span>
          <span className="hidden sm:inline">
            {lineCount} line{lineCount === 1 ? "" : "s"}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          <LightIconBtn
            title={wrap ? "Disable wrap" : "Wrap lines"}
            onClick={() => setWrap((v) => !v)}
            active={wrap}
          >
            <WrapText className="w-3.5 h-3.5" />
          </LightIconBtn>
          <LightIconBtn title="Download" onClick={download}>
            <Download className="w-3.5 h-3.5" />
          </LightIconBtn>
          <LightIconBtn title="Copy" onClick={copy}>
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-[10px] font-medium text-emerald-600">
                  Copied
                </span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">Copy</span>
              </>
            )}
          </LightIconBtn>
        </div>
      </div>

      {/* Body — light bg, colored syntax */}
      <div
        className={cn(
          "scrollbar-thin text-[13px] leading-relaxed overflow-x-auto bg-white",
          wrap && "whitespace-pre-wrap break-words"
        )}
      >
        <pre
          className={cn(
            "!bg-transparent !p-4 !m-0 !rounded-none text-zinc-800",
            wrap && "whitespace-pre-wrap break-words"
          )}
        >
          {children}
        </pre>
      </div>
    </div>
  );
}

function LightIconBtn({
  onClick,
  title,
  children,
  active,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex items-center gap-1 h-6 px-2 rounded-md transition text-zinc-600 hover:text-zinc-900",
        active ? "bg-zinc-200 text-zinc-900" : "hover:bg-zinc-100"
      )}
    >
      {children}
    </button>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flatFind(node: any, tag: string): any {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const found = flatFind(c, tag);
      if (found) return found;
    }
    return null;
  }
  if (node?.type === tag || node?.props?.node?.tagName === tag) return node;
  if (node?.props?.children) return flatFind(node.props.children, tag);
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node?.props?.children) return extractText(node.props.children);
  return "";
}
