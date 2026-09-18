// Type-checks the published composition API the way a downstream package imports it.
import {
  createRealtimeComposition,
  type RealtimeComposition,
  type RealtimeCompositionEvent,
  type RuntimeLike,
  type UsageTotals
} from '../dist/types/composition.js';

declare const runtime: RuntimeLike;

const realtime: RealtimeComposition = createRealtimeComposition({
  runtime,
  functionHatOpcode: 'downstream_defineFunction'
});
realtime.setModel('gpt-realtime-2.1-mini');
realtime.setOutputMode('text');
realtime.setSessionTimeLimit(600);
const unsubscribe = realtime.subscribe((event: RealtimeCompositionEvent) => {
  if (event.type === 'usage') {
    const usage: Readonly<UsageTotals> = event.usage;
    void usage.estimatedCostUsd;
  }
});
void realtime.connect({microphone: false});
unsubscribe();
realtime.release();
