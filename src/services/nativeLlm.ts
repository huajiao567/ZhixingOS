import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { assertNativeOutboundAllowed, normalizeHttpsEndpoint } from './runtimePolicy';

const CONFIG_KEY = 'zx_native_llm_config_v1';
const API_KEY_KEY = 'zx_native_llm_api_key_v1';

export type NativeLlmProvider = 'deepseek' | 'openai-compatible';

export interface NativeLlmConfig {
  enabled: boolean;
  provider: NativeLlmProvider;
  baseUrl: string;
  model: string;
}

export const DEFAULT_NATIVE_LLM_CONFIG: NativeLlmConfig = {
  enabled: false,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
};

export interface NativeLlmChatResult {
  reply: string;
  risk: number;
  remote: boolean;
}

type ChatTurn = { role: 'user' | 'assistant'; content: string };

function sanitizeConfig(input: Partial<NativeLlmConfig>): NativeLlmConfig {
  const provider: NativeLlmProvider = input.provider === 'openai-compatible' ? 'openai-compatible' : 'deepseek';
  const baseUrl = normalizeHttpsEndpoint(input.baseUrl ?? DEFAULT_NATIVE_LLM_CONFIG.baseUrl);
  const model = (input.model ?? DEFAULT_NATIVE_LLM_CONFIG.model).trim();
  if (!model || model.length > 120) throw new Error('模型名称无效');
  return {
    enabled: input.enabled === true,
    provider,
    baseUrl,
    model,
  };
}

export async function getNativeLlmConfig(): Promise<NativeLlmConfig> {
  const raw = await AsyncStorage.getItem(CONFIG_KEY);
  if (!raw) return DEFAULT_NATIVE_LLM_CONFIG;
  try {
    return sanitizeConfig(JSON.parse(raw) as Partial<NativeLlmConfig>);
  } catch {
    return DEFAULT_NATIVE_LLM_CONFIG;
  }
}

export async function saveNativeLlmConfig(input: Partial<NativeLlmConfig>): Promise<NativeLlmConfig> {
  const current = await getNativeLlmConfig();
  const next = sanitizeConfig({ ...current, ...input });
  await AsyncStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  return next;
}

async function secureStore() {
  if (Platform.OS === 'web') throw new Error('浏览器端不使用原生模型密钥存储');
  return import('expo-secure-store');
}

export async function setNativeLlmApiKey(value: string): Promise<void> {
  const key = value.trim();
  const store = await secureStore();
  if (!key) {
    await store.deleteItemAsync(API_KEY_KEY);
    return;
  }
  await store.setItemAsync(API_KEY_KEY, key, {
    keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function hasNativeLlmApiKey(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const store = await secureStore();
  return Boolean(await store.getItemAsync(API_KEY_KEY));
}

async function getNativeLlmApiKey(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const store = await secureStore();
  return store.getItemAsync(API_KEY_KEY);
}

export async function clearNativeLlmCredentials(): Promise<void> {
  await AsyncStorage.removeItem(CONFIG_KEY);
  if (Platform.OS !== 'web') {
    const store = await secureStore();
    await store.deleteItemAsync(API_KEY_KEY);
  }
}

/**
 * Conservative local safety gate. It executes before any remote request, so a
 * high-risk message can be handled without transmitting it to a model vendor.
 */
export function localRiskLevel(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  if (/(自杀|自残|结束生命|不想活了|杀死自己|伤害自己)/i.test(t)) return 2;
  if (/(停药|药物剂量|转账|汇款|签署合同|代我签字)/i.test(t)) return 1;
  return 0;
}

function localFallback(message: string): NativeLlmChatResult {
  return {
    reply: `这条内容已留在本机。当前没有启用可用的大模型 API，所以我只做本地处理，不会把内容发送到任何服务器。你可以在「我的数据 → AI 与模型」中配置自己的 API。\n\n你刚才记录的是：${message.slice(0, 240)}`,
    risk: 0,
    remote: false,
  };
}

export async function nativeLlmChat(input: {
  message: string;
  history?: ChatTurn[];
  allowRemote?: boolean;
}): Promise<NativeLlmChatResult> {
  const message = input.message.trim();
  if (!message) return { reply: '请输入内容。', risk: 0, remote: false };

  const risk = localRiskLevel(message);
  if (risk === 2) {
    return {
      reply: '我先不把这段内容发给外部模型。若你现在有立即伤害自己的危险，请优先联系当地紧急服务或身边可信任的人；我也可以继续在本机陪你把当前情况整理成更具体的求助步骤。',
      risk,
      remote: false,
    };
  }

  const config = await getNativeLlmConfig();
  if (input.allowRemote === false || !config.enabled) return localFallback(message);
  const apiKey = await getNativeLlmApiKey();
  if (!apiKey) return localFallback(message);

  const baseUrl = assertNativeOutboundAllowed(config.baseUrl, 'llm');
  const endpoint = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const history = (input.history ?? []).slice(-8).map((turn) => ({
      role: turn.role,
      content: turn.content.slice(0, 4000),
    }));
    const response = await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'system',
            content: '你是知行镜的参谋长。用户的个人数据、算法和媒体都留在设备本地。你只能基于本次明确发送给你的文本回答；不要声称访问了未提供的本地数据。回答简洁、可验证，并尊重用户自主决定。',
          },
          ...history,
          { role: 'user', content: message.slice(0, 8000) },
        ],
        temperature: 0.4,
        max_tokens: 900,
        stream: false,
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`模型 API 请求失败 (${response.status})`);
    let payload: any;
    try { payload = JSON.parse(text); } catch { throw new Error('模型 API 返回了无法解析的响应'); }
    const reply = payload?.choices?.[0]?.message?.content;
    if (typeof reply !== 'string' || !reply.trim()) throw new Error('模型 API 未返回有效文本');
    return { reply: reply.trim(), risk, remote: true };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('模型 API 请求超时');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const __nativeLlmTest = { sanitizeConfig };
