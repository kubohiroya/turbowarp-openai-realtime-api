import {describe, expect, it} from 'vitest';
import {addUsage, emptyUsage} from '../src/usage.js';

const usage = {
  total_tokens: 1700,
  input_tokens: 1200,
  output_tokens: 500,
  input_token_details: {
    text_tokens: 400,
    audio_tokens: 800,
    cached_tokens: 600,
    cached_tokens_details: {text_tokens: 300, audio_tokens: 300}
  },
  output_token_details: {text_tokens: 100, audio_tokens: 400}
};

describe('addUsage', () => {
  it('accumulates token counts', () => {
    const totals = addUsage(addUsage(emptyUsage(), usage, 'gpt-realtime-2.1'), usage, 'gpt-realtime-2.1');
    expect(totals).toMatchObject({
      responses: 2,
      inputTokens: 2400,
      outputTokens: 1000,
      cachedInputTokens: 1200,
      textInputTokens: 800,
      audioInputTokens: 1600,
      cachedTextInputTokens: 600,
      cachedAudioInputTokens: 600,
      textOutputTokens: 200,
      audioOutputTokens: 800,
      unpricedResponses: 0
    });
  });

  it('prices uncached and cached tokens separately', () => {
    // 2.1: (100*4 + 300*0.4 + 500*32 + 300*0.4 + 100*24 + 400*64) / 1e6
    const expected = (100 * 4 + 300 * 0.4 + 500 * 32 + 300 * 0.4 + 100 * 24 + 400 * 64) / 1e6;
    expect(addUsage(emptyUsage(), usage, 'gpt-realtime-2.1').estimatedCostUsd).toBeCloseTo(expected, 12);
    const mini = (100 * 0.6 + 300 * 0.06 + 500 * 10 + 300 * 0.3 + 100 * 2.4 + 400 * 20) / 1e6;
    expect(addUsage(emptyUsage(), usage, 'gpt-realtime-2.1-mini').estimatedCostUsd).toBeCloseTo(mini, 12);
  });

  it('attributes cached tokens to text first when no breakdown is given', () => {
    const totals = addUsage(
      emptyUsage(),
      {input_token_details: {text_tokens: 100, audio_tokens: 500, cached_tokens: 250}},
      'gpt-realtime-2.1'
    );
    expect(totals.cachedTextInputTokens).toBe(100);
    expect(totals.cachedAudioInputTokens).toBe(150);
  });

  it('counts responses from unknown models without pricing them', () => {
    const totals = addUsage(emptyUsage(), usage, 'some-future-model');
    expect(totals.responses).toBe(1);
    expect(totals.unpricedResponses).toBe(1);
    expect(totals.estimatedCostUsd).toBe(0);
  });

  it('ignores malformed usage', () => {
    expect(addUsage(emptyUsage(), null, 'gpt-realtime-2.1')).toEqual(emptyUsage());
    expect(addUsage(emptyUsage(), {input_tokens: -5, output_tokens: 'x'}, 'gpt-realtime-2.1')).toMatchObject({
      responses: 1,
      inputTokens: 0,
      outputTokens: 0
    });
  });
});
