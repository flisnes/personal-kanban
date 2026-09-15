import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Isolated in its own module so it can be lazily loaded. The markdown renderer and its plugins are
 * about half the bundle, and nothing needs them until a card drawer is actually opened.
 */
export default function MarkdownBody({ children }: { children: string }): React.ReactElement {
  return (
    <div className="markdown text-sm leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
