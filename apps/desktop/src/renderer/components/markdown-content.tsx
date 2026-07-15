import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ content, className }: { content: string; className?: string }) {
  return (
    <div className={`markdown-content ${className ?? ""}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
          code: ({ className: codeClassName, children, ...props }) => (
            <code className={codeClassName} {...props}>{children}</code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
