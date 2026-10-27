import console from 'node:console';
import {cp, mkdir, rm} from 'node:fs/promises';
import {URL} from 'node:url';
import {buildSamples, manifest} from './build-samples.mjs';

const root = new URL('../', import.meta.url);
const output = new URL('_site/', root);
await buildSamples({check: true});
await rm(output, {recursive: true, force: true});
await cp(new URL('site/', root), output, {recursive: true});
await cp(new URL('dist/', root), new URL('dist/', output), {recursive: true});
await mkdir(new URL('samples/', output), {recursive: true});
for (const {name} of manifest.samples) {
  await cp(new URL(`samples/${name}.sb3`, root), new URL(`samples/${name}.sb3`, output));
}
console.log('GitHub Pages artifact: _site/');
