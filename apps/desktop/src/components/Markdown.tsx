import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openExternal } from "../lib/tauri";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-relay">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              onClick={(e) => {
                e.preventDefault();
                if (href && /^(https?:|upi:|mailto:)/.test(href)) void openExternal(href);
              }}
            >
              {children}
            </a>
          ),
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
