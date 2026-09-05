/**
 * DeepSeek API 调用封装
 *
 * 隐私说明（V4.3 §10 合规）：
 * - DeepSeek API 不用于训练（基于 DeepSeek 隐私政策 https://platform.deepseek.com/legal/privacy）
 * - 仅发送用户授权范围内的数据（由 ServiceContract D 轴控制：D0-D4）
 * - 不发送完整对话历史，仅发送当前轮次必要的最小上下文
 * - 响应不存储原始用户内容（仅缓存 LLM 输出用于幂等性，缓存 key 含 userId 前缀）
 * - 用户可在「我的数据」页随时撤回授权或切换为「仅本地」模式
 *
 * 模型供应商切换：本模块为 ModelProvider 抽象层的具体实现；切换到其他供应商时
 * 需保证同样的隐私承诺，并在「AI 与模型」子页明确披露。
 */
import { config } from '../config.js';
import { llmCacheGet, llmCacheSet } from '../db.js';
import {
  SECRETARY_SYSTEM_PROMPT,
  SAFETY_PROTOCOL,
  BRIEF_SYSTEM_PROMPT,
  preCheckRisk,
  type RiskLevel,
  SAFETY_RESPONSE,
} from './prompts.js';

const SECRETARY_SYSTEM_PROMPT_FULL = `${SECRETARY_SYSTEM_PROMPT}\n\n${SAFETY_PROTOCOL}`;
const BRIEF_SYSTEM_PROMPT_FULL = BRIEF_SYSTEM_PROMPT;

// DeepSeek 客户端（OpenAI 兼容）。带响应缓存以省 token。

interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

function cacheKey(messages: ChatMessage[], model: string): string {
  // 用 SHA-256 风格的简易哈希（JS 实现足够，避免依赖）
  const json = JSON.stringify({ model, messages });
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(16, '0') + (h1 >>> 0).toString(16).padStart(16, '0');
}

function cacheGet(userId: string, key: string): string | null {
  if (!config.llmCacheEnabled) return null;
  return llmCacheGet(userId, key);
}

function cacheSet(userId: string, key: string, response: string): void {
  if (!config.llmCacheEnabled) return;
  llmCacheSet(userId, key, response);
}

export interface ChatResult {
  content: string;
  risk: RiskLevel;
  cached: boolean;
  fromCache: boolean;
}

// 主对话入口：先做本地安全门控，再走 LLM
// contractSystemPrompt（V4.3 Task 9.5）：来自 buildLlmContext() 的服务契约说明，
//   拼到 system 消息末尾，约束 LLM 按 R/A/D/P 轴裁剪回复
export async function secretaryChat(
  userText: string,
  contextSummary: string,
  userId: string,
  contractSystemPrompt?: string
): Promise<ChatResult> {
  const risk = preCheckRisk(userText);
  if (risk === 2) {
    return { content: SAFETY_RESPONSE, risk, cached: false, fromCache: false };
  }

  const sysMsg = contractSystemPrompt
    ? `${SECRETARY_SYSTEM_PROMPT_FULL}\n\n${contractSystemPrompt}`
    : SECRETARY_SYSTEM_PROMPT_FULL;
  const messages: ChatMessage[] = [
    { role: 'system', content: sysMsg },
    {
      role: 'user',
      content: `【用户记忆数据摘要】\n${contextSummary}\n\n【用户此刻说】\n${userText}`,
    },
  ];

  const key = cacheKey(messages, config.deepseekModel);
  const hit = cacheGet(userId, key);
  if (hit) return { content: hit, risk, cached: true, fromCache: true };

  // V4.3 修复：600 对推理模型不足，推理 token + 回复内容需要更大空间。2048 实测可覆盖秘书对话回复。
  const content = await complete(messages, 2048);
  cacheSet(userId, key, content);
  return { content, risk, cached: false, fromCache: false };
}

