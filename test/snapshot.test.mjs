import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tempCopy } from './helpers.mjs';
import { createSnapshot, listSnapshots, rollback, validateSnapshotName } from '../lib/core/snapshot.mjs';
import { loadStore } from '../lib/core/store.mjs';
import { updateEntry } from '../lib/core/mutations.mjs';
import { readEvents } from '../lib/core/events.mjs';

test('snapshot names reject traversal and bad characters', () => {
  assert.equal(validateSnapshotName('20261102-153000'), true);
  assert.equal(validateSnapshotName('pre-rollback-1'), true);
  assert.equal(validateSnapshotName('../evil'), false);
  assert.equal(validateSnapshotName('a/b'), false);
  assert.equal(validateSnapshotName(''), false);
});

test('creates, lists and restores a snapshot', () => {
  const { dir, cleanup } = tempCopy();
  try {
    const original = loadStore(dir).categories.facts.entries[0];
    const created = createSnapshot(dir, { name: 's1', note: '测试快照', now: '2026-11-02T16:00:00+08:00' });
    assert.equal(created.ok, true);
    assert.ok(existsSync(join(dir, '_snapshots', 's1', 'snapshot.json')));
    assert.ok(!existsSync(join(dir, '_snapshots', 's1', '_snapshots')));

    const listed = listSnapshots(dir);
    assert.ok(listed.some((x) => x.name === 's1' && x.size > 0));

    const changed = updateEntry(dir, original.id, { content: '被改过的内容。' }, { actor: '主人' });
    assert.equal(changed.ok, true);
    assert.equal(loadStore(dir).entries.find((e) => e.id === original.id).content, '被改过的内容。');

    const back = rollback(dir, 's1', { actor: '主人', now: '2026-11-02T16:05:00+08:00' });
    assert.equal(back.ok, true);
    assert.match(back.safety, /^pre-rollback-/);
    const restored = loadStore(dir).entries.find((e) => e.id === original.id);
    assert.equal(restored.content, original.content);
    assert.ok(listSnapshots(dir).some((x) => x.name === back.safety));
    assert.ok(readEvents(dir, { type: 'rollback' }).some((x) => x.name === 's1'));
  } finally {
    cleanup();
  }
});

test('refuses duplicate snapshot names', () => {
  const { dir, cleanup } = tempCopy();
  try {
    assert.equal(createSnapshot(dir, { name: 'same' }).ok, true);
    const again = createSnapshot(dir, { name: 'same' });
    assert.equal(again.ok, false);
    assert.equal(again.error, 'exists');
  } finally {
    cleanup();
  }
});
