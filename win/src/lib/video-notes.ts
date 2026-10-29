// Rhythm's notes for a saved video are plain text: a kind line ("Exercise notes", "Recipe notes"), an overview
// paragraph, then sections, each a short heading line followed by numbered steps ("1. …") or bullets ("• …"),
// separated by blank lines. This turns them into blocks the reading page can lay out, and a short preview for the
// library's cards.

export type NotesBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'step'; marker: string; text: string };

export type Notes = {
  /** "Exercise notes", when the notes start with such a line. */
  label: string | null;
  blocks: NotesBlock[];
};

const STEP = /^(\d{1,2}[.)])\s+(.*)$/;
const BULLET = /^[•\-*–]\s+(.*)$/;
const LABEL = /^[A-Z][\w ]{0,30} notes$/i;

/** A short line that introduces what follows (not a sentence, step or bullet). */
function isHeading(line: string, next: string | undefined): boolean {
  return (
    line.length <= 60 &&
    !/[.!?:;,]$/.test(line) &&
    next != null &&
    !STEP.test(line) &&
    !BULLET.test(line)
  );
}

export function parseNotes(summary: string | null | undefined): Notes {
  const lines = (summary ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.trim());
  let label: string | null = null;
  const blocks: NotesBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  lines.forEach((line, i) => {
    if (!line) {
      endParagraph();
      return;
    }
    const next = lines.slice(i + 1).find(Boolean);
    const step = STEP.exec(line);
    const bullet = BULLET.exec(line);
    if (step || bullet) {
      endParagraph();
      blocks.push({
        kind: 'step',
        marker: step ? step[1] : '•',
        text: (step ? step[2] : bullet![1]).trim(),
      });
      return;
    }
    if (
      !blocks.length &&
      !paragraph.length &&
      label == null &&
      LABEL.test(line)
    ) {
      label = line;
      return;
    }
    // A heading starts a block (after a blank line, or first) and its content follows on the very next line, so a
    // short last line of a paragraph isn't mistaken for one.
    const startsBlock = i === 0 || !lines[i - 1];
    const contentFollows = !!lines[i + 1];
    if (startsBlock && contentFollows && isHeading(line, next)) {
      endParagraph();
      blocks.push({ kind: 'heading', text: line });
      return;
    }
    paragraph.push(line);
  });
  endParagraph();
  return { label, blocks };
}

/** The first paragraph of the notes, shortened at a word to about `max` characters, for a card. */
export function notesPreview(
  summary: string | null | undefined,
  max = 200,
): string | null {
  const { blocks } = parseNotes(summary);
  const first =
    blocks.find(b => b.kind === 'paragraph') ??
    blocks.find(b => b.kind !== 'heading');
  if (!first) {
    return null;
  }
  const text = first.text;
  if (text.length <= max) {
    return text;
  }
  const cut = text.slice(0, max);
  return `${cut
    .slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6))
    .replace(/[\s,;:.]+$/, '')}…`;
}

/** How many sections and steps the notes have, for the card: "4 sections · 23 steps". */
export function notesSize(summary: string | null | undefined): string | null {
  const { blocks } = parseNotes(summary);
  const sections = blocks.filter(b => b.kind === 'heading').length;
  const steps = blocks.filter(b => b.kind === 'step').length;
  const parts = [
    sections ? `${sections} section${sections === 1 ? '' : 's'}` : null,
    steps ? `${steps} step${steps === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}
