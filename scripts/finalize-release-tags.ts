import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {setTimeout} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

type Run = (args: string[]) => string;

/** Complete a verified release; trial publications must not call this operation. */
export async function finalizeReleaseTags(
  name: string,
  version: string,
  {
    run = (args: string[]) => execFileSync('npm', args, {encoding: 'utf8'}),
    sleep = () => setTimeout(10_000),
    attempts = 60,
  }: {run?: Run; sleep?: () => Promise<void>; attempts?: number} = {},
) {
  assert.match(name, /^@kubohiroya\/[a-z0-9-]+$/u);
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  let visible = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let output: string;
    try {
      output = run(['view', `${name}@${version}`, 'version', '--json', '--prefer-online']);
    } catch (error) {
      const stdout = (error as {stdout?: string}).stdout;
      if (!stdout || JSON.parse(stdout).error?.code !== 'E404') throw error;
      if (attempt + 1 < attempts) await sleep();
      continue;
    }
    assert.equal(JSON.parse(output), version, 'Registry version differs from the release.');
    visible = true;
    break;
  }
  assert(visible, 'Release is not visible in npm; tags were not changed.');
  const readTags = () =>
    JSON.parse(run(['view', name, 'dist-tags', '--json', '--prefer-online'])) as Record<
      string,
      string
    >;
  const before = readTags();
  for (const tag of ['latest', 'next']) {
    if (before[tag] !== version) run(['dist-tag', 'add', `${name}@${version}`, tag]);
  }
  // Tag writes and registry reads can be served by different replicas.
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const tags = readTags();
    if (tags.latest === version && tags.next === version) return tags;
    if (attempt + 1 < attempts) await sleep();
  }
  throw new Error('Release is incomplete: latest and next do not both match the release.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [name, version] = process.argv.slice(2);
  assert(name && version, 'Usage: finalize-release-tags.ts <package> <version>');
  const tags = await finalizeReleaseTags(name, version);
  console.log(JSON.stringify({package: name, version, latest: tags.latest, next: tags.next}));
}
