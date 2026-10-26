import assert from 'node:assert/strict';
import {test} from 'vitest';

import {finalizeReleaseTags} from '../scripts/finalize-release-tags.js';

const name = '@kubohiroya/turbowarp-kamishibai-app';
const version = '4.0.0-rc.58';
const sleep = async () => {};

test('waits for publication and verifies both tags after promotion', async () => {
  const commands: string[][] = [];
  let visible = false;
  const tags = {latest: '4.0.0-rc.49', next: version};
  const result = await finalizeReleaseTags(name, version, {
    sleep,
    run(args) {
      commands.push(args);
      if (args[2] === 'version') {
        if (!visible) {
          visible = true;
          throw Object.assign(new Error('pending'), {
            stdout: JSON.stringify({error: {code: 'E404'}}),
          });
        }
        return JSON.stringify(version);
      }
      if (args[0] === 'dist-tag') {
        tags.latest = version;
        return '';
      }
      return JSON.stringify(tags);
    },
  });
  assert.deepEqual(result, {latest: version, next: version});
  assert.deepEqual(
    commands.filter(([command]) => command === 'dist-tag'),
    [['dist-tag', 'add', `${name}@${version}`, 'latest']],
  );
});

test('already completed releases require no tag writes', async () => {
  await finalizeReleaseTags(name, version, {
    sleep,
    run(args) {
      assert.equal(args[0], 'view');
      return JSON.stringify(args[2] === 'version' ? version : {latest: version, next: version});
    },
  });
});

test('unpublished versions never change tags', async () => {
  await assert.rejects(
    finalizeReleaseTags(name, version, {
      sleep,
      attempts: 2,
      run(args) {
        assert.equal(args[0], 'view');
        throw Object.assign(new Error('pending'), {
          stdout: JSON.stringify({error: {code: 'E404'}}),
        });
      },
    }),
    /not visible/u,
  );
});

test('permission errors fail completion', async () => {
  const denied = new Error('OIDC permission denied');
  await assert.rejects(
    finalizeReleaseTags(name, version, {
      sleep,
      run(args) {
        if (args[0] === 'dist-tag') throw denied;
        return JSON.stringify(args[2] === 'version' ? version : {next: version});
      },
    }),
    denied,
  );
});

test('an unsuccessful tag write cannot be reported as a completed release', async () => {
  await assert.rejects(
    finalizeReleaseTags(name, version, {
      sleep,
      attempts: 2,
      run(args) {
        if (args[0] === 'dist-tag') return '';
        return JSON.stringify(args[2] === 'version' ? version : {next: version});
      },
    }),
    /incomplete/u,
  );
});
