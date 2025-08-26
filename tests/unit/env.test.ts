import { describe, it, expect } from 'vitest';
import { readDotEnv, sanitizeEnv, isWardenProject } from '../../src/lib/env.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const tmpDir = path.join(process.cwd(), 'tests', 'fixtures', 'warden-project');
const envPath = path.join(tmpDir, '.env');

describe('env utilities', () => {
  it('readDotEnv parses simple key/values and quotes', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(envPath, [
      'WARDEN_ENV_NAME=magento2',
      'TRAEFIK_DOMAIN="magento2.test"',
      '# comment',
      'EMPTY_VALUE=',
    ].join('\n'));

    const env = readDotEnv(tmpDir);
    expect(env.WARDEN_ENV_NAME).toBe('magento2');
    expect(env.TRAEFIK_DOMAIN).toBe('magento2.test');
    expect(env.EMPTY_VALUE).toBe('');
  });

  it('sanitizeEnv redacts sensitive keys', () => {
    const redacted = sanitizeEnv({
      PASSWORD: 'secret',
      API_TOKEN: 'tok123',
      PUBLIC: 'ok',
    });
    expect(redacted.PASSWORD).toBe('***redacted***');
    expect(redacted.API_TOKEN).toBe('***redacted***');
    expect(redacted.PUBLIC).toBe('ok');
  });

  it('isWardenProject validates WARDEN_ENV_NAME presence', () => {
    const ok = isWardenProject(tmpDir);
    const notOk = isWardenProject(process.cwd());
    expect(ok).toBe(true);
    expect(notOk).toBe(false);
  });
});

