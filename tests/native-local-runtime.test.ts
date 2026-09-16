import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { deriveLocalState, localDivergence } from '../src/engine/localStateEngine';

test('local six-position engine derives state without a server', () => {
  const state = deriveLocalState([
    { id: 'i1', axis: 'inner', domain: '工作', mood: -0.3, title: '主观疲惫' },
    { id: 'o1', axis: 'outer', domain: '工作', mood: 0.2, title: '完成工作' },
  ] as any, [
    { id: 'c1', status: 'active', statement: '完成一个可验证步骤' },
  ] as any);
  assert.equal(typeof state.divergence, 'number');
  assert.equal(state.inner.L4 > 0, true);
  assert.equal(state.outer.L4 > 0, true);
});

test('local divergence is deterministic and bounded', () => {
  const a = { L1: 1, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };
  const b = { L1: 1, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };
  const c = { L1: -1, L2: 0, L3: 0, L4: 0, L5: 0, L6: 0 };
  assert.equal(localDivergence(a, b), 0);
  assert.equal(localDivergence(a, c), 1);
});

test('Android release config disables OS backup and cleartext traffic', () => {
  const app = JSON.parse(fs.readFileSync('app.json', 'utf8'));
  assert.equal(app.expo.android.allowBackup, false);
  const buildProps = app.expo.plugins.find((item: unknown) => Array.isArray(item) && item[0] === 'expo-build-properties');
  assert.ok(buildProps);
  assert.equal(buildProps[1].android.usesCleartextTraffic, false);
  assert.equal(app.expo.android.versionCode >= 2, true);
});

test('native bootstrap installs a fail-closed network boundary', () => {
  const appSource = fs.readFileSync('App.tsx', 'utf8');
  const boundary = fs.readFileSync('src/services/nativeNetworkBoundary.ts', 'utf8');
  assert.match(appSource, /installNativeLocalNetworkBoundary\(\)/);
  assert.match(boundary, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(boundary, /原生本地模式已阻止非大模型网络请求/);
  assert.match(boundary, /config\.enabled/);
});
