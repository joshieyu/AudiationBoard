import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, breaks: true });

// ==highlight== isn't GFM, but it's what people reach for when marking up lyrics.
marked.use({
  extensions: [
    {
      name: 'highlight',
      level: 'inline',
      start: (src: string) => src.indexOf('=='),
      tokenizer(src: string) {
        const m = /^==([^=\n]+)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
        return undefined;
      },
      renderer(token) {
        return `<mark>${this.parser.parseInline(token.tokens ?? [])}</mark>`;
      },
    },
  ],
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function renderMarkdown(md: string): string {
  const html = marked.parse(md, { async: false }) as string;
  let task = 0;
  // Make task-list checkboxes clickable and remember their order.
  const withTasks = html.replace(/<input (checked="" )?disabled="" type="checkbox">/g, (_m, checked) => `<input type="checkbox" data-task="${task++}"${checked ? ' checked' : ''}>`);
  return DOMPurify.sanitize(withTasks, { ADD_ATTR: ['target', 'data-task'] });
}

/** Flip the nth "- [ ]" in the source. */
export function toggleTask(md: string, index: number): string {
  let i = 0;
  return md.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[( |x|X)\]/gm, (m, prefix, mark) => {
    if (i++ !== index) return m;
    return `${prefix}[${mark === ' ' ? 'x' : ' '}]`;
  });
}
