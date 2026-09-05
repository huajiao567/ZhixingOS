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

export function hasNativePhotoFitting(): boolean {
  return nativeModule !== null;
}

export async function detectNativeFaceLandmarks(imageUri: string): Promise<NativeVisionResult | null> {
  if (!nativeModule) throw new Error('当前安装包未包含端侧人脸拟合模块，请安装最新完整 APK');
  return nativeModule.detectFaceLandmarks(imageUri);
}

export async function detectNativePoseLandmarks(imageUri: string): Promise<NativeVisionResult | null> {
  if (!nativeModule) throw new Error('当前安装包未包含端侧体格拟合模块，请安装最新完整 APK');
  return nativeModule.detectPoseLandmarks(imageUri);
}
