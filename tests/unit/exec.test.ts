import { describe, it, expect } from 'vitest';
import { cleanMagentoOutput, run } from '../../src/lib/exec.js';
import * as path from 'node:path';

describe('exec helpers', () => {
  it('cleanMagentoOutput removes noisy lines', () => {
    const input = [
      '[2025-08-26 03:24:36] main.DEBUG: something',
      'cache_invalidate: foo',
      '[]',
      '{"method":"GET","url":"/status"}',
      'Useful line',
      '',
    ].join('\n');
    const out = cleanMagentoOutput(input);
    expect(out).toBe('Useful line');
  });

  it('run executes a simple node script and captures stdout', async () => {
    const script = path.join(process.cwd(), 'tests', 'fixtures', 'echo.mjs');
    const res = await run(process.execPath, [script, 'hello', 'world'], process.cwd(), 10_000);
    expect(res.ok).toBe(true);
    expect(res.stdout.trim()).toBe('hello world');
  });
});

