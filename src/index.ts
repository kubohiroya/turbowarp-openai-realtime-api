import {extensionConfig} from './config.js';
import {OpenAIRealtimeExtension} from './extension.js';
import type {RuntimeLike} from './runtime-types.js';

if (extensionConfig.unsandboxed && !Scratch.extensions.unsandboxed) {
  throw new Error(`${extensionConfig.name} must run unsandboxed.`);
}

const runtime = Scratch.vm?.runtime as RuntimeLike | undefined;
if (!runtime) {
  throw new Error(`${extensionConfig.name} requires access to the TurboWarp VM runtime.`);
}

Scratch.extensions.register(new OpenAIRealtimeExtension({runtime}));
