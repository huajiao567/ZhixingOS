import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFormFactor, isDesktopSurface } from '../src/platform/formFactor';

test('wide web opens the desktop workbench', () => {
  assert.equal(classifyFormFactor({ width: 1440, platform: 'web' }), 'desktop');
  assert.equal(isDesktopSurface({ width: 1100, platform: 'web' }), true);
});

test('narrow web stays on the mobile companion surface', () => {
  assert.equal(classifyFormFactor({ width: 1099, platform: 'web' }), 'mobile');
  assert.equal(classifyFormFactor({ width: 390, platform: 'web' }), 'mobile');
});

test('native devices never become desktop solely because of screen width', () => {
  assert.equal(classifyFormFactor({ width: 1366, platform: 'ios' }), 'mobile');
  assert.equal(classifyFormFactor({ width: 1600, platform: 'android' }), 'mobile');
});

test('invalid width fails closed to mobile', () => {
  assert.equal(classifyFormFactor({ width: Number.NaN, platform: 'web' }), 'mobile');
});
