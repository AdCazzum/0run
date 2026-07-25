import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders the coach's answers, which arrive as markdown (the models emit
 * headings, bold and lists whether or not we ask them to — plain-text
 * rendering showed users literal `#` and `**`).
 *
 * Two deliberate constraints:
 *
 * 1. **The output is model-generated, therefore untrusted.** No `rehype-raw`,
 *    no `dangerouslySetInnerHTML`: react-markdown does not render embedded
 *    HTML by default, and it must stay that way. Links are additionally
 *    restricted to http(s) below, so a `javascript:` href cannot survive even
 *    if a model emits one.
 * 2. **It has to look like 0run, not like a README.** Every element is mapped
 *    to the design system (Playfair for headings, Inter for prose, orange
 *    accents, uppercase micro-labels) rather than inheriting browser
 *    defaults, which would break the app register's typography.
 */
export function CoachMarkdown({ children }: { children: string }) {
  return (
    <div className="space-y-4">
      <Markdown
        // GFM for the pipe tables the models emit in "The Numbers"-style
        // blocks — without it react-markdown renders them as one paragraph of
        // literal pipes. Still no raw HTML: gfm only extends markdown syntax.
        remarkPlugins={[remarkGfm]}
        // Anything that is not plain http(s) is dropped rather than rendered.
        urlTransform={(url) => (/^https?:\/\//i.test(url) ? url : "")}
        components={{
          h1: ({ children }) => (
            <h3 className="font-serif text-2xl leading-tight text-navy">{children}</h3>
          ),
          h2: ({ children }) => (
            <h4 className="font-serif text-xl leading-tight text-navy">{children}</h4>
          ),
          h3: ({ children }) => (
            <h5 className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">{children}</h5>
          ),
          p: ({ children }) => (
            <p className="font-sans text-base leading-relaxed text-navy">{children}</p>
          ),
          strong: ({ children }) => <strong className="font-medium text-navy">{children}</strong>,
          em: ({ children }) => <em className="font-serif italic text-orange">{children}</em>,
          ul: ({ children }) => <ul className="space-y-2">{children}</ul>,
          ol: ({ children }) => <ol className="space-y-2">{children}</ol>,
          li: ({ children }) => (
            <li className="flex gap-3 font-sans text-base leading-relaxed text-navy">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-orange" />
              <span>{children}</span>
            </li>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-navy underline underline-offset-4 transition-colors duration-500 hover:text-orange"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l border-orange pl-6 font-serif text-lg italic text-navy">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded-md bg-peach/40 px-1.5 py-0.5 font-mono text-sm text-navy">
              {children}
            </code>
          ),
          hr: () => <hr className="border-navy/15" />,
          // Tables in the 0run register: hairline borders, uppercase micro
          // headers, and their own horizontal scroll so a wide table can never
          // stretch the chat column.
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse font-sans text-sm text-navy">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => (
            <th className="border-b border-navy/30 px-3 py-2 text-left font-sans text-[10px] uppercase tracking-[0.25em] text-ocean">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-navy/10 px-3 py-2 align-top leading-relaxed">{children}</td>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}
