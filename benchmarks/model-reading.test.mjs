import assert from 'node:assert/strict';
import test from 'node:test';
import { answerPage } from './model-reading.mjs';

test('agent usage includes repeated prompt context and verifies the source section', async () => {
  let turns = 0;
  const fixture = {
    question: 'What is the reading?',
    expected: '12.7 W',
    initial: JSON.stringify({ snapshot: 'digest', sections: [{ index: 0, title: 'Results' }] }),
    hasEvidence: text => text.includes('Probe D reads 12.7 W.'),
    async complete(messages, tools) {
      assert.equal(tools.length, 1);
      const usage = {
        prompt_tokens: ++turns * 10,
        completion_tokens: 3,
        total_tokens: turns * 10 + 8,
        prompt_tokens_details: { cached_tokens: 2 },
      };
      const message = turns === 1
        ? { tool_calls: [{ id: '1', type: 'function', function: {
          name: 'browser_read', arguments: '{"format":"section","cursor":"digest:0"}',
        } }] }
        : { content: '12.7 W' };
      if (turns === 2) assert.equal(messages.at(-1).role, 'tool');
      return { usage, message, model: 'fixture', finish_reason: 'stop' };
    },
    async read(args) {
      assert.deepEqual(args, { format: 'section', cursor: 'digest:0' });
      return { text: JSON.stringify({ text: 'Probe D reads 12.7 W.', next_cursor: null }) };
    },
  };
  const row = await answerPage(fixture);
  assert.equal(row.exactAnswer, true);
  assert.equal(row.evidenceRetained, true);
  assert.equal(row.modelCalls, 2);
  assert.equal(row.toolCalls, 1);
  assert.equal(row.mcpRequests, 2);
  assert.equal(row.usage.promptTokens, 30);
  assert.equal(row.usage.cachedPromptTokens, 4);
  assert.equal(row.usage.completionTokens, 6);
  assert.equal(row.usage.totalTokens, 46);
});
