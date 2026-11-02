import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const fixtureDir = join(here, 'fixtures', 'sample');

export function tempCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'workmem-test-'));
  cpSync(fixtureDir, dir, { recursive: true });
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function tempEmpty() {
  const dir = mkdtempSync(join(tmpdir(), 'workmem-empty-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
