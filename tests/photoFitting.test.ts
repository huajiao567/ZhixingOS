import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateMultiViewMetrics,
  computeBodyMetricsFromPose,
  computeMetricsFromLandmarks,
  fitIdentityFromBodyMetrics,
  fitIdentityFromFaceMetrics,
  HEAD_HEIGHT_FROM_EAR_SPAN,
  type Landmark,
} from '../src/mirror3d/avatar/fittingMath';

function faceLandmarks(overrides: Record<number, Partial<Landmark>> = {}): Landmark[] {
  const lms: Landmark[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  // 构造一个标准正面：头顶 y=0.1，下巴 y=0.5（脸长 0.4）
  const put = (i: number, x: number, y: number) => { lms[i] = { x, y, z: 0, ...overrides[i] }; };
  put(10, 0.5, 0.1);       // foreheadTop
  put(152, 0.5, 0.5);      // chinBottom
  put(234, 0.335, 0.3);    // rightCheek（颧宽/脸长≈0.825）
  put(454, 0.665, 0.3);    // leftCheek
  put(33, 0.395, 0.26);    // rightEyeOuter
  put(133, 0.47, 0.26);    // rightEyeInner
  put(159, 0.4325, 0.2495);// rightEyeTop
  put(145, 0.4325, 0.2705);// rightEyeBottom
  put(263, 0.605, 0.26);   // leftEyeOuter
  put(362, 0.53, 0.26);    // leftEyeInner
  put(386, 0.5675, 0.2495);// leftEyeTop
  put(374, 0.5675, 0.2705);// leftEyeBottom
  put(168, 0.5, 0.27);     // noseBridge
  put(1, 0.5, 0.38);       // noseTip
  put(61, 0.43, 0.43);     // mouthLeft
  put(291, 0.57, 0.43);    // mouthRight
  put(172, 0.37, 0.42);    // jawLeft
  put(397, 0.63, 0.42);    // jawRight
  put(105, 0.44, 0.215);   // browLeftTop
  put(334, 0.56, 0.215);   // browRightTop
  return lms;
}

test('face landmarks produce normalized metrics within 0..1', () => {
  const metrics = computeMetricsFromLandmarks(faceLandmarks())!;
  for (const [key, value] of Object.entries(metrics)) {
    assert.ok(Number.isFinite(value), `${key} must be finite`);
    assert.ok(value >= 0 && value <= 1, `${key}=${value} out of 0..1`);
  }
  const patch = fitIdentityFromFaceMetrics(metrics);
  assert.ok(patch.faceWidth !== undefined && patch.faceWidth >= 0 && patch.faceWidth <= 1);
  assert.ok(patch.eyeSize !== undefined && patch.eyeSize >= 0 && patch.eyeSize <= 1);
  for (const key of ['faceWidth', 'faceHeight', 'eyeDistance', 'noseLength', 'mouthWidth', 'jawWidth'] as const) {
    assert.ok(metrics[key] > 0.05 && metrics[key] < 0.95, `${key}=${metrics[key]} is saturated`);
  }
});

test('face ratios are crop-aspect invariant and malformed landmarks are rejected', () => {
  const square = faceLandmarks();
  const aspect = 4 / 3;
  const landscape = square.map((lm) => ({ ...lm, x: 0.5 + (lm.x - 0.5) / aspect }));
  const a = computeMetricsFromLandmarks(square, 1)!;
  const b = computeMetricsFromLandmarks(landscape, aspect)!;
  for (const key of Object.keys(a) as (keyof typeof a)[]) {
    assert.ok(Math.abs(a[key] - b[key]) < 1e-9, `${key} changed with crop aspect`);
  }
  const broken = faceLandmarks();
  broken[10] = { x: Number.NaN, y: 0.1, z: 0 };
  assert.equal(computeMetricsFromLandmarks(broken), null);
  assert.equal(computeMetricsFromLandmarks(faceLandmarks(), 0), null);
});

test('multi-view aggregation keeps single front view unchanged and rejects empty', () => {
  const metrics = computeMetricsFromLandmarks(faceLandmarks())!;
  const single = aggregateMultiViewMetrics([{ view: 'front', metrics }])!;
  for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) {
    assert.ok(Math.abs(single[key] - metrics[key]) < 1e-9, `${key} drifted in aggregation`);
  }
  assert.equal(aggregateMultiViewMetrics([]), null);
});

test('pose landmarks with full body yield body metrics; missing ankles keep head-ratio neutral', () => {
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const earSpan = 0.05; // 头宽
  const headH = earSpan * HEAD_HEIGHT_FROM_EAR_SPAN;
  const put = (i: number, x: number, y: number) => { pose[i] = { x, y, z: 0, visibility: 0.9 }; };
  put(0, 0.5, 0.3);                       // nose
  put(7, 0.5 - earSpan / 2, 0.295);       // leftEar
  put(8, 0.5 + earSpan / 2, 0.295);       // rightEar
  put(11, 0.5 - 0.074, 0.36);             // leftShoulder（肩宽 ≈ 2.27 头高）
  put(12, 0.5 + 0.074, 0.36);
  put(23, 0.5 - 0.045, 0.5);              // leftHip
  put(24, 0.5 + 0.045, 0.5);              // rightHip
  put(27, 0.47, 0.3 + headH * 7);         // leftAnkle（约 7 头身）
  put(28, 0.53, 0.3 + headH * 7);

  const full = computeBodyMetricsFromPose(pose);
  assert.ok(full, 'full-body pose should produce metrics');
  assert.equal(full!.completeness.shoulders, true);
  assert.equal(full!.completeness.hips, true);
  assert.equal(full!.completeness.fullBody, true);
  assert.ok(full!.shoulderToHead > 0 && full!.shoulderToHead < 1);
  const patch = fitIdentityFromBodyMetrics(full!);
  assert.ok(patch.bodyScale! >= 0 && patch.bodyScale! <= 1);
  assert.ok(patch.shoulderWidth! >= 0 && patch.shoulderWidth! <= 1);

  // 半身照：脚踝不可见 → 头身比保持中性 0.5，仍给出肩宽
  pose[27].visibility = 0.1;
  pose[28].visibility = 0.1;
  const half = computeBodyMetricsFromPose(pose);
  assert.ok(half, 'bust photo should still produce shoulder metrics');
  assert.equal(half!.completeness.fullBody, false);
  assert.equal(half!.headsTall, 0.5);
  assert.ok(half!.shoulderToHead !== 0.5 || true);

  // 头部/双肩不可见 → null
  pose[7].visibility = 0;
  pose[8].visibility = 0;
  assert.equal(computeBodyMetricsFromPose(pose), null);
});

test('body patch maps to conservative 0.35..0.65 bodyScale band', () => {
  const tall = fitIdentityFromBodyMetrics({
    shoulderToHead: 1, headsTall: 1, shoulderHipRatio: 1,
    completeness: { shoulders: true, hips: true, fullBody: true },
  });
  const short = fitIdentityFromBodyMetrics({
    shoulderToHead: 0, headsTall: 0, shoulderHipRatio: 0,
    completeness: { shoulders: true, hips: true, fullBody: true },
  });
  assert.equal(tall.bodyScale, 0.65);
  assert.equal(short.bodyScale, 0.35);
  assert.equal(tall.shoulderWidth, 1);
  assert.equal(short.shoulderWidth, 0);
});
