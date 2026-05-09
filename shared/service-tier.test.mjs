import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServiceTier } from './service-tier.js';

test('normalizeServiceTier accepts only supported Codex service tiers', () => {
  assert.equal(normalizeServiceTier('fast'), 'fast');
  assert.equal(normalizeServiceTier('flex'), 'flex');
  assert.equal(normalizeServiceTier('standard'), null);
  assert.equal(normalizeServiceTier(''), null);
});
