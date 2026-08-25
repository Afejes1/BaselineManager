import type { ReactNode } from "react";

/**
 * A deliberately small Markdown renderer for model output. React escapes all
 * source text and this component never emits HTML, links, images, or embeds.
 * It keeps useful briefing structure without giving returned content an active
 * execution or navigation surface.
 */
function inline(text: string): ReactNode[] {
  const result: ReactNode[] = [];
  const token = /(`[^`]*`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_)/g;
  let position = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = token.exec(text))) {
    if (match.index > position) result.push(text.slice(position, match.index));
    const value = match[0];
    if (value.startsWith("`")) result.push(<code key={`inline-${index}`}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("**") || value.startsWith("__")) result.push(<strong key={`inline-${index}`}>{value.slice(2, -2)}</strong>);
    else result.push(<em key={`inline-${index}`}>{value.slice(1, -1)}</em>);
    position = match.index + value.length;
    index += 1;
  }
  if (position < text.length) result.push(text.slice(position));
  return result;
}

export function SafeMarkdown({ content, className = "" }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`paragraph-${blocks.length}`}>{paragraph.map((line, index) => <span key={index}>{index ? <br /> : null}{inline(line)}</span>)}</p>);
    paragraph = [];
  };

  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (/^```/.test(line.trim())) {
      flushParagraph();
      const code: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !/^```/.test(lines[cursor].trim())) { code.push(lines[cursor]); cursor += 1; }
      blocks.push(<pre key={`code-${blocks.length}`}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = Math.min(4, heading[1].length);
      const text = inline(heading[2]);
      if (level === 1) blocks.push(<h2 key={`heading-${blocks.length}`}>{text}</h2>);
      else if (level === 2) blocks.push(<h3 key={`heading-${blocks.length}`}>{text}</h3>);
      else blocks.push(<h4 key={`heading-${blocks.length}`}>{text}</h4>);
      continue;
    }
    if (/^\s*(?:---|\*\*\*|___)\s*$/.test(line)) { flushParagraph(); blocks.push(<hr key={`rule-${blocks.length}`} />); continue; }
    if (/^>\s?/.test(line)) { flushParagraph(); blocks.push(<blockquote key={`quote-${blocks.length}`}>{inline(line.replace(/^>\s?/, ""))}</blockquote>); continue; }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      const listItems: string[] = [unordered?.[1] || ordered?.[1] || ""];
      const pattern = unordered ? /^\s*[-*+]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
      while (cursor + 1 < lines.length && pattern.test(lines[cursor + 1])) {
        cursor += 1;
        listItems.push(pattern.exec(lines[cursor])?.[1] || "");
      }
      const children = listItems.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(unordered ? <ul key={`list-${blocks.length}`}>{children}</ul> : <ol key={`list-${blocks.length}`}>{children}</ol>);
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    paragraph.push(line);
  }
  flushParagraph();
  return <div className={`safe-markdown ${className}`.trim()}>{blocks}</div>;
}
