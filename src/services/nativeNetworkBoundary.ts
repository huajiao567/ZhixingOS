import { isNativeLocalOnlyRuntime } from './runtimePolicy';
import { getNativeLlmConfig } from './nativeLlm';
import { localApiRequest } from './localApi';

let installed = false;

function localResponse(data: unknown, status = 200): Response {
  const text = data === undefined ? '' : JSON.stringify(data);
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'ERROR',
    headers,
    redirected: false,
    type: 'basic',
    url: 'local://zhixingos',
    body: null,
    bodyUsed: false,
    clone() { return localResponse(data, status); },
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    blob: async () => new Blob([text], { type: 'application/json' }),
    formData: async () => { throw new Error('本地响应不支持 FormData'); },
    json: async () => data,
    text: async () => text,
    bytes: async () => new TextEncoder().encode(text),
  } as unknown as Response;
}

async function parseBody(init?: RequestInit): Promise<unknown> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return body; }
  }
  return body;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

/**
 * Install once, before AuthProvider mounts. In native release builds:
 * - every /api/* call is executed against the on-device local API store;
 * - /health is answered locally;
 * - the only outbound HTTP(S) destination allowed is the configured LLM API;
 * - all other network requests fail closed.
 */
export function installNativeLocalNetworkBoundary(): void {
  if (installed || !isNativeLocalOnlyRuntime()) return;
  installed = true;

  console.info('[NativeNetworkBoundary] strict-local installed; only configured HTTPS LLM origin may egress');

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = requestUrl(input);
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return originalFetch(input as any, init);
    }

    const method = requestMethod(input, init);
    if (url.pathname === '/health') {
      return localResponse({ ok: true, service: 'zhixingos-native-local-runtime' });
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        const data = await localApiRequest(method, `${url.pathname}${url.search}`, await parseBody(init));
        return localResponse(data, 200);
      } catch (error) {
        return localResponse({ error: error instanceof Error ? error.message : String(error) }, 501);
      }
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return originalFetch(input as any, init);
    }

    const config = await getNativeLlmConfig();
    if (config.enabled) {
      const base = new URL(config.baseUrl);
      const sameOrigin = url.origin === base.origin;
      const basePath = base.pathname.replace(/\/$/, '');
      const withinBasePath = !basePath || basePath === '/' || url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
      if (sameOrigin && withinBasePath && url.protocol === 'https:') {
        console.info(`[NativeNetworkBoundary] LLM_ALLOW ${method} ${url.origin}${url.pathname}`);
        return originalFetch(input as any, init);
      }
    }

    console.warn(`[NativeNetworkBoundary] BLOCKED ${method} ${url.origin}${url.pathname}`);
    throw new TypeError(`原生本地模式已阻止非大模型网络请求：${url.origin}${url.pathname}`);
  }) as typeof fetch;
}

/** Auditable release marker for the strict-local privacy contract. */
export const NATIVE_LOCAL_PRIVACY_REVISION = '1.0.1-mlkit-free';

export const __nativeNetworkBoundaryTest = { requestMethod };
