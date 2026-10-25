/**
 * A small Markdown subset for coach replies: paragraphs with line breaks, headings, bullet and
 * numbered lists (nested by indentation), fenced code, rules, and bold, italic and inline code.
 * Anything else stays plain text. The result is a tree of strings; nothing is rendered as HTML
 * and nothing is executed.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string };

export type ListItem = { children: Inline[]; lists: List[] };
export type List = { type: 'list'; ordered: boolean; start: number; items: ListItem[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | List
  | { type: 'code'; text: string }
  | { type: 'rule' };

// A backtick fence's info string can't contain backticks, so "```x```" on one line stays inline code.
const FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
/** Indentation (in columns) that makes a line belong to the list item above it. */
const CONTINUATION_INDENT = 2;

const isBlank = (line: string) => line.trim() === '';
const indentOf = (line: string) => {
  let width = 0;
  for (const ch of line) {
    if (ch === ' ') width += 1;
    else if (ch === '\t') width += 4 - (width % 4);
    else break;
  }
  return width;
};
const toLevel = (hashes: number) => Math.min(hashes, 3) as 1 | 2 | 3;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      endParagraph();
      i += 1;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      endParagraph();
      i = parseFence(lines, i, fence[1], blocks);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      endParagraph();
      blocks.push({ type: 'heading', level: toLevel(heading[1].length), children: parseInline(heading[2]) });
      i += 1;
      continue;
    }
    // "Title" over a line of = or - is a heading; a lone --- is a rule.
    const setext = paragraph.length ? SETEXT.exec(line) : null;
    if (setext) {
      blocks.push({ type: 'heading', level: setext[1][0] === '=' ? 1 : 2, children: parseInline(paragraph.join('\n')) });
      paragraph = [];
      i += 1;
      continue;
    }
    if (RULE.test(line)) {
      endParagraph();
      blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (ITEM.test(line)) {
      endParagraph();
      i = parseList(lines, i, blocks);
      continue;
    }
    paragraph.push(line.trim());
    i += 1;
  }
  endParagraph();
  return blocks;
}

