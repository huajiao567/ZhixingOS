import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('strict-local Android source contains no ML Kit or Firebase vision dependency', () => {
  const gradle = read('modules/zhixing-vision/android/build.gradle');
  const kotlin = read('modules/zhixing-vision/android/src/main/java/com/zhixingos/vision/ZhixingVisionModule.kt');
  const forbidden = /com\.google\.(?:mlkit|firebase)|firebase-installations|firebase-config/i;
  assert.doesNotMatch(gradle, forbidden);
  assert.doesNotMatch(kotlin, forbidden);
});

test('strict-local native automatic photo fitting fails closed', () => {
  const bridge = read('modules/zhixing-vision/index.ts');
  const fitting = read('src/mirror3d/avatar/photoFitting.ts');
  assert.match(bridge, /hasNativePhotoFitting\(\): boolean \{\s*return false;/s);
  assert.match(fitting, /Platform\.OS !== 'web' && !hasNativePhotoFitting\(\)/);
});

test('Android disables backup and cleartext traffic', () => {
  const app = JSON.parse(read('app.json'));
  assert.equal(app.expo.android.allowBackup, false);
  const buildProperties = app.expo.plugins.find((plugin: unknown) =>
    Array.isArray(plugin) && plugin[0] === 'expo-build-properties',
  );
  assert.ok(buildProperties, 'expo-build-properties config is required');
  assert.equal(buildProperties[1].android.usesCleartextTraffic, false);
});

test('native network boundary only permits explicitly configured HTTPS LLM origin', () => {
  const boundary = read('src/services/nativeNetworkBoundary.ts');
  assert.match(boundary, /url\.protocol === 'https:'/);
  assert.match(boundary, /sameOrigin && withinBasePath/);
  assert.match(boundary, /NativeNetworkBoundary\] BLOCKED/);
  assert.match(boundary, /原生本地模式已阻止非大模型网络请求/);
});
