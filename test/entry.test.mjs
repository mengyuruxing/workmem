import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fixtureDir } from './helpers.mjs';
import {
  CATEGORIES,
  entryValid,
  makeEntry,
  parseCategoryFile,
  serializeCategoryFile
} from '../lib/core/entry.mjs';

function readFixture(category, file) {
  return readFileSync(join(fixtureDir, file), 'utf8');
}

test('parses the fixture rules entry', () => {
  const { entries, warnings } = parseCategoryFile(readFixture('rules', 'work/rules.md'), 'rules');
  assert.equal(warnings.length, 0);
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.id, 'a1b2c3d4');
  assert.equal(e.category, 'rules');
  assert.equal(e.source, 'quote');
  assert.equal(e.status, 'active');
  assert.equal(e.importance, 4);
  assert.equal(e.project, '');
  assert.deepEqual(e.keywords, ['备份', '记忆库', '回滚']);
  assert.match(e.content, /整库备份/);
  assert.equal(e.quote_edited, false);
  assert.equal(entryValid(e), true);
});

test('parses all five fixture files', () => {
  const files = {
    rules: 'work/rules.md',
    facts: 'work/facts.md',
    pitfalls: 'work/pitfalls.md',
    progress: 'work/progress.md',
    persona: 'persona/persona.md'
  };
  const ids = new Set();
  for (const category of CATEGORIES) {
    const { entries, warnings } = parseCategoryFile(readFixture(category, files[category]), category);
    assert.equal(warnings.length, 0, category);
    assert.equal(entries.length, 1, category);
    assert.ok(!ids.has(entries[0].id));
    ids.add(entries[0].id);
  }
  assert.equal(ids.size, 5);
});

test('round-trips all fixture entries without losing fields', () => {
  for (const category of CATEGORIES) {
    const file = {
      rules: 'work/rules.md', facts: 'work/facts.md', pitfalls: 'work/pitfalls.md',
      progress: 'work/progress.md', persona: 'persona/persona.md'
    }[category];
    const first = parseCategoryFile(readFixture(category, file), category).entries;
    const text = serializeCategoryFile(first, category);
    const second = parseCategoryFile(text, category).entries;
    assert.equal(second.length, first.length);
    for (let i = 0; i < first.length; i += 1) {
      const a = first[i];
      const b = second[i];
      for (const key of ['id', 'category', 'title', 'content', 'source', 'status', 'importance', 'project', 'created_at', 'updated_at', 'quote_edited']) {
        assert.deepEqual(b[key], a[key], category + '.' + key);
      }
      assert.deepEqual(b.keywords, a.keywords);
      assert.deepEqual(b.extra, a.extra);
      assert.equal(entryValid(b), true);
    }
  }
});

test('preserves unknown metadata fields', () => {
  const text = [
    '## [deadbeef] 测试条目',
    '- 来源：原话',
    '- 状态：正常',
    '- 重要度：★★★',
    '- 写入：2026-11-02T15:00:00+08:00',
    '- 更新：2026-11-02T15:00:00+08:00',
    '- 自定义：保留我',
    '',
    '正文'
  ].join('\n');
  const first = parseCategoryFile(text, 'rules').entries[0];
  assert.deepEqual(first.extra, [{ key: '自定义', value: '保留我' }]);
  const second = parseCategoryFile(serializeCategoryFile([first], 'rules'), 'rules').entries[0];
  assert.deepEqual(second.extra, [{ key: '自定义', value: '保留我' }]);
});

test('accepts CRLF and reports duplicate ids', () => {
  const text = [
    '## [aaaaaaaa] 一',
    '- 来源：总结', '- 状态：正常', '- 重要度：★★', '- 写入：2026-11-02T15:00:00+08:00', '- 更新：2026-11-02T15:00:00+08:00', '', '甲',
    '## [aaaaaaaa] 二',
    '- 来源：总结', '- 状态：正常', '- 重要度：★★', '- 写入：2026-11-02T15:00:00+08:00', '- 更新：2026-11-02T15:00:00+08:00', '', '乙'
  ].join('\r\n');
  const { entries, warnings } = parseCategoryFile(text, 'facts');
  assert.equal(entries.length, 2);
  assert.ok(warnings.some((w) => w.code === 'duplicate-id'));
  assert.equal(entryValid(entries[0]), true);
  assert.equal(entryValid(entries[1]), false);
});

test('marks missing required fields as invalid', () => {
  const text = '## [bbbbbbbb] 缺东西\n\n只有正文';
  const e = parseCategoryFile(text, 'facts').entries[0];
  assert.equal(entryValid(e), false);
  assert.ok(e.issues.some((x) => x.code === 'missing-source'));
  assert.ok(e.issues.some((x) => x.code === 'missing-created'));
});

test('serializes an empty category as header only', () => {
  assert.equal(serializeCategoryFile([], 'rules'), '# 规矩\n');
});

test('makeEntry creates a clean active entry', () => {
  const e = makeEntry({ category: 'facts', title: ' 路径 ', content: '  C:\\x  ', source: '工具', importance: 3 });
  assert.match(e.id, /^[0-9a-f]{8}$/);
  assert.equal(e.title, '路径');
  assert.equal(e.content, 'C:\\x');
  assert.equal(e.source, 'tool');
  assert.equal(e.status, 'active');
  assert.equal(e.importance, 3);
  assert.equal(entryValid(e), true);
});

test('preserves full-width punctuation in quote bodies', () => {
  const text = [
    '## [cccccccc] 原话测试',
    '- 来源：原话',
    '- 状态：正常',
    '- 重要度：★★★',
    '- 写入：2026-11-02T15:00:00+08:00',
    '- 更新：2026-11-02T15:00:00+08:00',
    '- 原话已改：否',
    '',
    '他说“好”，然后走了（真的）。'
  ].join('\n');
  const first = parseCategoryFile(text, 'rules').entries[0];
  assert.equal(first.content, '他说“好”，然后走了（真的）。');
  const second = parseCategoryFile(serializeCategoryFile([first], 'rules'), 'rules').entries[0];
  assert.equal(second.content, first.content);
  const made = makeEntry({ category: 'rules', title: 'x', content: '（测试）“引号”', source: 'quote' });
  assert.equal(made.content, '（测试）“引号”');
});

test('pinned round-trips and legacy quote_edited only writes when true', () => {
  const made = makeEntry({ category: 'rules', title: '钉住', content: '正文', source: 'quote', pinned: true });
  const text = serializeCategoryFile([made], 'rules');
  assert.match(text, /- 钉住：是/);
  assert.ok(!text.includes('- 原话已改：否'));
  const parsed = parseCategoryFile(text, 'rules').entries[0];
  assert.equal(parsed.pinned, true);
  assert.equal(parsed.quote_edited, false);

  const legacy = makeEntry({ category: 'rules', title: '旧原话', content: '旧正文', source: 'quote', quote_edited: true });
  const legacyText = serializeCategoryFile([legacy], 'rules');
  assert.match(legacyText, /- 原话已改：是/);
});
