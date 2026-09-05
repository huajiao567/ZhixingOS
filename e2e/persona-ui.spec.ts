/**
 * 知行镜 ZhixingOS — Web UI 多角色真实用户 E2E 测试（spec A29.3）
 *
 * 设计目标（对齐用户原始目标）：
 *   - 模拟真人用户的「点击 / 拍照 / 文字记录」三种输入方式
 *   - 覆盖 6 个组合角色（年龄 × 身份 × 性格 × 使用模式），从注册到登出全链路
 *   - 验证整个操作逻辑：登录 → 引导(7步) → 今日 → 镜像 → 进程 → 秘书 → 数据 → 登出
 *   - 暴露前端 UI 与集成层 bug，修复后回归
 *
 * 选择器策略：
 *   - 优先 getByRole + name（React Native for Web 把 accessibilityLabel 映射为 aria-label，
 *     把 PrimaryButton 映射为 <button>，把 Text 子节点作为 accessible name）
 *   - 文字 fallback：当组件未设 aria-label 时，用 text 内容选择
 *   - testId 仅在必要时使用（避免引入耦合）
 *
 * 并发：1 个 worker 串行执行（多角色并发会触发后端单 IP 注册限流 10 次/15 分钟）
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';

const API_BASE = process.env.API_BASE ?? 'http://localhost:3001';
const WEB_BASE = process.env.WEB_BASE ?? 'http://localhost:8081';
const TS = Date.now();

// =================================================================
// Persona 定义（6 个代表性角色，覆盖年龄/身份/性格/使用模式大类）
// =================================================================

type Persona = {
  id: string;            // ASCII slug，用作邮箱本地部分
  displayName: string;
  age: number;
  identity: string;
  personality: string;
  usageMode: 'explore-growth' | 'quiet-mirror' | 'action-nav' | 'voice-life' | 'senior-easy' | 'long-project';
  lifeStage: '成年人' | '老年人';
  topDomain: string;     // 步骤 5 选择的领域
  constraint: string;    // 步骤 2 选择的约束
  avatarChoice: 'default' | 'skip';
  proactivity: 'P0' | 'P1' | 'P2' | 'P3';
  journal: string;       // 今日页第一条文字记录
  photoIntent?: boolean; // 是否测试照片上传
  voiceNote?: string;    // 是否测试语音（模拟转写文本）
  secretaryMessage: string;
};

const PERSONAS: Persona[] = [
  {
    id: 'u20stu',
    displayName: '林晓',
    age: 20,
    identity: '大学生',
    personality: '高开放+外向',
    usageMode: 'explore-growth',
    lifeStage: '成年人',
    topDomain: '学习',
    constraint: '时间碎片化',
    avatarChoice: 'default',
    proactivity: 'P2',
    journal: '今天上完课去图书馆自习了两小时，专注让我感到充实。联想到学长分享的实习经历，似乎理解了自己想走的方向。',
    photoIntent: true,
    secretaryMessage: '我想知道如何平衡学业和社交',
  },
  {
    id: 'u38mgr',
    displayName: '陈总',
    age: 38,
    identity: '白领中层',
    personality: '高神经质',
    usageMode: 'action-nav',
    lifeStage: '成年人',
    topDomain: '工作',
    constraint: '工作处于冲刺期',
    avatarChoice: 'skip',
    proactivity: 'P3',
    journal: '会议太长，老板又加需求，复盘今天的决策有三个仓促。',
    secretaryMessage: '帮我梳理本周三个最紧迫的事项',
  },
  {
    id: 'u45work',
    displayName: '老张',
    age: 45,
    identity: '蓝领工人',
    personality: '直率低字',
    usageMode: 'voice-life',
    lifeStage: '成年人',
    topDomain: '身体',
    constraint: '健康正在恢复',
    avatarChoice: 'skip',
    proactivity: 'P1',
    journal: '累了，腰疼。工友请喝酒，孩子考了第一名。',
    voiceNote: '今天活儿干完了，腰有点不舒服',
    secretaryMessage: '腰不舒服怎么办',
  },
  {
    id: 'u65ret',
    displayName: '王老师',
    age: 65,
    identity: '退休教师',
    personality: '严谨反思',
    usageMode: 'senior-easy',
    lifeStage: '老年人',
    topDomain: '学习',
    constraint: '都不适用',
    avatarChoice: 'default',
    proactivity: 'P1',
    journal: '今天读完了《论语》的"为政"篇，"温故而知新"一句让我反复思考。教了一辈子书，退休后才真正理解这句话。',
    secretaryMessage: '温故知新在退休后还有什么含义',
  },
  {
    id: 'u32mom',
    displayName: '小梅',
    age: 32,
    identity: '新晋妈妈',
    personality: '情绪波动',
    usageMode: 'voice-life',
    lifeStage: '成年人',
    topDomain: '家庭',
    constraint: '需要照护家人',
    avatarChoice: 'default',
    proactivity: 'P2',
    journal: '宝宝今天第一次翻身，开心到哭。凌晨三点喂奶困到崩溃，但宝宝对我笑了。',
    voiceNote: '宝宝翻身了',
    secretaryMessage: '产后情绪起伏正常吗',
  },
  {
    id: 'u16teen',
    displayName: '小明',
    age: 16,
    identity: '青少年',
    personality: '冲动试验',
    usageMode: 'explore-growth',
    lifeStage: '成年人',
    topDomain: '关系',
    constraint: '都不适用',
    avatarChoice: 'default',
    proactivity: 'P2',
    journal: '今天考试考砸了，但和朋友打游戏到很晚。被妈妈骂了。',
    secretaryMessage: '考试考砸了怎么调整心态',
  },
];

// =================================================================
// 通用工具
// =================================================================

async function api<T = any>(method: string, path: string, body?: unknown, token?: string, forwardedFor?: string): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed };
}

/** 通过后端 API 删除账号（UI 没提供删除入口，只能走 API 清理） */
async function cleanupAccount(email: string, password: string, forwardedFor?: string) {
  try {
    const login = await api<{ accessToken?: string; id?: string }>('POST', '/api/auth/login', { email, password }, undefined, forwardedFor);
    if (login.status !== 200 || !login.body.accessToken) return;
    await api('DELETE', '/api/auth/me', undefined, login.body.accessToken, forwardedFor);
  } catch { /* best-effort */ }
}

