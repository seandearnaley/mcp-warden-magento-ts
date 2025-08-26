import { describe, it, expect } from 'vitest';
import { validateWardenExecInput } from '../../src/tools/warden.js';

describe('warden.exec input validation', () => {
  it('accepts reasonable service and argv', () => {
    const res = validateWardenExecInput('php-fpm', ['php', '-v']);
    expect(res.ok).toBe(true);
  });

  it('rejects bad service names', () => {
    expect(validateWardenExecInput('bad name', ['ls']).ok).toBe(false);
    expect(validateWardenExecInput('', ['ls']).ok).toBe(false);
  });

  it('rejects empty or oversized argv', () => {
    expect(validateWardenExecInput('php-fpm', []).ok).toBe(false);
    const big = new Array(51).fill('x');
    expect(validateWardenExecInput('php-fpm', big).ok).toBe(false);
  });
});

