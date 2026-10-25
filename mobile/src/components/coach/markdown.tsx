import { Fragment, useMemo, type ReactNode } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Appear } from '@/components/coach/appear';
import { FADE_IN_MS, FadeIn } from '@/components/motion';
import { ThemedText } from '@/components/themed-text';
import { Fonts, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { parseMarkdown, unescapeLineBreaks, type Block, type Inline, type List } from '@/lib/markdown';

const LINE_HEIGHT = 24;

/** A reply's Markdown, parsed once per text. */
export function useMarkdownBlocks(text: string): Block[] {
  return useMemo(() => parseMarkdown(unescapeLineBreaks(text)), [text]);
}

/**
 * How a new reply is revealed: its blocks (and each top-level list item) fade up one after another,
 * `step` ms apart, so it reads as if it's being written. The whole reveal ends by `end` ms (about
 * 900 ms however long the reply is). The text is all there from the start, so screen readers get it
 * at once; only its opacity and position animate.
 */
export type RevealPlan = { step: number; end: number };

const REVEAL_MS = 900;
/** How long one block takes to fade in. */
const BLOCK_MS = FADE_IN_MS;
const MAX_STEP_MS = 140;

export function revealPlan(blocks: Block[]): RevealPlan {
  const units = Math.max(1, blocks.reduce((count, block) => count + (block.type === 'list' ? block.items.length : 1), 0));
  const step = units > 1 ? Math.min(MAX_STEP_MS, (REVEAL_MS - BLOCK_MS) / (units - 1)) : 0;
  return { step, end: Math.round(step * (units - 1) + BLOCK_MS) };
}

/** The start delay of each block, or of each item for a list; nothing without a plan. */
function revealDelays(blocks: Block[], plan: RevealPlan | null | undefined): (number | number[] | null)[] {
  if (!plan) return blocks.map(() => null);
  let unit = 0;
  const next = () => Math.round(plan.step * unit++);
  return blocks.map((block) => (block.type === 'list' ? block.items.map(next) : next()));
}

/** Renders a coach reply's Markdown subset as native text. Nothing is ever treated as HTML. */
export function Markdown({ blocks, reveal }: { blocks: Block[]; reveal?: RevealPlan | null }) {
  const delays = revealDelays(blocks, reveal);
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <BlockView key={index} block={block} first={index === 0} delay={delays[index]} />
      ))}
    </View>
  );
}

function BlockView({ block, first, delay }: { block: Block; first: boolean; delay: number | number[] | null }) {
  if (block.type === 'list') return <ListView list={block} depth={0} delays={Array.isArray(delay) ? delay : undefined} />;
  if (typeof delay !== 'number') return <BlockContent block={block} first={first} />;
  return (
    <FadeIn delay={delay}>
      <BlockContent block={block} first={first} />
    </FadeIn>
  );
}

function BlockContent({ block, first }: { block: Exclude<Block, List>; first: boolean }) {
  const theme = useTheme();
  switch (block.type) {
    case 'paragraph':
      return <ThemedText selectable>{renderInline(block.children)}</ThemedText>;
    case 'heading':
      return (
        <ThemedText selectable accessibilityRole="header" style={[headingStyles[block.level], !first && styles.headingGap]}>
          {renderInline(block.children)}
        </ThemedText>
      );
    case 'code':
      return (
        <View style={[styles.codeBlock, { backgroundColor: theme.backgroundSelected }]}>
          <ThemedText selectable style={styles.codeBlockText}>
            {block.text}
          </ThemedText>
        </View>
      );
    case 'rule':
      return <View style={[styles.rule, { backgroundColor: theme.border }]} />;
  }
}

/** `delays` (top-level lists of a new reply) fades each item in at its own time; nested items come with their parent. */
function ListView({ list, depth, delays }: { list: List; depth: number; delays?: number[] }) {
  const theme = useTheme();
  const digits = String(list.start + list.items.length - 1).length;
  const markerWidth = list.ordered ? 14 + digits * 9 : 20;
  return (
    <View style={styles.list}>
      {list.items.map((item, index) => (
        <Appear key={index} when={!!delays} delay={delays?.[index] ?? 0} style={styles.item}>
          <View style={[styles.marker, { width: markerWidth }]}>
            {list.ordered ? (
              <ThemedText themeColor="textSecondary" style={styles.number}>
                {`${list.start + index}.`}
              </ThemedText>
            ) : (
              <View
                style={[
                  styles.bullet,
                  depth === 0 ? { backgroundColor: theme.textSecondary } : { borderColor: theme.textSecondary, borderWidth: 1.5 },
                ]}
              />
            )}
          </View>
          <View style={styles.itemBody}>
            {item.children.length ? <ThemedText selectable>{renderInline(item.children)}</ThemedText> : null}
            {item.lists.map((sub, j) => (
              <ListView key={j} list={sub} depth={depth + 1} />
            ))}
          </View>
        </Appear>
      ))}
    </View>
  );
}

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'strong':
        return (
          <Text key={index} style={styles.strong}>
            {renderInline(node.children)}
          </Text>
        );
      case 'em':
        return (
          <Text key={index} style={styles.em}>
            {renderInline(node.children)}
          </Text>
        );
      case 'code':
        return <InlineCode key={index} text={node.text} />;
    }
  });
}

function InlineCode({ text }: { text: string }) {
  const theme = useTheme();
  // Nested text can't take padding, so no-break spaces give the tinted background some room.
  return <Text style={[styles.inlineCode, { backgroundColor: theme.backgroundSelected }]}>{` ${text} `}</Text>;
}

const strongWeight = Platform.OS === 'web' ? '600' : '700';

const headingStyles = StyleSheet.create({
  1: { fontSize: 20, lineHeight: 28, fontWeight: strongWeight },
  2: { fontSize: 18, lineHeight: 26, fontWeight: strongWeight },
  3: { fontSize: 16, lineHeight: LINE_HEIGHT, fontWeight: strongWeight },
});

const styles = StyleSheet.create({
  root: { gap: Spacing.three - Spacing.one },
  headingGap: { marginTop: Spacing.one },
  strong: { fontWeight: strongWeight },
  em: { fontStyle: 'italic' },
  inlineCode: { fontFamily: Fonts.mono, fontSize: 14 },
  codeBlock: { borderRadius: 10, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two + Spacing.one },
  codeBlockText: { fontFamily: Fonts.mono, fontSize: 14, lineHeight: 20 },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.one },
  list: { gap: Spacing.one + Spacing.half },
  item: { flexDirection: 'row' },
  // The marker sits on the item's first line.
  marker: { height: LINE_HEIGHT, justifyContent: 'center' },
  number: { textAlign: 'right', paddingRight: Spacing.two, fontVariant: ['tabular-nums'] },
  bullet: { width: 6, height: 6, borderRadius: 3, marginLeft: Spacing.one + Spacing.half },
  itemBody: { flex: 1, minWidth: 0, gap: Spacing.one + Spacing.half },
});
