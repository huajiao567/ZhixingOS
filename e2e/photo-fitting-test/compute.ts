// 用 App 真实代码（fittingMath）从落盘 landmarks 计算 metrics 与 identity patch。
// 用法：backend/node_modules/.bin/tsx.cmd e2e/photo-fitting-test/compute.ts
import { readFileSync, writeFileSync } from 'node:fs';
import {
  computeBodyMetricsFromPose,
  computeMetricsFromLandmarks,
  fitIdentityFromBodyMetrics,
  fitIdentityFromFaceMetrics,
} from '../../src/mirror3d/avatar/fittingMath';

type Raw = {
  file: string;
  width?: number;
  height?: number;
  faceLandmarks?: unknown[] | null;
  poseLandmarks?: unknown[] | null;
  error?: string;
};

const results = JSON.parse(readFileSync('e2e/photo-fitting-test/landmarks.json', 'utf-8')) as Raw[];

const report = results.map((r) => {
  const face = r.faceLandmarks ? computeMetricsFromLandmarks(r.faceLandmarks as any, (r.width ?? 1) / (r.height ?? 1)) : null;
  const body = r.poseLandmarks ? computeBodyMetricsFromPose(r.poseLandmarks as any, (r.width ?? 1) / (r.height ?? 1)) : null;
  const facePatch = face ? fitIdentityFromFaceMetrics(face) : null;
  const bodyPatch = body ? fitIdentityFromBodyMetrics(body) : null;
  const round = (v: unknown) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v);
  return {
    file: r.file,
    pixels: r.width && r.height ? `${r.width}x${r.height}` : undefined,
    error: r.error,
    face: face ? {
      roundness: round(face.faceRoundness), width: round(face.faceWidth),
      eyeSize: round(face.eyeSize), eyeSpacing: round(face.eyeDistance),
      nose: round(face.noseLength), mouth: round(face.mouthWidth),
      jaw: round(face.jawWidth), brow: round(face.browProminence),
    } : null,
    body: body ? {
      shoulderToHead: round(body.shoulderToHead),
      headsTall: body.completeness.fullBody ? round(body.headsTall) : 'n/a(半身)',
      shoulderHipRatio: body.completeness.hips ? round(body.shoulderHipRatio) : 'n/a(无髋)',
      completeness: body.completeness,
    } : null,
    identityPatch: {
      ...(facePatch ?? {}),
      ...(bodyPatch ?? {}),
    },
  };
});

const withFace = report.filter((r) => r.face).length;
const withBody = report.filter((r) => r.body?.completeness.shoulders).length;
const fullBody = report.filter((r) => r.body?.completeness.fullBody).length;
console.log(`face detected: ${withFace}/${report.length}, body(shoulders): ${withBody}/${report.length}, full-body: ${fullBody}/${report.length}`);
console.log(JSON.stringify(report, null, 1));

writeFileSync('e2e/photo-fitting-test/report.json', JSON.stringify(report, null, 2));
console.log('wrote e2e/photo-fitting-test/report.json');
