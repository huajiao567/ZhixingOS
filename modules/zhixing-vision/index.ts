import { requireOptionalNativeModule } from 'expo';

export interface NativeVisionLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface NativeVisionResult {
  landmarks: NativeVisionLandmark[];
  width: number;
  height: number;
}

interface ZhixingVisionNativeModule {
  detectFaceLandmarks(imageUri: string): Promise<NativeVisionResult | null>;
  detectPoseLandmarks(imageUri: string): Promise<NativeVisionResult | null>;
}

const nativeModule = requireOptionalNativeModule<ZhixingVisionNativeModule>('ZhixingVision');

/**
 * Strict-local builds intentionally disable native automatic photo fitting.
 * The module can still be linked as a compatibility stub, so module presence
 * must not be interpreted as capability availability.
 */
export function hasNativePhotoFitting(): boolean {
  return false;
}

export async function detectNativeFaceLandmarks(imageUri: string): Promise<NativeVisionResult | null> {
  if (!nativeModule) throw new Error('当前安装包未包含端侧人脸拟合模块');
  return nativeModule.detectFaceLandmarks(imageUri);
}

export async function detectNativePoseLandmarks(imageUri: string): Promise<NativeVisionResult | null> {
  if (!nativeModule) throw new Error('当前安装包未包含端侧体格拟合模块');
  return nativeModule.detectPoseLandmarks(imageUri);
}
