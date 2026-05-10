import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

// grafema is not available in CI — skip this suite when not in PATH
const grafemaAvailable = (() => {
  try {
    execSync('which grafema', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test.describe('grafema smoke', () => {
  test.skip(!grafemaAvailable, 'grafema not in PATH — skipping smoke tests');

  test('grafema --version exits 0', () => {
    expect(() => execSync('grafema --version', { stdio: 'ignore' })).not.toThrow();
  });
});