// 简报生成：返回 JSON 字符串
// contractSystemPrompt（V4.3 Task 9.5）：服务契约裁剪说明，拼到 system 末尾
export async function generateBriefJson(
  contextSummary: string,
  userId: string,
  contractSystemPrompt?: string
): Promise<string> {
  const sysMsg = contractSystemPrompt
    ? `${BRIEF_SYSTEM_PROMPT_FULL}\n\n${contractSystemPrompt}`
    : BRIEF_SYSTEM_PROMPT_FULL;
  const messages: ChatMessage[] = [
    { role: 'system', content: sysMsg },
    { role: 'user', content: contextSummary },
  ];
  const key = cacheKey(messages, config.deepseekModel);
  const hit = cacheGet(userId, key);
  if (hit) return hit;
  // V4.3 修复：800 对推理模型不足（推理 token ~500-1500 + JSON 输出 ~500）。4096 实测覆盖简报 JSON。
  const content = await complete(messages, 4096);
  cacheSet(userId, key, content);
  return content;
}

// 通用 JSON 生成（Task 4.6：周镜/月镜复用）：自定义 system prompt
// contractSystemPrompt（V4.3 Task 9.5）：服务契约裁剪说明，拼到 system 末尾
export async function generateJsonWithPrompt(
  systemPrompt: string,
  contextSummary: string,
  userId: string,
  maxTokens = 4096,
  contractSystemPrompt?: string
): Promise<string> {
  const sysMsg = contractSystemPrompt
    ? `${systemPrompt}\n\n${contractSystemPrompt}`
    : systemPrompt;
  const messages: ChatMessage[] = [
    { role: 'system', content: sysMsg },
    { role: 'user', content: contextSummary },
  ];
  const key = cacheKey(messages, config.deepseekModel);
  const hit = cacheGet(userId, key);
  if (hit) return hit;
  const content = await complete(messages, maxTokens);
  cacheSet(userId, key, content);
  return content;
}

async function complete(messages: ChatMessage[], maxTokens: number): Promise<string> {
  if (!config.deepseekApiKey) {
    throw Object.assign(new Error('未配置 DEEPSEEK_API_KEY'), { status: 500 });
  }
  const url = `${config.deepseekBaseUrl}/v1/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseekModel,
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw Object.assign(new Error(`DeepSeek ${res.status}: ${txt.slice(0, 200)}`), {
        status: 502,
      });
    }
    // V4.3 修复：deepseek-v4-pro/flash 是推理模型，先输出 reasoning_content（内部思考），
    // 推理完成后再输出 content（最终回答）。max_tokens 不足时 content 为空（finish_reason='length'）。
    // 读取策略：优先 content（最终输出）；若为空但 finish_reason='length'，说明 max_tokens 不足，
    // 抛错让上层走 fallback（不展示 reasoning_content，那是模型内部思考不该直接呈现给用户）。
    const data = (await res.json()) as {
      choices?: { message?: { content?: string; reasoning_content?: string }; finish_reason?: string }[];
    };
    const choice = data.choices?.[0];
    const content = choice?.message?.content?.trim() ?? '';
    if (content) return content;
    // content 为空：检查是否因 max_tokens 不足导致只输出了 reasoning
    if (choice?.finish_reason === 'length' && choice?.message?.reasoning_content) {
      throw Object.assign(
        new Error(`DeepSeek 推理输出被 max_tokens=${maxTokens} 截断（finish_reason=length），请增大 max_tokens`),
        { status: 502 }
      );
    }
    return '';
  } finally {
    clearTimeout(timeout);
  }
}

export async function pingDeepSeek(): Promise<{ ok: boolean; detail: string }> {
  // V4.3 修复：原 max_tokens=8 对推理模型不够（推理 token 全部用完，content 为空）。
  // 推理模型需要足够 max_tokens 完成推理后再输出 content。"回复OK" 实测推理 ~77 token + 输出 ~13 token。
  // 512 是最小可用值，留足推理 + 简短输出空间。
  try {
    const content = await complete(
      [{ role: 'user', content: '回复"OK"两个字符即可。' }],
      512
    );
    return { ok: !!content, detail: content.slice(0, 60) };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
}