function parseFence(lines: string[], start: number, marker: string, blocks: Block[]): number {
  const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`);
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !closing.test(lines[i])) {
    body.push(lines[i]);
    i += 1;
  }
  blocks.push({ type: 'code', text: body.join('\n') });
  return i + 1; // past the closing fence (or the end)
}

type RawList = { ordered: boolean; start: number; items: RawItem[] };
type RawItem = { lines: string[]; lists: RawList[] };

function parseList(lines: string[], start: number, blocks: Block[]): number {
  const roots: RawList[] = [];
  /** Open lists from the outermost in, with the indentation of their markers. */
  const stack: { indent: number; list: RawList }[] = [];
  let blankBefore = false;
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      // A blank line only continues the list when more of the list follows it.
      let next = i + 1;
      while (next < lines.length && isBlank(lines[next])) next += 1;
      const following = lines[next];
      if (following === undefined || RULE.test(following) || HEADING.test(following) || FENCE.test(following)) break;
      if (!ITEM.test(following) && indentOf(following) < CONTINUATION_INDENT) break;
      blankBefore = true;
      i = next;
      continue;
    }
    if (RULE.test(line) || HEADING.test(line) || FENCE.test(line)) break;

    const item = ITEM.exec(line);
    if (item) {
      const indent = indentOf(item[1]);
      const ordered = /\d/.test(item[2]);
      const number = ordered ? parseInt(item[2], 10) : 1;
      while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
      const top = stack[stack.length - 1];
      const parent = top?.list.items[top.list.items.length - 1];

      if (!top) {
        const list: RawList = { ordered, start: number, items: [] };
        roots.push(list);
        stack.push({ indent, list });
      } else if (parent && indent >= top.indent + CONTINUATION_INDENT) {
        // Deeper than its list: a nested list under the item above (continuing one already there).
        const existing = parent.lists[parent.lists.length - 1];
        const list = existing && existing.ordered === ordered ? existing : { ordered, start: number, items: [] };
        if (list !== existing) parent.lists.push(list);
        stack.push({ indent, list });
      } else if (top.list.ordered !== ordered) {
        // Switching between bullets and numbers at the same depth starts a new list.
        const list: RawList = { ordered, start: number, items: [] };
        const owner = stack[stack.length - 2]?.list.items;
        if (owner?.length) owner[owner.length - 1].lists.push(list);
        else roots.push(list);
        stack[stack.length - 1] = { indent, list };
      }
      stack[stack.length - 1].list.items.push({ lines: [item[3].trim()], lists: [] });
      blankBefore = false;
      i += 1;
      continue;
    }

    // Text indented under an item continues the innermost item it is indented under; anything else ends the list.
    const indent = indentOf(line);
    if (indent < CONTINUATION_INDENT) break;
    while (stack.length > 1 && indent < stack[stack.length - 1].indent + CONTINUATION_INDENT) stack.pop();
    const top = stack[stack.length - 1].list;
    const last = top.items[top.items.length - 1];
    if (blankBefore) last.lines.push('');
    last.lines.push(line.trim());
    blankBefore = false;
    i += 1;
  }

  for (const list of roots) blocks.push(finishList(list));
  return i;
}

function finishList(list: RawList): List {
  return {
    type: 'list',
    ordered: list.ordered,
    start: list.start,
    items: list.items.map((item) => ({ children: parseInline(item.lines.join('\n')), lists: item.lists.map(finishList) })),
  };
}

const ESCAPABLE = '\\`*_{}[]()#+-.!|>~';
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function runLength(source: string, at: number, ch: string): number {
  let end = at;
  while (source[end] === ch) end += 1;
  return end - at;
}

/** Start of the backtick run of exactly `size` that closes a code span, or -1. */
function findCodeClose(source: string, from: number, size: number): number {
  let k = source.indexOf('`', from);
  while (k !== -1) {
    const run = runLength(source, k, '`');
    if (run === size) return k;
    k = source.indexOf('`', k + run);
  }
  return -1;
}

/**
 * Start of the delimiter that closes an emphasis of `size` (1 italic, 2 bold, 3 both) opened just
 * before `from`, or -1. Skips escapes and code spans, and steps over nested delimiters.
 */
function findCloser(source: string, from: number, ch: string, size: number): number {
  let k = from;
  while (k < source.length) {
    const c = source[k];
    if (c === '\\') {
      k += 2;
      continue;
    }
    if (c === '`') {
      const run = runLength(source, k, '`');
      const close = findCodeClose(source, k + run, run);
      k = close === -1 ? k + run : close + run;
      continue;
    }
    if (c !== ch) {
      k += 1;
      continue;
    }
    const run = runLength(source, k, ch);
    const canClose = k > from && !isSpace(source[k - 1]) && (ch === '*' || !isWordChar(source[k + run]));
    if (canClose) {
      if (run === size) return k;
      // "**a *b***" closes the bold on the last two; "*a **b***" closes the italic on the last one.
      if (run === 3 && size < 3) return k + 3 - size;
    }
    k += run;
  }
  return -1;
}

export function parseInline(source: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\\' && source[i + 1] === '\n') {
      i += 1; // a trailing backslash is a line break; the newline already is one
      continue;
    }
    if (ch === '\\' && i + 1 < source.length && ESCAPABLE.includes(source[i + 1])) {
      text += source[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const run = runLength(source, i, '`');
      const close = findCodeClose(source, i + run, run);
      if (close === -1) {
        text += source.slice(i, i + run);
        i += run;
        continue;
      }
      let code = source.slice(i + run, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      flush();
      out.push({ type: 'code', text: code });
      i = close + run;
      continue;
    }
    if (ch === '*' || ch === '_') {
      const run = runLength(source, i, ch);
      const emphasis = matchEmphasis(source, i, ch, run);
      if (emphasis) {
        text += emphasis.literal;
        flush();
        out.push(emphasis.node);
        i = emphasis.end;
      } else {
        text += source.slice(i, i + run);
        i += run;
      }
      continue;
    }
    text += ch;
    i += 1;
  }
  flush();
  return out;
}

function matchEmphasis(source: string, at: number, ch: string, run: number) {
  const contentStart = at + run;
  if (isSpace(source[contentStart])) return null;
  if (ch === '_' && isWordChar(source[at - 1])) return null; // snake_case stays as written
  for (let size = Math.min(run, 3); size >= 1; size -= 1) {
    const close = findCloser(source, contentStart, ch, size);
    if (close === -1) continue;
    const children = parseInline(source.slice(contentStart, close));
    const node: Inline =
      size === 3
        ? { type: 'strong', children: [{ type: 'em', children }] }
        : { type: size === 2 ? 'strong' : 'em', children };
    // Extra opening delimiters ("***a**") stay as literal text before the emphasis.
    return { literal: source.slice(at, at + run - size), node, end: close + size };
  }
  return null;
}

/**
 * Some model replies arrive with line breaks escaped as a literal backslash-n ("Ingredients:\n- oil").
 * Turns those into real line breaks, leaving code spans and fenced code untouched.
 */
export function unescapeLineBreaks(source: string): string {
  if (!source.includes('\\n')) return source;
  return source
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => (index % 2 ? part : part.replace(/(?<!\\)\\n/g, '\n')))
    .join('');
}

function inlineText(nodes: Inline[]): string {
  return nodes.map((node) => (node.type === 'text' || node.type === 'code' ? node.text : inlineText(node.children))).join('');
}

/** Markdown as one line of plain text, for short previews: the syntax goes, the words stay. */
export function toPlainText(source: string): string {
  const parts: string[] = [];
  const addList = (list: List) => {
    for (const item of list.items) {
      parts.push(inlineText(item.children));
      item.lists.forEach(addList);
    }
  };
  for (const block of parseMarkdown(unescapeLineBreaks(source))) {
    if (block.type === 'list') addList(block);
    else if (block.type === 'code') parts.push(block.text);
    else if (block.type !== 'rule') parts.push(inlineText(block.children));
  }
  return parts
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .reduce((text, part) => (text ? `${text}${text.endsWith(':') ? ' ' : ' · '}${part}` : part), '');
}
