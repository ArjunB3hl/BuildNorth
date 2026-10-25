// Run: node --experimental-strip-types --test src/lib/*.test.mjs   (Node 22.6+; the flag is the default from 23.6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coachAiService, SHARING_OFF, shareConfirmation, sharingRecipients } from './health-sharing.ts';

test('coachAiService: names a hosted provider, and says when the model runs on Rhythm\'s server', () => {
  assert.match(coachAiService('openai'), /OpenAI/);
  assert.match(coachAiService('anthropic'), /Anthropic/);
  assert.match(coachAiService('ollama'), /Rhythm's own server/);
  assert.doesNotMatch(coachAiService('ollama'), /OpenAI|Anthropic/);
});

test('coachAiService: an unknown provider (status not loaded, AI off) still discloses a possible third party', () => {
  for (const provider of [undefined, 'none', 'something-new']) {
    assert.match(coachAiService(provider), /third party such as OpenAI or Anthropic/);
  }
});

test('sharingRecipients: the Coach, the hosted memory service and connected assistants are all named', () => {
  const [coach, memory, assistants] = sharingRecipients('anthropic');
  assert.match(coach, /^sent to .*Anthropic/);
  assert.match(memory, /long-term memory service \(hosted by SurrealDB Cloud\)/);
  assert.match(assistants, /AI assistants you connect, such as ChatGPT or Claude/);
});

test('shareConfirmation: covers today so far, every recipient, and what turning it off does', () => {
  const message = shareConfirmation('openai');
  assert.match(message, /including today so far/);
  for (const line of sharingRecipients('openai')) assert.ok(message.includes(line), line);
  assert.match(message, /turn this off at any time; that erases them/);
});

test('SHARING_OFF: nobody sees them and memory is erased', () => {
  assert.match(SHARING_OFF, /none of them see your summaries/);
  assert.match(SHARING_OFF, /already in Rhythm's memory is erased/);
});
