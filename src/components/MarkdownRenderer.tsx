import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type MarkdownRendererProps = {
  content: string;
};

type CodeFenceProps = {
  language: string;
  codeText: string;
};

function CodeFence({ language, codeText }: CodeFenceProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="code-block-wrap">
      <div className="code-block-head">
        <span>{language}</span>
        <button type="button" className="code-copy-btn" onClick={handleCopy}>
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre>
        <code>{codeText}</code>
      </pre>
    </div>
  );
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code: ({ className, children }) => {
          const raw = String(children ?? "");
          const codeText = raw.replace(/\n$/, "");
          const language = className?.replace("language-", "") || "text";
          const isBlock = Boolean(className) || codeText.includes("\n");

          if (!isBlock) {
            return <code className="inline-code">{children}</code>;
          }

          return <CodeFence language={language} codeText={codeText} />;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
