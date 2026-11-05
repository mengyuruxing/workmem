import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'sample');

const categories = {
  rules: 'work/rules.md',
  facts: 'work/facts.md',
  pitfalls: 'work/pitfalls.md',
  progress: 'work/progress.md'
};

test('fixture has four category files and unique eight-hex ids', () => {
  const seen = new Set();
  let total = 0;
  for (const [category, file] of Object.entries(categories)) {
    const text = readFileSync(join(root, file), 'utf8');
    const entries = [...text.matchAll(/^## \[([0-9a-f]{8})\] (.+)$/gm)];
    assert.ok(entries.length > 0, `${category} should have at least one entry`);
    for (const entry of entries) {
      assert.ok(!seen.has(entry[1]), `duplicate id ${entry[1]}`);
      seen.add(entry[1]);
      total += 1;
    }
  }
  assert.equal(total, 4);
});

test('fixture sidecar json parses', () => {
  for (const file of ['_stats.json', '_weights.json', '_settings.json']) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(join(root, file), 'utf8')), file);
  }
});

test('fixture jsonl lines parse', () => {
  for (const file of ['_audit/edits.jsonl', '_logs/events.jsonl']) {
    const lines = readFileSync(join(root, file), 'utf8').trim().split(/\r?\n/);
    assert.ok(lines.length > 0, file);
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `${file}: ${line.slice(0, 40)}`);
    }
  }
});
