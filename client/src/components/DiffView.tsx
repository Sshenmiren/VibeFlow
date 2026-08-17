/** 极简 unified diff 渲染 */
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');
  return (
    <div className="diff-view" role="region" aria-label="代码改动">
      {lines.map((line, i) => {
        let cls = 'line';
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')) cls += ' file-head';
        else if (line.startsWith('@@')) cls += ' hunk';
        else if (line.startsWith('+')) cls += ' add';
        else if (line.startsWith('-')) cls += ' del';
        return <div key={i} className={cls}>{line || ' '}</div>;
      })}
    </div>
  );
}
