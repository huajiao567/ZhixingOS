import { Platform } from 'react-native';

/**
 * Android/iOS production runtime policy.
 *
 * Native personal data and deterministic algorithms are device-local. The only
 * permitted outbound application request is an explicitly configured LLM API
 * call. Web keeps the existing backend architecture for development and the
 * desktop/browser product surface.
 */
export function isNativeLocalOnlyRuntime(): boolean {
  return Platform.OS !== 'web';
}

export type NativeNetworkPurpose = 'llm' | 'backend' | 'sync' | 'media';

export function normalizeHttpsEndpoint(value: string): string {
  const raw = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('模型 API 地址无效');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('原生本地模式只允许通过 HTTPS 调用大模型 API');
  }
  if (parsed.username || parsed.password) {
    throw new Error('模型 API 地址不能包含用户名或密码');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('模型 API 基址不能包含查询参数或片段');
  }
  return raw;
}

export function assertNativeOutboundAllowed(url: string, purpose: NativeNetworkPurpose): string {
  if (!isNativeLocalOnlyRuntime()) return url;
  if (purpose !== 'llm') {
    throw new Error('原生本地模式已阻止非大模型网络请求');
  }
  return normalizeHttpsEndpoint(url);
}