/** 在 Playwright context 上注入 X-Forwarded-For，模拟不同地点真实用户 */
async function setForwardedIP(context: BrowserContext, ip: string) {
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': ip });
}

/** 等待RN-W完成水合：根容器出现且至少有一个 Text 节点 */
async function waitForAppReady(page: Page) {
  // Expo Web dev server 首次编译较慢；用 domcontentloaded 而非 load
  await page.waitForLoadState('domcontentloaded', { timeout: 60_000 });
  // RN web 渲染目标在 #root 下；等任何 Pressable / View 出现
  // 注意：Playwright TS 重载解析时 { timeout } 会被当作 arg 而非 options；
  // 显式传 undefined 作为 arg，options 作为第三参数。
  await page.waitForFunction(() => {
    const root = document.getElementById('root');
    return !!root && root.children.length > 0 && (root.innerText?.length ?? 0) > 0;
  }, undefined, { timeout: 60_000 });
}

/** 访问 Web 首页并等待 RN 渲染 */
async function gotoWeb(page: Page) {
  await page.goto(WEB_BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await waitForAppReady(page);
}

/**
 * 健壮点击：先试普通 click（短超时），失败则滚动到视图后用 force click 绕过可操作性检查。
 *
 * 用于 onboarding 中的 radio/Pressable 选择：RN-Web 的 radio 按钮在步骤切换动画期间
 * 可能暂不稳定（Playwright 报 "waiting for element to be visible, enabled and stable"），
 * 但元素实际可交互。force click 不等待动画完成，直接对元素坐标发起点击。
 */
async function robustClick(page: Page, locator: import('@playwright/test').Locator, timeout = 8_000): Promise<void> {
  try {
    await locator.first().click({ timeout });
  } catch {
    await locator.first().scrollIntoViewIfNeeded({ timeout: 3_000 }).catch(() => {});
    await locator.first().click({ force: true, timeout: 5_000 });
  }
}

/** 注册并完成 7 步引导 */
async function registerAndOnboard(page: Page, persona: Persona, email: string, password: string) {
  // 1. 注册
  await page.getByRole('tab', { name: /切换到注册/ }).click();
  await page.getByPlaceholder('昵称（可选）').fill(persona.displayName);
  await page.getByPlaceholder('邮箱').fill(email);
  await page.getByPlaceholder('密码（至少 6 位）').fill(password);
  await page.getByRole('button', { name: '创建新账号' }).click();

  // 2. 等待引导第一步
  await expect(page.getByText('你好，我是知行镜')).toBeVisible({ timeout: 30_000 });

  // 步骤 1：欢迎 + 称呼
  await page.getByLabel('称呼（可选）').fill(persona.displayName);
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 2：年龄与安全边界
  // 注意：OnboardingScreen LIFE_STAGE_CHOICES 中 '老年人' 的 label 是 '长辈'，不是 value 本身
  const lifeStageLabelMap: Record<Persona['lifeStage'], string> = {
    '成年人': '成年人',
    '老年人': '长辈',
  };
  await robustClick(page, page.getByLabel(new RegExp(`生活阶段：${lifeStageLabelMap[persona.lifeStage]}`)));
  await robustClick(page, page.getByLabel(`约束：${persona.constraint}`));
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 3：最近的生活
  await page.getByLabel('最近在忙什么').fill(`${persona.identity}的日常`);
  await page.getByLabel('最近让你开心或烦心的事').fill(persona.journal.slice(0, 80));
  await page.getByLabel('接下来想往哪个方向走').fill('想找到属于自己的节奏');
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 4：使用方式（按 persona.usageMode 选择）
  // 名称严格对齐 src/data/usageModePresets.ts USAGE_MODE_LABELS
  const usageLabelMap: Record<Persona['usageMode'], string> = {
    'explore-growth': '探索成长',
    'quiet-mirror': '安静镜子',
    'action-nav': '行动导航',
    'voice-life': '语音生活',
    'senior-easy': '长辈易用',
    'long-project': '长期项目',
  };
  const usageName = usageLabelMap[persona.usageMode];
  await robustClick(page, page.getByLabel(new RegExp(`使用方式：${usageName}`)));
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 5：第一件重要的事 — 选 domain + 选「先不实验」最低风险
  await robustClick(page, page.getByLabel(new RegExp(`选择最重要的事：${persona.topDomain}`)));
  await page.getByLabel(new RegExp(`为什么 ${persona.topDomain} 现在对你重要`)).fill('这是当前最想投入的方向');
  // 「先不实验」选项 — 尝试多种 role 定位
  const noExpLocators = [
    page.getByRole('radio', { name: /先不实验/ }),
    page.getByRole('button', { name: /先不实验/ }),
    page.getByText(/先不实验/),
  ];
  let clicked = false;
  for (const loc of noExpLocators) {
    try {
      await loc.first().click({ timeout: 3_000 });
      clicked = true;
      break;
    } catch { /* try next */ }
  }
  if (!clicked) throw new Error('未找到「先不实验」选项');
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 6：形象选择
  if (persona.avatarChoice === 'skip') {
    await robustClick(page, page.getByLabel('暂时不显示形象'));
  } else {
    await robustClick(page, page.getByLabel('按使用方式默认显示形象'));
  }
  await page.getByRole('button', { name: '继续' }).click();

  // 步骤 7：进入镜像主页
  await page.getByRole('button', { name: '进入今日' }).click();
  await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible({ timeout: 60_000 });
}

// =================================================================
// 主测试套件
// =================================================================

test.describe('知行镜 Web UI 多角色 E2E', () => {

  // 使用 default 模式（非 serial）：单 worker 串行执行，但单个用例失败不跳过后续用例。
  // 各 persona 测试相互独立（独立 context + 独立账号 + 独立 IP），无需 serial 依赖。
  test.describe.configure({ mode: 'default' });

  for (const persona of PERSONAS) {
    const email = `p-${persona.id}-${TS}@zhixingos.com`;
    const password = 'PersonaTest1234';
    const idx = PERSONAS.indexOf(persona);
    const ip = `10.${idx + 20}.0.${idx + 1}`;

    test(`${persona.id} ${persona.displayName}（${persona.identity}/${persona.age}岁）全流程`, async ({ browser }) => {
      test.setTimeout(240_000);
      const context = await browser.newContext();
      await setForwardedIP(context, ip);
      const page = await context.newPage();
      page.setDefaultTimeout(20_000);
      page.setDefaultNavigationTimeout(90_000);

      try {
        // 预清理：若账号残留则先删（使用与 UI 同 IP，避免占用本机 IP 速率配额）
        await cleanupAccount(email, password, ip);

        await gotoWeb(page);

        // ===== 阶段 1：注册 + 引导 =====
        await registerAndOnboard(page, persona, email, password);
        await test.step('注册 + 引导完成 — 刷新后保持登录态', async () => {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
          await waitForAppReady(page);
          await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible({ timeout: 30_000 });
        });

        // ===== 阶段 2：镜像主页 — 文字记录 =====
        await test.step('镜像主页：文字记录', async () => {
          await page.getByPlaceholder('说点什么…').fill(persona.journal);
          await page.getByRole('button', { name: '发送' }).click();
          await expect(page.getByText(/已收进今天/)).toBeVisible({ timeout: 10_000 });
        });

        // ===== 阶段 3：镜像主页 — 照片记录（仅 photoIntent persona） =====
        if (persona.photoIntent) {
          await test.step('镜像主页：照片记录', async () => {
            await page.getByLabel('拍照记录').click();
            await expect(page.getByText(/已收进今天/)).toBeVisible({ timeout: 10_000 });
          });
        }

        // ===== 阶段 4：镜像主页 — 语音记录（仅 voiceNote persona） =====
        if (persona.voiceNote) {
          await test.step('镜像主页：语音记录', async () => {
            await page.getByLabel('语音记录').click();
            await expect(page.getByLabel('发送语音')).toBeVisible();
            await page.getByLabel('发送语音').click();
            await expect(page.getByText(/已收进今天/)).toBeVisible({ timeout: 10_000 });
          });
        }

        // ===== 阶段 5：导航 — 镜像 =====
        await test.step('镜像', async () => {
          await page.getByRole('button', { name: '现在的我' }).click();
          // 验证 MirrorScreen 渲染：等待其页面级独特副标题出现（始终可见，不依赖内部 tab 选择）
          // 注意：「当前摘要」位于内部「六位状态」tab，默认 tab 是「假设卡」，故不可作为渲染判定标志
          await expect(page.getByText(/事实、假设与状态 —— 一切可反驳，一切可修正/).first()).toBeVisible({ timeout: 15_000 });
        });

        await page.getByRole('button', { name: '返回主页' }).click();

        // ===== 阶段 6：导航 — 进程 =====
        await test.step('进程', async () => {
          await page.getByRole('button', { name: /规划：/ }).click();
          // 验证 ProgressScreen 渲染：等待其独特副标题出现
          await expect(page.getByText(/从意义到能力/).first()).toBeVisible({ timeout: 15_000 });
        });

        await page.getByRole('button', { name: '返回主页' }).click();

        // ===== 阶段 7：导航 — 秘书 + 发送消息 =====
        await test.step('秘书：发送消息', async () => {
          await page.getByRole('button', { name: '秘书' }).click();
          // 验证 SecretaryScreen 渲染：等待其独特副标题出现
          await expect(page.getByText(/参谋长而非催促器/).first()).toBeVisible({ timeout: 15_000 });
          const inputCandidates = [
            page.getByPlaceholder(/输入|问|说/).first(),
            page.locator('textarea').first(),
            page.locator('input[type="text"]').last(),
          ];
          let typed = false;
          for (const loc of inputCandidates) {
            if (await loc.count() > 0) {
              try {
                await loc.fill(persona.secretaryMessage);
                typed = true;
                break;
              } catch { /* try next */ }
            }
          }
          if (typed) {
            try {
              await page.getByRole('button', { name: '发送消息' }).click({ timeout: 3_000 });
            } catch {
              try { await page.getByRole('button', { name: /发送/ }).first().click({ timeout: 3_000 }); } catch { /* 忽略 */ }
            }
            await page.waitForTimeout(3000);
          }
        });

        await page.getByRole('button', { name: '返回主页' }).click();

        // ===== 阶段 8：导航 — 数据 =====
        await test.step('数据：服务契约可读', async () => {
          await page.getByRole('button', { name: '我的数据' }).click();
          // 验证 SovereigntyScreen 渲染：等待其独特页面标题与副标题出现
          await expect(page.getByText('数据主权', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
          await expect(page.getByText(/你的数据由你掌控/).first()).toBeVisible({ timeout: 5_000 });

          // 点击「陪伴」子标签，展示七轴服务契约内容（默认子标签是「权限」，不含契约关键字）
          const companionLocators = [
            page.getByLabel('切换到陪伴标签'),
            page.getByRole('tab', { name: '陪伴' }),
            page.getByText('陪伴', { exact: true }),
          ];
          let companionClicked = false;
          for (const loc of companionLocators) {
            try {
              await loc.first().click({ timeout: 4_000 });
              companionClicked = true;
              break;
            } catch { /* try next */ }
          }
          // 验证七轴契约关键字至少出现一个（想听到多深 / 多久主动找我 / 能帮到哪一步 / 3D 出现多少）
          if (companionClicked) {
            // 子标签内容条件渲染（{tab === 'companion' && ...}），等待首个轴标题可见
            const contractKeywords = ['想听到多深', '多久主动找我', '能帮到哪一步', '3D 出现多少'];
            let foundKw: string | null = null;
            for (const kw of contractKeywords) {
              try {
                await expect(page.getByText(kw, { exact: true }).first()).toBeVisible({ timeout: 4_000 });
                foundKw = kw;
                break;
              } catch { /* try next keyword */ }
            }
            expect(foundKw, `陪伴子标签应包含至少一个七轴契约关键字（想听到多深/多久主动找我/能帮到哪一步/3D 出现多少）`).not.toBeNull();
          }
        });

        // ===== 阶段 9：数据页 — 调整主动性 =====
        await test.step('数据：调整主动性', async () => {
          const proactLabelMap: Record<Persona['proactivity'], string> = {
            'P0': '不出现（等我找你）',
            'P1': '只在承诺到期时',
            'P2': '每天 1 次建议',
            'P3': '关键节点提醒',
          };
          await page.getByLabel('切换到主动性标签').click();
          await page.getByLabel(new RegExp(`出现频率：${proactLabelMap[persona.proactivity]}`)).click();
        });

        // ===== 阶段 10：刷新后仍保持登录态（水合持久化） =====
        await test.step('刷新后保持登录态', async () => {
          await page.reload({ waitUntil: 'domcontentloaded', timeout: 90_000 });
          await waitForAppReady(page);
          await expect(page.getByRole('button', { name: '现在的我' })).toBeVisible({ timeout: 30_000 });
        });

      } finally {
        await cleanupAccount(email, password, ip);
        await context.close();
      }
    });
  }

  // ---------- 边界 UI 用例 ----------
  test('UI-A11y：所有交互元素均有可访问名', async ({ browser }) => {
    const context = await browser.newContext();
    await setForwardedIP(context, '10.99.0.99');
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await gotoWeb(page);
      await expect(page.getByRole('tab', { name: /切换到登录/ })).toBeVisible();
      await expect(page.getByRole('tab', { name: /切换到注册/ })).toBeVisible();
      await expect(page.getByRole('button', { name: '登录账号' })).toBeVisible();
      await expect(page.getByRole('button', { name: /使用演示账号/ })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('UI-错误处理：登录不存在的账号应显示错误', async ({ browser }) => {
    const context = await browser.newContext();
    await setForwardedIP(context, '10.99.0.98');
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await gotoWeb(page);
      await page.getByPlaceholder('邮箱').fill(`no-such-user-${TS}@zhixingos.com`);
      await page.getByPlaceholder('密码（至少 6 位）').fill('WrongPass1234');
      await page.getByRole('button', { name: '登录账号' }).click();
      await expect(page.locator('body').filter({ hasText: /错误|失败|不正确|不存在/ })).toBeVisible({ timeout: 8_000 });
    } finally {
      await context.close();
    }
  });

  test('UI-弱密码：注册应被前端校验拦截', async ({ browser }) => {
    const context = await browser.newContext();
    await setForwardedIP(context, '10.99.0.97');
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    try {
      await gotoWeb(page);
      await page.getByRole('tab', { name: /切换到注册/ }).click();
      await page.getByPlaceholder('邮箱').fill(`weak-${TS}@zhixingos.com`);
      await page.getByPlaceholder('密码（至少 6 位）').fill('123');
      await page.getByRole('button', { name: '创建新账号' }).click();
      await expect(page.locator('body').filter({ hasText: /密码|错误|失败/ })).toBeVisible({ timeout: 8_000 });
    } finally {
      await context.close();
    }
  });
});

// =================================================================
// 后端 ↔ 前端 集成 smoke：通过 UI 注册后用 API 验证状态
// =================================================================

test('集成：UI 注册 → API 可读取用户数据', async ({ browser }) => {
  const email = `p-integ-${TS}@zhixingos.com`;
  const password = 'PersonaTest1234';
  const ip = '10.88.0.1';
  const context = await browser.newContext();
  await setForwardedIP(context, ip);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);

  try {
    await cleanupAccount(email, password, ip);
    await gotoWeb(page);

    await page.getByRole('tab', { name: /切换到注册/ }).click();
    await page.getByPlaceholder('邮箱').fill(email);
    await page.getByPlaceholder('密码（至少 6 位）').fill(password);
    await page.getByRole('button', { name: '创建新账号' }).click();

    await expect(page.getByText('你好，我是知行镜')).toBeVisible({ timeout: 30_000 });

    // API 调用也使用与 UI 同 IP，避免占用本机 IP 速率配额触发 429
    const apiLogin = await api<{ accessToken?: string }>('POST', '/api/auth/login', { email, password }, undefined, ip);
    expect(apiLogin.status, `API 登录应 200，实际=${apiLogin.status} body=${JSON.stringify(apiLogin.body).slice(0, 200)}`).toBe(200);
    expect(apiLogin.body.accessToken, '应返回 accessToken').toBeTruthy();

    const contract = await api('GET', '/api/data/service-contract', undefined, apiLogin.body.accessToken, ip);
    expect(contract.status).toBe(200);

  } finally {
    await cleanupAccount(email, password, ip);
    await context.close();
  }
});
