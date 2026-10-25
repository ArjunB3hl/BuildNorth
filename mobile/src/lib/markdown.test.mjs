// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown, toPlainText, unescapeLineBreaks } from './markdown.ts';

const text = (value) => ({ type: 'text', text: value });
const strong = (...children) => ({ type: 'strong', children });
const em = (...children) => ({ type: 'em', children });
const code = (value) => ({ type: 'code', text: value });
const paragraph = (...children) => ({ type: 'paragraph', children });
const item = (children, lists = []) => ({ children, lists });

test('bold, italic and inline code', () => {
  assert.deepEqual(parseInline('**Chickpea Spinach Curry**'), [strong(text('Chickpea Spinach Curry'))]);
  assert.deepEqual(parseInline('a *b* and _c_ with `d*e`'), [
    text('a '), em(text('b')), text(' and '), em(text('c')), text(' with '), code('d*e'),
  ]);
  assert.deepEqual(parseInline('***both***'), [strong(em(text('both')))]);
  assert.deepEqual(parseInline('**bold *inner* bold**'), [strong(text('bold '), em(text('inner')), text(' bold'))]);
  assert.deepEqual(parseInline('**a *b***'), [strong(text('a '), em(text('b')))]);
  assert.deepEqual(parseInline('__also bold__'), [strong(text('also bold'))]);
});

test('unmatched or spaced delimiters stay as written', () => {
  for (const input of ['2 * 3 * 4', 'snake_case_name', '**not closed', 'a ** b **', '`open', '* not a list here']) {
    assert.deepEqual(parseInline(input), [text(input)], input);
  }
  assert.deepEqual(parseInline('\\*literal\\*'), [text('*literal*')]);
  assert.deepEqual(parseInline('***a**'), [text('*'), strong(text('a'))]);
});

test('HTML and links are never interpreted', () => {
  const input = '<script>alert(1)</script> [site](javascript:alert(1)) <b>x</b>';
  assert.deepEqual(parseMarkdown(input), [paragraph(text(input))]);
});

test('paragraphs keep single line breaks and split on blank lines', () => {
  assert.deepEqual(parseMarkdown('one\ntwo  \n\n\nthree'), [paragraph(text('one\ntwo')), paragraph(text('three'))]);
  assert.deepEqual(parseMarkdown('   '), []);
});

test('headings at three levels', () => {
  assert.deepEqual(parseMarkdown('# One\n## Two ##\n### Three\n#### Four\n#nospace'), [
    { type: 'heading', level: 1, children: [text('One')] },
    { type: 'heading', level: 2, children: [text('Two')] },
    { type: 'heading', level: 3, children: [text('Three')] },
    { type: 'heading', level: 3, children: [text('Four')] },
    paragraph(text('#nospace')),
  ]);
  assert.deepEqual(parseMarkdown('Title\n==='), [{ type: 'heading', level: 1, children: [text('Title')] }]);
});

test('bullet and numbered lists, including nesting and continuation lines', () => {
  const blocks = parseMarkdown([
    'Here is the plan:',
    '1. **Monday:** curry',
    '   Prep 20 minutes',
    '   - chickpeas',
    '   - spinach',
    '     * fresh',
    '2. Tuesday',
    '',
    '3. Wednesday',
    'After the list.',
  ].join('\n'));
  assert.deepEqual(blocks, [
    paragraph(text('Here is the plan:')),
    {
      type: 'list', ordered: true, start: 1, items: [
        item([strong(text('Monday:')), text(' curry\nPrep 20 minutes')], [
          { type: 'list', ordered: false, start: 1, items: [
            item([text('chickpeas')]),
            item([text('spinach')], [{ type: 'list', ordered: false, start: 1, items: [item([text('fresh')])] }]),
          ] },
        ]),
        item([text('Tuesday')]),
        item([text('Wednesday')]),
      ],
    },
    paragraph(text('After the list.')),
  ]);
});

test('numbered lists keep their start and bullets and numbers do not merge', () => {
  const blocks = parseMarkdown('3. c\n4. d\n- e');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].start, 3);
  assert.equal(blocks[0].items.length, 2);
  assert.equal(blocks[1].ordered, false);
});

test('rules, fenced code and a rule-like bullet line', () => {
  assert.deepEqual(parseMarkdown('a\n\n---\n\n* * *\n```js\nconst x = **1**;\n```\n`inline` only'), [
    paragraph(text('a')),
    { type: 'rule' },
    { type: 'rule' },
    { type: 'code', text: 'const x = **1**;' },
    paragraph(code('inline'), text(' only')),
  ]);
  assert.deepEqual(parseMarkdown('```unclosed\nkeeps going'), [{ type: 'code', text: 'keeps going' }]);
  assert.deepEqual(parseMarkdown('```inline code```'), [paragraph(code('inline code'))]);
});

test('literal backslash-n from the model becomes a line break outside code', () => {
  assert.equal(unescapeLineBreaks('*Ingredients:*\\n- oil\\n- onion'), '*Ingredients:*\n- oil\n- onion');
  assert.equal(unescapeLineBreaks('use `a\\nb` here\\nnext'), 'use `a\\nb` here\nnext');
  assert.equal(unescapeLineBreaks('C:\\\\new'), 'C:\\\\new');
  const blocks = parseMarkdown(unescapeLineBreaks('*Ingredients:*\\n- 1 tbsp olive oil\\n- 1 onion'));
  assert.equal(blocks[1].type, 'list');
  assert.equal(blocks[1].items.length, 2);
});

test('plain-text previews drop the syntax', () => {
  assert.equal(
    toPlainText('**Ingredients:**\\n- 1 tbsp *olive* oil\\n- 1 onion\n\n## Steps\n1. Heat'),
    'Ingredients: 1 tbsp olive oil · 1 onion · Steps · Heat',
  );
});

test('pathological input stays fast', () => {
  const start = Date.now();
  parseMarkdown('*a _b `c '.repeat(2000));
  assert.ok(Date.now() - start < 2000);
});
