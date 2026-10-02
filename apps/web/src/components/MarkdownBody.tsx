import { createContext, useContext, type ComponentProps } from 'react';
import Markdown, { type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Isolated in its own module so it can be lazily loaded. The markdown renderer and its plugins are
 * about half the bundle, and nothing needs them until a card drawer is actually opened.
 */
export default function MarkdownBody({
  children,
  onToggleTask,
}: {
  children: string;
  /** Called with the 1-based source line of a task item whose box was clicked. */
  onToggleTask?: ((line: number) => void) | undefined;
}): React.ReactElement {
  return (
    <ToggleTask.Provider value={onToggleTask}>
      <div className="markdown text-sm leading-relaxed">
        <Markdown remarkPlugins={[remarkGfm]} components={{ li: TaskListItem, input: TaskBox }}>
          {children}
        </Markdown>
      </div>
    </ToggleTask.Provider>
  );
}

const ToggleTask = createContext<((line: number) => void) | undefined>(undefined);

/**
 * GFM renders a task item as `<li class="task-list-item"><input type="checkbox" disabled>`. The
 * input itself carries no source position, only the list item does, so the item hands its line
 * down to the box through context, and the box becomes a live control when a handler is wired.
 */
const TaskLine = createContext<number | undefined>(undefined);

function TaskListItem({ node, ...props }: ComponentProps<'li'> & ExtraProps): React.ReactElement {
  const classes = node?.properties['className'];
  const isTask = Array.isArray(classes) && classes.includes('task-list-item');
  const line = isTask ? node?.position?.start.line : undefined;
  return (
    <TaskLine.Provider value={line}>
      <li {...props} />
    </TaskLine.Provider>
  );
}

function TaskBox({ node: _node, ...props }: ComponentProps<'input'> & ExtraProps): React.ReactElement {
  const line = useContext(TaskLine);
  const onToggle = useContext(ToggleTask);
  if (props.type !== 'checkbox' || line === undefined || onToggle === undefined) {
    return <input {...props} />;
  }
  const { disabled: _disabled, ...rest } = props;
  return (
    <input
      {...rest}
      checked={Boolean(props.checked)}
      aria-label={props.checked ? 'Mark as not done' : 'Mark as done'}
      onChange={() => onToggle(line)}
    />
  );
}
