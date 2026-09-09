import { useRef } from 'react';
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File, Paths } from 'expo-file-system';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { registerSourcePermission } from './permissions';

export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
  fileName?: string;
  fileSize?: number;
  assetId?: string;
  sourceRef: string;
  /** Persisted source-permission row authorizing this exact capture path. */
  consentId: string;
}

export interface CapturedAudio {
  uri: string;
  durationMs: number;
  mimeType: string;
  sourceRef: string;
  /** Persisted microphone source-permission row for this recording session. */
  consentId: string;
}

type CapturedPhotoDraft = Omit<CapturedPhoto, 'consentId'>;

function opaqueLocalReference(kind: 'photo' | 'audio', value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `${kind}:local:${(result >>> 0).toString(36)}`;
}

function assetToCapturedPhoto(asset: ImagePicker.ImagePickerAsset): CapturedPhotoDraft {
  if (!asset.uri) throw new Error('系统没有返回可读取的照片 URI');
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? undefined,
    fileSize: asset.fileSize,
    assetId: asset.assetId ?? undefined,
    // The server receives only an opaque receipt, never a device path or content URI.
    sourceRef: opaqueLocalReference('photo', asset.assetId ?? asset.uri),
  };
}

export async function pickPhoto(): Promise<CapturedPhoto | null> {
  const response = await ImagePicker.requestMediaLibraryPermissionsAsync(false);
  if (!response.granted) throw new Error('照片权限未获授权，未保存任何占位内容');
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const photo = assetToCapturedPhoto(result.assets[0]);
  const permission = await registerSourcePermission('photo', '仅保存用户主动选择照片的不透明来源凭据和尺寸，不自动上传路径或像素', {
    access: 'selected_asset_only',
    upload: false,
  });
  return { ...photo, consentId: permission.id };
}

export async function takePhoto(): Promise<CapturedPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('相机权限未获授权，未保存任何占位内容');
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    quality: 1,
    exif: false,
    base64: false,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const photo = assetToCapturedPhoto(result.assets[0]);
  const sourcePermission = await registerSourcePermission('photo', '仅保存用户主动拍摄照片的不透明来源凭据和尺寸，不自动上传路径或像素', {
    access: 'captured_asset_only',
    upload: false,
  });
  return { ...photo, consentId: sourcePermission.id };
}

/**
 * 清除 ImagePicker/Camera 在应用缓存目录生成的工作副本。
 * 只删除 Paths.cache 下的 file URI，绝不触碰系统相册原件或任意 content URI。
 */
export function deleteTemporaryPhotoCopy(uri: string): boolean {
  if (Platform.OS === 'web' || !uri.startsWith('file://') || !uri.startsWith(Paths.cache.uri)) return false;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch (error) {
    console.warn('[mediaCapture] 临时照片副本清除失败:', error);
    return false;
  }
}

function deleteAppOwnedAudio(uri: string | null): boolean {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file://')) return false;
  if (!uri.startsWith(Paths.document.uri) && !uri.startsWith(Paths.cache.uri)) return false;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
    return true;
  } catch (error) {
    console.warn('[mediaCapture] 已取消录音清除失败:', error);
    return false;
  }
}

export function useAudioCapture() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, directory: 'document' });
  const state = useAudioRecorderState(recorder, 200);
  const consentIdRef = useRef<string | null>(null);

  return {
    isRecording: state.isRecording,
    durationMs: state.durationMillis,

    start: async (): Promise<void> => {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) throw new Error('麦克风权限未获授权，录音没有开始');
      const sourcePermission = await registerSourcePermission('microphone', '仅在按下录音后采集声音；服务端只保存不含原始路径的不透明来源凭据', {
        access: 'foreground_recording',
        background: false,
        upload: false,
      });
      consentIdRef.current = sourcePermission.id;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    },

    stop: async (): Promise<CapturedAudio> => {
      const durationMs = state.durationMillis || Math.round(recorder.currentTime * 1000);
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = recorder.uri;
      if (!uri) throw new Error('录音停止后没有生成文件 URI，未写入记录');
      const consentId = consentIdRef.current;
      consentIdRef.current = null;
      if (!consentId) throw new Error('录音缺少可追溯的麦克风授权记录，已阻止写入');
      return {
        uri,
        durationMs,
        mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4',
        sourceRef: opaqueLocalReference('audio', uri),
        consentId,
      };
    },

    cancel: async (): Promise<void> => {
      if (state.isRecording) await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      deleteAppOwnedAudio(recorder.uri);
      consentIdRef.current = null;
    },
  };
}
