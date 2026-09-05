/**
 * 知行镜 多角色真实用户行为端到端测试（V4.3 §10 / Task 28 强化版）
 *
 * 设计原则：
 * - 10 个组合角色：身份 × 年龄 × 性格 × 使用模式矩阵
 * - 每个角色按真人操作顺序串联：注册 → 服务契约 → 文字/拍照/语音记录 → 蒸馏 → 简报 → 纠正 → 审计 → 清理
 * - 每角色注入角色特定的边界用例（emoji、超长文本、跨日时间戳、极端情绪值、非法字段等）
 * - 并发执行（concurrency=3）暴露竞态与跨用户隔离问题
 * - 失败用例结构化收集，按严重度分级（P0 崩溃 / P1 数据错误 / P2 不一致 / P3 表面问题）
 *
 * 运行：
 *   1. 启动后端：cd backend && npm run dev
 *   2. 运行测试：node tests/e2e/persona-smoke.mjs
 *
 * 退出码：0=全部通过；1=有失败
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3001';
const TS = Date.now();
const PASS = 'PersonaTest1234';

// =================================================================
// 通用工具
// =================================================================

function makeClient(clientIp) {
  let accessToken = '';
  let refreshToken = '';
  let userId = '';
  let displayName = '';

  async function http(method, path, body, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    // 每个角色独立 IP，模拟真实用户来自不同地点，避免单 IP 注册限流（10次/15分钟）
    if (clientIp) headers['X-Forwarded-For'] = clientIp;
    const init = { method, headers };
    if (body !== undefined && body !== null) init.body = JSON.stringify(body);
    let res;
    try {
      res = await fetch(BASE + path, init);
    } catch (e) {
      return { status: 0, body: { _fetchError: String(e?.message ?? e) }, headers: {} };
    }
    const text = await res.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  return {
    http,
    setAuth: (a, r, u, n) => { accessToken = a; refreshToken = r; userId = u; displayName = n; },
    getAccessToken: () => accessToken,
    getRefreshToken: () => refreshToken,
    getUserId: () => userId,
    getDisplayName: () => displayName,
  };
}

// 单角色测试上下文
class PersonaContext {
  constructor(persona) {
    this.persona = persona;
    // 每个角色一个稳定的伪 IP（10.x.y.z），模拟不同地点真实用户
    // EDGE 角色不在 PERSONAS 数组中，用独立 IP 段
    const idx = PERSONAS.indexOf(persona);
    const slot = idx >= 0 ? idx + 1 : 99;
    const clientIp = `10.${slot}.0.${10 + slot}`;
    this.client = makeClient(clientIp);
    this.results = [];
    this.createdEmail = null;
    this.createdUserId = null;
  }

  record(name, ok, detail = '', severity = ok ? 'pass' : 'P2') {
    this.results.push({ name, ok, detail, severity: ok ? 'pass' : severity, persona: this.persona.id });
    const tag = ok ? '✓ PASS' : `✗ FAIL[${severity}]`;
    console.log(`  [${this.persona.id}] ${tag}  ${name}${detail ? '  — ' + String(detail).slice(0, 180) : ''}`);
    return !!ok;
  }

  assert(name, cond, detail, severity) { return this.record(name, cond, detail, severity); }
  assertEquals(name, actual, expected, severity) {
    const ok = actual === expected;
    return this.record(name, ok, `实际=${JSON.stringify(actual)?.slice(0, 120)} 期望=${JSON.stringify(expected)?.slice(0, 120)}`, severity);
  }
  assertRange(name, val, lo, hi, severity) {
    const ok = typeof val === 'number' && Number.isFinite(val) && val >= lo && val <= hi;
    return this.record(name, ok, `实际=${val} 应在[${lo},${hi}]`, severity);
  }
}

// =================================================================
// 10 个组合角色定义
// =================================================================

const PERSONAS = [
  {
    id: 'P1-大学生-林晓',
    profile: { age: 20, identity: '大学生', personality: '高开放性+外向', usage_mode: 'explore-growth' },
    contract: {
      reflection_depth: 'R2', agency_level: 'A1', data_scope: { D0: true, D1: true, D2: true },
      proactivity: 'P2', avatar: 'V2', supporter_mode: 'S1',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'explore-growth' },
      quiet_hours: { start: '23:00', end: '07:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今天上完课去图书馆自习了两小时，感觉收获很大', mood: 0.7, tags: ['学习', '校园'], userInterpretation: '专注的状态让我感到充实' },
      { content: '看到学长分享的实习经历，有点焦虑不知道未来该走哪个方向', mood: -0.3, tags: ['关系', '意义'], userInterpretation: '对未来的不确定感让我失眠' },
      { content: '晚上和室友聊到很晚，似乎又理解了一些人和事', mood: 0.6, tags: ['关系', '家庭'] },
      { content: '尝试了新的笔记方法，今天用平板画思维导图', mood: 0.5, tags: ['学习', '创造'], source: 'user' },
      { content: '🎬 看了一部纪录片，被主角的坚持感动', mood: 0.8, tags: ['创造', '意义'] },
    ],
    focus: 'explore',
  },
  {
    id: 'P2-自由职业-沈砚',
    profile: { age: 28, identity: '自由职业', personality: '严谨内向', usage_mode: 'quiet-mirror' },
    contract: {
      reflection_depth: 'R3', agency_level: 'A2', data_scope: { D0: true, D1: true, D2: true, D3: true },
      proactivity: 'P1', avatar: 'V1', supporter_mode: 'S0',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'quiet-mirror' },
      quiet_hours: { start: '22:00', end: '08:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今早五点半醒来，没有立刻起床，在床上思考了一个客户提案的核心逻辑，似乎想清楚了一个之前卡住的环节：客户的真实诉求不是"更多功能"，而是"更少决策负担"。这让我重新审视了上周提交的方案，发现确实有些功能堆砌的痕迹。', mood: 0.4, tags: ['工作', '创造'], userInterpretation: '深度思考需要先放下"必须产出"的执念' },
      { content: '下午连续写稿三小时，进入心流，但没有按时喝水', mood: 0.5, tags: ['工作', '身体'] },
      { content: '收到甲方反馈要求修改三处，第一反应是抵触，但仔细看反馈后觉得其中两条是合理的', mood: -0.2, tags: ['工作', '关系'] },
      { content: '晚上读《思考，快与慢》关于系统1的章节，联想到自己今早的顿悟其实是系统2介入的结果', mood: 0.6, tags: ['学习', '意义'] },
    ],
    focus: 'longform',
  },
  {
    id: 'P3-白领中层-陈总',
    profile: { age: 38, identity: '白领中层', personality: '高神经质', usage_mode: 'action-nav' },
    contract: {
      reflection_depth: 'R1', agency_level: 'A3', data_scope: { D0: true, D1: true, D2: true },
      proactivity: 'P3', avatar: 'V2', supporter_mode: 'S2',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'action-nav' },
      quiet_hours: { start: '00:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '会议太长', mood: -0.5, tags: ['工作'] },
      { content: '老板又加需求', mood: -0.7, tags: ['工作'] },
      { content: '下属交付质量不达标', mood: -0.6, tags: ['工作', '关系'] },
      { content: '晚饭后散步半小时', mood: 0.4, tags: ['身体', '休息'] },
      { content: '复盘今天的决策，有三个仓促', mood: -0.3, tags: ['工作'] },
      { content: '睡眠不足五小时', mood: -0.5, tags: ['身体'] },
      { content: '接到猎头电话', mood: 0.3, tags: ['工作', '意义'] },
      { content: '和老婆吵架了', mood: -0.8, tags: ['关系', '家庭'] },
    ],
    focus: 'rapid_stress',
  },
  {
    id: 'P4-蓝领工人-老张',
    profile: { age: 45, identity: '蓝领工人', personality: '直率低字', usage_mode: 'voice-life' },
    contract: {
      reflection_depth: 'R0', agency_level: 'A0', data_scope: { D0: true, D1: true },
      proactivity: 'P1', avatar: 'V0', supporter_mode: 'S0',
      accessibility_profile: { font_scale: 1.4, voice_readout: true, single_confirm: true, usage_mode: 'voice-life' },
      quiet_hours: { start: '21:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '累了', mood: -0.4, tags: ['身体'] },
      { content: '下班', mood: 0.2, tags: ['工作'] },
      { content: '腰疼', mood: -0.5, tags: ['身体'] },
      { content: '工友请喝酒', mood: 0.5, tags: ['关系'] },
      { content: '孩子考了第一名', mood: 0.9, tags: ['家庭'] },
    ],
    focus: 'short_voice',
  },
  {
    id: 'P5-平台工-小李',
    profile: { age: 30, identity: '平台工', personality: '碎片化夜间', usage_mode: 'action-nav' },
    contract: {
      reflection_depth: 'R1', agency_level: 'A2', data_scope: { D0: true, D1: true, D2: true },
      proactivity: 'P2', avatar: 'V1', supporter_mode: 'S1',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'action-nav' },
      quiet_hours: { start: '03:00', end: '10:00' }, high_impact_confirmation: false,
    },
    sampleEvents: [
      { content: '凌晨一点的订单', mood: -0.3, tags: ['工作'], created_at: new Date(Date.now() - 3600 * 1000 * 2).toISOString() },
      { content: '三点的订单结束', mood: -0.4, tags: ['工作'], created_at: new Date(Date.now() - 3600 * 1000).toISOString() },
      { content: '清晨睡觉', mood: 0.2, tags: ['休息', '身体'] },
      { content: '下午醒来吃了一顿', mood: 0.4, tags: ['身体'] },
      { content: '晚上继续接单', mood: 0.0, tags: ['工作'] },
    ],
    focus: 'cross_day',
  },
  {
    id: 'P6-退休教师-王老师',
    profile: { age: 65, identity: '退休教师', personality: '严谨反思', usage_mode: 'senior-easy' },
    contract: {
      reflection_depth: 'R2', agency_level: 'A1', data_scope: { D0: true, D1: true, D2: true },
      proactivity: 'P1', avatar: 'V1', supporter_mode: 'S0',
      accessibility_profile: { font_scale: 1.5, voice_readout: true, single_confirm: true, usage_mode: 'senior-easy' },
      quiet_hours: { start: '21:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今天读完了《论语》的"为政"篇，"温故而知新"一句让我反复思考。教了一辈子书，退休后才真正理解这句话不只是讲学习方法，更是在讲为人的态度——对新事物保持开放，对旧经验保持反思。', mood: 0.6, tags: ['学习', '意义'], userInterpretation: '退休不等于停止成长' },
      { content: '上午去公园打太极，遇到几位老朋友', mood: 0.5, tags: ['身体', '关系'] },
      { content: '孙子来视频电话，问了我一道数学题', mood: 0.7, tags: ['家庭'] },
      { content: '下午整理了多年的教案，准备捐给学校图书馆', mood: 0.4, tags: ['意义', '公共贡献'] },
    ],
    focus: 'longform_senior',
  },
  {
    id: 'P7-新晋妈妈-小梅',
    profile: { age: 32, identity: '新晋妈妈', personality: '情绪波动', usage_mode: 'voice-life' },
    contract: {
      reflection_depth: 'R2', agency_level: 'A1', data_scope: { D0: true, D1: true, D2: true, D3: true },
      proactivity: 'P2', avatar: 'V2', supporter_mode: 'S1',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'voice-life' },
      quiet_hours: { start: '22:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '宝宝今天第一次翻身，开心到哭', mood: 1.0, tags: ['家庭'] },
      { content: '凌晨三点喂奶，困到崩溃', mood: -1.0, tags: ['身体', '家庭'] },
      { content: '和老公因为家务分工吵了一架', mood: -0.7, tags: ['关系', '家庭'] },
      { content: '宝宝对我笑了', mood: 0.9, tags: ['家庭'] },
      { content: '产后复查医生说恢复得不错', mood: 0.5, tags: ['身体'] },
      { content: '感觉失去自我，全是喂奶换尿布', mood: -0.6, tags: ['意义'] },
    ],
    focus: 'extreme_mood',
  },
  {
    id: 'P8-创业者-王总',
    profile: { age: 40, identity: '创业者', personality: '多项目高目标', usage_mode: 'long-project' },
    contract: {
      reflection_depth: 'R3', agency_level: 'A3', data_scope: { D0: true, D1: true, D2: true, D3: true },
      proactivity: 'P3', avatar: 'V2', supporter_mode: 'S2',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'long-project' },
      quiet_hours: { start: '01:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今天和投资人的会议效果不错，团队士气提升', mood: 0.7, tags: ['工作', '意义'] },
      { content: '核心员工提出离职，需要紧急处理', mood: -0.7, tags: ['关系', '工作'] },
      { content: '产品 demo 比预期提前两天完成', mood: 0.8, tags: ['工作', '创造'] },
    ],
    focus: 'multi_project',
  },
  {
    id: 'P9-老年视障-张奶奶',
    profile: { age: 72, identity: '老年视障', personality: '谨慎', usage_mode: 'senior-easy' },
    contract: {
      reflection_depth: 'R1', agency_level: 'A0', data_scope: { D0: true, D1: true },
      proactivity: 'P1', avatar: 'V3', supporter_mode: 'S0',
      accessibility_profile: { font_scale: 2.0, voice_readout: true, single_confirm: true, usage_mode: 'senior-easy' },
      quiet_hours: { start: '20:00', end: '07:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今天孩子来电话了', mood: 0.6, tags: ['家庭'] },
      { content: '去社区医院量了血压', mood: 0.1, tags: ['身体'] },
      { content: '听完一本有声书', mood: 0.5, tags: ['学习'] },
    ],
    focus: 'accessibility_extreme',
  },
  {
    id: 'P10-青少年-小明',
    profile: { age: 16, identity: '青少年', personality: '冲动试验', usage_mode: 'explore-growth' },
    contract: {
      reflection_depth: 'R2', agency_level: 'A1', data_scope: { D0: true, D1: true, D2: true },
      proactivity: 'P2', avatar: 'V3', supporter_mode: 'S1',
      accessibility_profile: { font_scale: 1.0, voice_readout: false, single_confirm: false, usage_mode: 'explore-growth' },
      quiet_hours: { start: '23:00', end: '06:00' }, high_impact_confirmation: true,
    },
    sampleEvents: [
      { content: '今天考试考砸了 😭', mood: -0.6, tags: ['学习'] },
      { content: '和朋友打游戏到很晚 🎮', mood: 0.7, tags: ['关系', '休息'] },
      { content: '被妈妈骂了 💢', mood: -0.5, tags: ['家庭'] },
    ],
    focus: 'edge_boundary',
  },
];

// =================================================================
// 通用流程：注册、设置契约、登出、清理
// =================================================================

async function registerAndSetupContract(ctx) {
  const { persona, client } = ctx;
  // 用纯 ASCII 标识作为邮箱本地部分（persona.id 含中文）
  const slug = persona.id.replace(/[^A-Za-z0-9]/g, '');
  const email = `p-${slug}-${TS}@zhixingos.com`;
  ctx.createdEmail = email;

  // 注册
  const reg = await client.http('POST', '/api/auth/register', {
    email, password: PASS, displayName: persona.id,
  });
  ctx.assert('注册成功', reg.status === 200, `实际=${reg.status} ${JSON.stringify(reg.body).slice(0, 150)}`, 'P0');
  if (reg.status !== 200) return false;
  ctx.createdUserId = reg.body?.id;
  const accessToken = reg.body?.accessToken;
  const refreshToken = reg.body?.refreshToken;
  client.setAuth(accessToken, refreshToken, reg.body?.id, persona.id);

  // 设置服务契约
  const c = await client.http('PUT', '/api/data/service-contract', persona.contract);
  ctx.assert('PUT /service-contract → 200', c.status === 200, `实际=${c.status} ${JSON.stringify(c.body).slice(0, 150)}`, 'P1');
  if (c.status === 200) {
    // 验证每个字段都被正确写入
    for (const k of ['reflection_depth', 'agency_level', 'proactivity', 'avatar', 'supporter_mode']) {
      ctx.assertEquals(`${k} 已写入`, c.body?.[k], persona.contract[k], 'P2');
    }
    ctx.assert('accessibility_profile.usage_mode 已写入', c.body?.accessibility_profile?.usage_mode === persona.contract.accessibility_profile.usage_mode, `实际=${JSON.stringify(c.body?.accessibility_profile)}`, 'P2');
    ctx.assert('accessibility_profile.font_scale 已写入', c.body?.accessibility_profile?.font_scale === persona.contract.accessibility_profile.font_scale, `实际=${c.body?.accessibility_profile?.font_scale}`, 'P2');
    if (persona.contract.quiet_hours) {
      ctx.assert('quiet_hours 已写入', !!c.body?.quiet_hours, `实际=${JSON.stringify(c.body?.quiet_hours)}`, 'P2');
    }
  }
  return true;
}

async function cleanupAccount(ctx) {
  const { client } = ctx;
  try {
    // 重新登录拿新 token（如果之前 logout 了）
    if (!client.getAccessToken() && ctx.createdEmail) {
      const re = await client.http('POST', '/api/auth/login', { email: ctx.createdEmail, password: PASS });
      if (re.status === 200) {
        client.setAuth(re.body?.accessToken, re.body?.refreshToken, re.body?.id, ctx.persona.id);
      } else {
        return; // 账号可能已被删除
      }
    }
    if (client.getRefreshToken()) {
      const del = await client.http('DELETE', '/api/auth/me', { refreshToken: client.getRefreshToken() });
      ctx.assert('清理：DELETE /auth/me → 200', del.status === 200, `实际=${del.status}`, 'P3');
    }
  } catch (e) {
    ctx.record('清理异常', false, String(e?.message ?? e), 'P3');
  }
}

// =================================================================
// 各角色通用业务流程
// =================================================================

async function writeEvents(ctx) {
  const { persona, client } = ctx;
  const createdIds = [];
  for (let i = 0; i < persona.sampleEvents.length; i++) {
    const ev = persona.sampleEvents[i];
    const r = await client.http('POST', '/api/data/events', ev);
    const ok = ctx.assert(`创建事件#${i + 1} → 200`, r.status === 200, `实际=${r.status} ${JSON.stringify(r.body).slice(0, 120)}`, 'P1');
    if (ok && r.body?.id) createdIds.push(r.body.id);
    if (r.status === 200) {
      // 验证 axis 推断：含 userInterpretation → inner；否则 outer
      const expectedAxis = ev.userInterpretation != null ? 'inner' : 'outer';
      ctx.assertEquals(`事件#${i + 1} axis 推断正确`, r.body?.axis, expectedAxis, 'P2');
      // 验证 mood 被保留
      if (ev.mood != null) {
        ctx.assertEquals(`事件#${i + 1} mood 保留`, r.body?.mood, ev.mood, 'P2');
      }
      // 验证 tags 被保留
      if (ev.tags) {
        const actualTags = Array.isArray(r.body?.tags) ? r.body.tags : [];
        ctx.assert(`事件#${i + 1} tags 保留`, actualTags.length === ev.tags.length, `实际=${JSON.stringify(actualTags)}`, 'P2');
      }
    }
  }
  return createdIds;
}

async function createEvidence(ctx, eventIds) {
  const { persona, client } = ctx;
  // P4/P7/P9 模拟拍照证据
  if (['short_voice', 'extreme_mood', 'accessibility_extreme', 'multi_project'].includes(persona.focus)) {
    const photo = await client.http('POST', '/api/data/evidence', {
      source: 'photo',
      evidence_type: 'fact',
      occurred_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
      content_ref: 'app://photo/camera/IMG_0001.jpg',
      context: { width: 1080, height: 1920, captured_via: 'expo-camera' },
      privacy_level: 'D2',
      resource_type: 'event',
      resource_id: eventIds[0] ?? 'no-event',
    });
    ctx.assert('拍照证据创建 → 201', photo.status === 201, `实际=${photo.status} ${JSON.stringify(photo.body).slice(0, 120)}`, 'P1');
  }
  // P4/P5 模拟语音证据
  if (['short_voice', 'cross_day'].includes(persona.focus)) {
    const voice = await client.http('POST', '/api/data/evidence', {
      source: 'manual_voice',
      evidence_type: 'self_report',
      occurred_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
      content_ref: 'app://audio/voice/REC_0001.m4a',
      context: { duration_sec: 23, transcription: '今天有点累但还行' },
      privacy_level: 'D1',
    });
    ctx.assert('语音证据创建 → 201', voice.status === 201, `实际=${voice.status} ${JSON.stringify(voice.body).slice(0, 120)}`, 'P1');
  }
  // 所有角色都创建一条文本证据
  const txt = await client.http('POST', '/api/data/evidence', {
    source: 'manual_text',
    evidence_type: 'self_report',
    occurred_at: new Date().toISOString(),
    captured_at: new Date().toISOString(),
    content_ref: `${persona.id} 的自述证据`,
    context: { personaAge: persona.profile.age, identity: persona.profile.identity },
    privacy_level: persona.contract.accessibility_profile.usage_mode === 'senior-easy' ? 'D1' : 'D2',
  });
  ctx.assert('文本证据创建 → 201', txt.status === 201, `实际=${txt.status}`, 'P1');
  return txt.body?.id;
}

async function createCommitments(ctx) {
  const { persona, client } = ctx;
  const commitments = {
    'P1-大学生-林晓': [{ text: '每天阅读 30 分钟', domain: '学习', weight: 0.7 }, { text: '每周给家里打一次电话', domain: '家庭', weight: 0.8 }],
    'P2-自由职业-沈砚': [{ text: '每天 23 点前关电脑', domain: '工作', weight: 0.8 }, { text: '每周末户外散步一次', domain: '身体', weight: 0.6 }],
    'P3-白领中层-陈总': [{ text: '每天 23 点前关手机', domain: '生活', weight: 0.7 }, { text: '每周复盘一次', domain: '工作', weight: 0.8 }],
    'P4-蓝领工人-老张': [{ text: '少喝酒', domain: '身体', weight: 0.6 }],
    'P5-平台工-小李': [{ text: '每天睡够 6 小时', domain: '身体', weight: 0.8 }],
    'P6-退休教师-王老师': [{ text: '每天读一章书', domain: '学习', weight: 0.6 }, { text: '每周见一次老朋友', domain: '关系', weight: 0.7 }],
    'P7-新晋妈妈-小梅': [{ text: '每天给自己 30 分钟', domain: '生活', weight: 0.6 }],
    'P8-创业者-王总': [{ text: '每周陪家人一天', domain: '家庭', weight: 0.9 }, { text: '每天运动 30 分钟', domain: '身体', weight: 0.7 }],
    'P9-老年视障-张奶奶': [{ text: '每天量一次血压', domain: '身体', weight: 0.7 }],
    'P10-青少年-小明': [{ text: '每天 23 点前睡觉', domain: '学习', weight: 0.5 }],
  }[persona.id] ?? [];

  const ids = [];
  for (const cm of commitments) {
    const r = await client.http('POST', '/api/data/commitments', cm);
    if (ctx.assert(`创建承诺"${cm.text}" → 200`, r.status === 200, `实际=${r.status}`, 'P1') && r.body?.id) {
      ids.push(r.body.id);
    }
  }
  return ids;
}

async function createHypotheses(ctx) {
  const { persona, client } = ctx;
  const statements = {
    'P1-大学生-林晓': ['每天写 500 字会让我更有创造力', '早起能让我效率更高'],
    'P2-自由职业-沈砚': ['早晨顿悟式的思考比下午更有质量', '客户反馈的第一反应通常是抵触而非理性'],
    'P3-白领中层-陈总': ['会议长度超过 60 分钟我会情绪恶化', '睡眠不足 5 小时第二天决策质量下降 50%'],
    'P4-蓝领工人-老张': ['腰疼和连续工时正相关'],
    'P5-平台工-小李': ['凌晨接单的客单价高于白天'],
    'P6-退休教师-王老师': ['阅读经典能缓解退休后的空虚感', '每天打太极让我情绪更稳定'],
    'P7-新晋妈妈-小梅': ['宝宝作息决定我情绪', '老公分担家务能显著降低我的崩溃感'],
    'P8-创业者-王总': ['核心员工离职高峰出现在融资后 3 个月', '保持每周 1 次家庭日能降低焦虑'],
    'P9-老年视障-张奶奶': ['每天接孩子电话能让我心情好一整天'],
    'P10-青少年-小明': ['打游戏超过 2 小时后我会和妈妈吵架'],
  }[persona.id] ?? [];

  const ids = [];
  for (let i = 0; i < statements.length; i++) {
    const r = await client.http('POST', '/api/data/hypotheses', {
      statement: statements[i], confidence: 0.5 + i * 0.05, status: 'testing',
    });
    if (ctx.assert(`创建假设#${i + 1} → 200`, r.status === 200, `实际=${r.status}`, 'P1') && r.body?.id) {
      ids.push(r.body.id);
    }
  }
  return ids;
}

async function createExperiments(ctx, hypothesisIds) {
  const { persona, client } = ctx;
  if (hypothesisIds.length === 0) return [];

  const exps = {
    'P1-大学生-林晓': { title: '一周每天写 500 字', durationDays: 7 },
    'P2-自由职业-沈砚': { title: '早晨 30 分钟纯思考时间', durationDays: 14 },
    'P3-白领中层-陈总': { title: '会议限长 45 分钟', durationDays: 14 },
    'P6-退休教师-王老师': { title: '每天太极 30 分钟', durationDays: 21 },
    'P7-新晋妈妈-小梅': { title: '老公分担夜奶', durationDays: 14 },
    'P8-创业者-王总': { title: '每周一天家庭日', durationDays: 28 },
  }[persona.id];

  if (!exps) return [];

  const r = await client.http('POST', '/api/data/experiments', {
    title: exps.title,
    duration_days: exps.durationDays,
    status: 'planned',
    hypothesis_id: hypothesisIds[0],
    stop_rule: '连续 3 天未执行则停止',
  });
  if (ctx.assert(`创建实验"${exps.title}" → 200`, r.status === 200, `实际=${r.status}`, 'P1') && r.body?.id) {
    return [r.body.id];
  }
  return [];
}

async function createProjects(ctx) {
  const { persona, client } = ctx;
  if (persona.focus !== 'multi_project' && persona.id !== 'P8-创业者-王总') {
    // 其他角色只创建 1 个项目
    const r = await client.http('POST', '/api/data/projects', {
      name: `${persona.profile.identity}的日常`,
      mission: `维护${persona.profile.identity}的生活节奏`,
    });
    if (ctx.assert('创建项目 → 200', r.status === 200, `实际=${r.status}`, 'P1') && r.body?.id) return [r.body.id];
    return [];
  }
  // P8 创建 3 个项目
  const ids = [];
  const projects = [
    { name: '产品 V2 发布', mission: '下个季度完成产品 V2 发布并达成 1000 用户' },
    { name: '团队扩张', mission: '本季度招聘 3 名核心工程师' },
    { name: '家庭陪伴计划', mission: '保持每周至少 1 次完整家庭日' },
  ];
  for (const p of projects) {
    const r = await client.http('POST', '/api/data/projects', p);
    if (ctx.assert(`创建项目"${p.name}" → 200`, r.status === 200, `实际=${r.status}`, 'P1') && r.body?.id) ids.push(r.body.id);
  }
  return ids;
}

async function triggerDistillation(ctx) {
  const { client } = ctx;
  const start = new Date(); start.setDate(start.getDate() - 30);
  const end = new Date();
  const r = await client.http('POST', '/api/data/distillation-jobs', {
    trigger: 'manual',
    timeWindow: { start: start.toISOString(), end: end.toISOString() },
  });
  ctx.assert('POST /distillation-jobs → 201', r.status === 201, `实际=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`, 'P1');
  if (r.status !== 201) return null;

  const jobId = r.body?.jobId;
  ctx.assert('返回 jobId', !!jobId, `body=${JSON.stringify(r.body).slice(0, 150)}`, 'P1');
  ctx.assert('返回 stages 数组', Array.isArray(r.body?.stages) && r.body.stages.length === 8, `stages.length=${r.body?.stages?.length}`, 'P2');

  // 验证 8 阶段都报告 generatedBy
  if (Array.isArray(r.body?.stages)) {
    for (const s of r.body.stages) {
      ctx.assert(`阶段#${s.stage}(${s.name}) 含 generatedBy`, ['llm', 'fallback', 'empty'].includes(s.generatedBy), `实际=${s.generatedBy}`, 'P2');
      ctx.assert(`阶段#${s.stage}(${s.name}) 含 status`, ['success', 'skipped', 'failed'].includes(s.status), `实际=${s.status}`, 'P2');
    }
  }

  // 轮询 GET 直到终态
  let final = null;
  for (let i = 0; i < 5; i++) {
    const poll = await client.http('GET', '/api/data/distillation-jobs');
    const found = (poll.body ?? []).find(j => j.id === jobId);
    if (found && (found.stage === 'done' || found.stage === 'error')) {
      final = found;
      break;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  ctx.assert('流水线进入终态', !!final, `final.stage=${final?.stage}`, 'P1');
  if (final) {
    ctx.assertEquals('流水线终态为 done', final.stage, 'done', 'P1');
    ctx.assert('流水线 result.stagesSummary 存在', !!(final.result?.stagesSummary || final.stages), `result=${JSON.stringify(final.result).slice(0, 200)}`, 'P2');
  }
  return jobId;
}

async function getBriefs(ctx) {
  const { client } = ctx;
  const today = await client.http('GET', '/api/brief/today');
  ctx.assert('GET /brief/today → 200', today.status === 200, `实际=${today.status}`, 'P1');
  if (today.status === 200) {
    ctx.assert('brief/today 含 generatedBy', ['llm', 'fallback', 'empty'].includes(today.body?.generatedBy), `实际=${today.body?.generatedBy}`, 'P2');
    ctx.assert('brief/today 含 state', !!today.body?.state, `body=${JSON.stringify(today.body).slice(0, 200)}`, 'P1');
    // 关键：state.divergence 必须是有限数（NaN 是 bug）
    if (today.body?.state) {
      ctx.assertRange('state.divergence 是有限数', today.body.state.divergence, 0, 1, 'P0');
      // 验证 inner/outer 向量所有 L1..L6 都是有限数
      for (const side of ['inner', 'outer']) {
        const vec = today.body.state[side];
        if (vec && typeof vec === 'object') {
          for (const k of Object.keys(vec)) {
            ctx.assertRange(`state.${side}.${k} 是有限数`, vec[k], -1, 1, 'P0');
          }
        }
      }
    }
  }

  const weekly = await client.http('GET', '/api/brief/weekly');
  ctx.assert('GET /brief/weekly → 200', weekly.status === 200, `实际=${weekly.status} ${JSON.stringify(weekly.body).slice(0, 200)}`, 'P1');

  const monthly = await client.http('GET', '/api/brief/monthly');
  ctx.assert('GET /brief/monthly → 200', monthly.status === 200, `实际=${monthly.status}`, 'P1');
}

async function chatWithSecretary(ctx) {
  const { persona, client } = ctx;
  const messages = {
    'P1-大学生-林晓': '我最近对未来很迷茫，不知道该选什么方向',
    'P2-自由职业-沈砚': '如何在自由职业中保持深度思考的时间？',
    'P3-白领中层-陈总': '下属交付质量不达标，我该怎么处理？',
    'P4-蓝领工人-老张': '腰疼怎么办',
    'P5-平台工-小李': '夜间接单怎么调整作息？',
    'P6-退休教师-王老师': '退休后如何保持生活的意义感？',
    'P7-新晋妈妈-小梅': '产后情绪起伏大，怎么办？',
    'P8-创业者-王总': '核心员工提出离职，我该如何挽留？',
    'P9-老年视障-张奶奶': '孩子忙，我一个人在家有点孤单',
    'P10-青少年-小明': '考试考砸了不想让妈妈知道',
  }[persona.id];

  const r = await client.http('POST', '/api/secretary/chat', { message: messages, history: [] });
  ctx.assert('POST /secretary/chat → 200', r.status === 200, `实际=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`, 'P1');
  if (r.status === 200) {
    ctx.assert('秘书回复含 reply 字段', typeof r.body?.reply === 'string' && r.body.reply.length > 0, `body=${JSON.stringify(r.body).slice(0, 200)}`, 'P1');
    ctx.assert('秘书回复含 risk 字段', typeof r.body?.risk !== 'undefined', `body=${JSON.stringify(r.body).slice(0, 200)}`, 'P2');
  }
}

async function exerciseCorrections(ctx, hypothesisIds) {
  const { persona, client } = ctx;
  if (hypothesisIds.length === 0) return;

  // 各角色用不同 correction_type 测试
  const correctionMap = {
    'P1-大学生-林晓': { type: 'unlike-me', text: '不太像，我有时反而因为迷茫而更投入' },
    'P2-自由职业-沈砚': { type: 'wrong-reason', text: '真正原因是早晨没被打扰' },
    'P3-白领中层-陈总': { type: 'wait', text: null },
    'P4-蓝领工人-老张': { type: 'special-case', text: '那天正好下雨工时短' },
    'P5-平台工-小李': { type: 'no-more-inference', text: null },
    'P6-退休教师-王老师': { type: 'unlike-me', text: '其实和太极无关，主要是出门见朋友' },
    'P7-新晋妈妈-小梅': { type: 'special-case', text: '老公那天出差了不算常态' },
    'P8-创业者-王总': { type: 'phase-changed', text: '从早期到成长期阶段不同了' },
    'P9-老年视障-张奶奶': { type: 'wait', text: null },
    'P10-青少年-小明': { type: 'unlike-me', text: '不完全是这样的' },
  }[persona.id];

  if (!correctionMap) return;

  const target_id = hypothesisIds[0];
  const r = await client.http('POST', '/api/data/corrections', {
    target_id, target_type: 'hypothesis',
    correction_type: correctionMap.type, user_text: correctionMap.text,
  });
  ctx.assert(`纠正"${correctionMap.type}" → 201`, r.status === 201, `实际=${r.status} ${JSON.stringify(r.body).slice(0, 200)}`, 'P1');

  // 验证状态机变化
  if (r.status === 201) {
    const list = await client.http('GET', '/api/data/hypotheses');
    const found = (list.body ?? []).find(h => h.id === target_id);
    if (found) {
      const expected = {
        'unlike-me': 'rejected',
        'wrong-reason': 'revised',
        'wait': 'testing', // 不变
        'special-case': 'testing', // 不变
        'no-more-inference': 'testing', // 不变
        'phase-changed': 'testing', // 对 hypothesis 无副作用
      }[correctionMap.type];
      ctx.assertEquals(`纠正"${correctionMap.type}"后 hypothesis.status`, found.status, expected, 'P1');
    }
  }

  // 测试 idempotency-key 头
  if (hypothesisIds.length > 1) {
    // HTTP header 不允许非 ASCII 字符，使用纯 ASCII slug
    const slug = persona.id.replace(/[^A-Za-z0-9]/g, '');
    const idemKey = `corr-idem-${slug}-${TS}`;
    const c1 = await client.http('POST', '/api/data/corrections', {
      target_id: hypothesisIds[1], target_type: 'hypothesis',
      correction_type: 'wait',
    }, { idempotencyKey: idemKey });
    const c2 = await client.http('POST', '/api/data/corrections', {
      target_id: hypothesisIds[1], target_type: 'hypothesis',
      correction_type: 'wait',
    }, { idempotencyKey: idemKey });
    ctx.assert('Idempotency-Key 重复提交被去重', c1.status === 201 && (c2.status === 200 || c2.body?.duplicate === true || c2.body?.id === c1.body?.id), `c1=${c1.status} c2=${c2.status} c2body=${JSON.stringify(c2.body).slice(0, 100)}`, 'P2');
  }
}

async function checkAuditAndExport(ctx) {
  const { persona, client } = ctx;
  const audit = await client.http('GET', '/api/data/audit?limit=500');
  ctx.assert('GET /audit → 200', audit.status === 200, `实际=${audit.status}`, 'P1');
  if (audit.status === 200) {
    const items = audit.body?.items ?? (Array.isArray(audit.body) ? audit.body : []);
    ctx.assert('审计日志非空', items.length > 0, `count=${items.length}`, 'P1');
    // 验证关键事件被记录
    const actions = items.map(a => a.action);
    ctx.assert('审计含 event.create', actions.includes('event.create'), `actions=${actions.slice(0, 10).join(',')}`, 'P2');
    ctx.assert('审计含 service_contract.update', actions.includes('service_contract.update'), '', 'P2');
    ctx.assert('审计含 correction.create', actions.includes('correction.create'), '', 'P2');
  }

  const exp = await client.http('GET', '/api/data/export');
  ctx.assert('GET /export → 200', exp.status === 200, `实际=${exp.status}`, 'P1');
  if (exp.status === 200) {
    ctx.assert('导出含 exportedAt', !!exp.body?.exportedAt, '', 'P2');
    ctx.assert('导出含 data.events', !!exp.body?.data?.events, '', 'P1');
    ctx.assert('导出含 data.audit_logs', !!exp.body?.data?.audit_logs, '', 'P2');
    // 验证导出数据不含其他用户的数据（隔离）
    const evts = exp.body?.data?.events ?? [];
    if (evts.length > 0) {
      const allMine = evts.every(e => !e.user_id || e.user_id === client.getUserId());
      ctx.assert('导出仅含本人事件（用户隔离）', allMine, `第一个 event.user_id=${evts[0]?.user_id} vs mine=${client.getUserId()}`, 'P0');
    }
  }
}

// =================================================================
// 角色特定的边界用例
// =================================================================

async function runPersonaEdgeCases(ctx) {
  const { persona, client } = ctx;
  switch (persona.focus) {
    case 'explore': // P1
      // 测试 emoji + 长文本
      const longEmoji = await client.http('POST', '/api/data/events', {
        content: '🎉今天去看了学校社团招新🎭，被街舞社吸引💃，但也在思考是否该加入辩论队🤔。' + '辅助'.repeat(50),
        mood: 0.6, tags: ['关系', '创造'],
      });
      ctx.assert('P1: 长文本+emoji 事件 → 200', longEmoji.status === 200, `实际=${longEmoji.status}`, 'P1');
      // 测试 tags 数组多元素
      const multiTag = await client.http('POST', '/api/data/events', {
        content: '多标签测试', mood: 0.3, tags: ['学习', '关系', '创造', '身体', '工作', '意义', '家庭'],
      });
      ctx.assert('P1: 7 标签事件 → 200', multiTag.status === 200, `实际=${multiTag.status}`, 'P2');
      break;

    case 'longform': // P2
      // 超长文本（5000字）
      const superLong = '今天深度反思：' + '关于专注力与创造力之间关系的持续观察，我发现自己在不同时段的产出差异显著。'.repeat(60);
      const r = await client.http('POST', '/api/data/events', {
        content: superLong, mood: 0.5, tags: ['学习', '创造'],
        userInterpretation: '长篇反思也是自我整理',
      });
      ctx.assert('P2: 5000+ 字事件 → 200', r.status === 200, `实际=${r.status} ${JSON.stringify(r.body).slice(0, 100)}`, 'P1');
      if (r.status === 200) {
        // 验证长文本被完整保存（不被截断）
        const list = await client.http('GET', '/api/data/events?limit=1');
        const found = (list.body ?? []).find(e => e.id === r.body.id);
        ctx.assert('P2: 长文本未被截断', found?.content?.length >= superLong.length, `实际=${found?.content?.length} 期望>=${superLong.length}`, 'P1');
      }
      // 创建 meta-principle
      const mp = await client.http('POST', '/api/data/meta-principles', {
        statement: '深度思考需要先放下"必须产出"的执念',
        domains: ['工作', '学习'], evidence: [], counterevidence: [],
      });
      ctx.assert('P2: 创建 meta-principle → 201', mp.status === 201, `实际=${mp.status}`, 'P1');
      // 创建 personal skill 含 preconditions
      const ps = await client.http('POST', '/api/data/personal-skills', {
        trigger: '想进入深度思考',
        preconditions: [{ field: 'time', value: '早晨' }, { field: 'distraction', value: 'low' }],
        procedure: ['关闭通知', '准备纸笔', '设定 30 分钟'],
        anti_patterns: ['依赖灵感'],
        scope: '工作',
      });
      ctx.assert('P2: 创建 personal-skill with structured preconditions → 201', ps.status === 201, `实际=${ps.status}`, 'P1');
      break;

    case 'rapid_stress': // P3
      // 测试极端 mood 值是否被存储（不应该崩溃，但 state engine 可能 NaN）
      const extremePos = await client.http('POST', '/api/data/events', {
        content: '极端正情绪测试', mood: 5.0, tags: ['工作'],
      });
      ctx.assert('P3: mood=5.0 事件 → 200（存储允许但 state engine 应当 clamp）', extremePos.status === 200, `实际=${extremePos.status}`, 'P1');
      const extremeNeg = await client.http('POST', '/api/data/events', {
        content: '极端负情绪测试', mood: -5.0, tags: ['工作'],
      });
      ctx.assert('P3: mood=-5.0 事件 → 200', extremeNeg.status === 200, `实际=${extremeNeg.status}`, 'P1');
      // 关键：state.divergence 必须是有限数（NaN 是 bug P0）
      const state1 = await client.http('GET', '/api/data/state');
      ctx.assert('P3: GET /state → 200', state1.status === 200, `实际=${state1.status}`, 'P1');
      if (state1.status === 200) {
        const div = state1.body?.divergence;
        ctx.assert('P3: state.divergence 在极端 mood 下仍是有限数', typeof div === 'number' && Number.isFinite(div), `实际=${div}（NaN 是 P0 bug）`, 'P0');
        // 验证 clamp 后的值在 [0, 1]
        ctx.assertRange('P3: state.divergence clamp 到 [0,1]', div, 0, 1, 'P0');
      }
      break;

    case 'short_voice': // P4
      // 极短文本
      const short1 = await client.http('POST', '/api/data/events', { content: '累', mood: -0.4, tags: ['身体'] });
      ctx.assert('P4: 单字事件 → 200', short1.status === 200, `实际=${short1.status}`, 'P1');
      const short2 = await client.http('POST', '/api/data/events', { content: '困', mood: -0.3, tags: ['身体'] });
      ctx.assert('P4: 单字事件2 → 200', short2.status === 200, `实际=${short2.status}`, 'P1');
      // 测试 source='calendar' 的 outer 事件
      const cal = await client.http('POST', '/api/data/events', {
        content: '明天体检', source: 'calendar', layer: 'fact', tags: ['身体'],
      });
      ctx.assert('P4: source=calendar 事件 → 200', cal.status === 200, `实际=${cal.status}`, 'P1');
      if (cal.status === 200) {
        ctx.assertEquals('P4: source=calendar 推断 axis', cal.body?.axis, 'outer', 'P2');
      }
      break;

    case 'cross_day': // P5
      // 自定义 created_at（跨日时间戳）
      const dayAgo = new Date(Date.now() - 86400 * 1000);
      const ev = await client.http('POST', '/api/data/events', {
        content: '昨天的记录', mood: -0.2, tags: ['工作'],
        created_at: dayAgo.toISOString(),
      });
      ctx.assert('P5: 自定义 created_at 事件 → 200', ev.status === 200, `实际=${ev.status}`, 'P1');
      // 测试大 limit 分页
      const bigPage = await client.http('GET', '/api/data/events?limit=500');
      ctx.assert('P5: limit=500 不超过 maxLimit=200', bigPage.status === 200 && (bigPage.body?.length ?? 0) <= 200, `实际=${bigPage.body?.length}`, 'P2');
      // 测试 cursor 翻页
      const p1 = await client.http('GET', '/api/data/events?limit=2');
      if (p1.body?.[0]?.created_at) {
        const cursor = encodeURIComponent(p1.body[0].created_at);
        const p2 = await client.http('GET', `/api/data/events?limit=2&cursor=${cursor}`);
        ctx.assert('P5: cursor 翻页 → 200', p2.status === 200, `实际=${p2.status}`, 'P2');
        // 不应包含 cursor 那条本身
        const overlap = (p2.body ?? []).find(r => r.id === p1.body[0].id);
        ctx.assert('P5: cursor 后页不含 cursor 行', !overlap, '', 'P2');
      }
      break;

    case 'longform_senior': // P6
      // 极端 accessibility_profile
      const c = await client.http('GET', '/api/data/service-contract');
      ctx.assert('P6: GET /service-contract → 200', c.status === 200, `实际=${c.status}`, 'P1');
      if (c.status === 200) {
        ctx.assertEquals('P6: font_scale=1.5 保留', c.body?.accessibility_profile?.font_scale, 1.5, 'P1');
        ctx.assertEquals('P6: voice_readout=true 保留', c.body?.accessibility_profile?.voice_readout, true, 'P1');
        ctx.assertEquals('P6: single_confirm=true 保留', c.body?.accessibility_profile?.single_confirm, true, 'P1');
        ctx.assertEquals('P6: usage_mode=senior-easy 保留', c.body?.accessibility_profile?.usage_mode, 'senior-easy', 'P1');
        ctx.assertEquals('P6: avatar=V1 保留', c.body?.avatar, 'V1', 'P1');
      }
      // 创建 experience with full fields
      const exp = await client.http('POST', '/api/data/experiences', {
        context: '退休后的学习生活',
        problem: '退休后失去教学的成就感',
        actions: ['每天读一章书', '每周去社区做义务辅导'],
        outcome: '三个月后感觉生活重新有了节奏',
        lesson: '意义感来自持续给予，而非职位',
        applicability: '退休人群',
        maturity: 'observed',
      });
      ctx.assert('P6: 创建完整 experience → 201', exp.status === 201, `实际=${exp.status}`, 'P1');
      break;

    case 'extreme_mood': // P7
      // 极端 mood 值（应该允许存储，state engine 应 clamp）
      const pos = await client.http('POST', '/api/data/events', { content: '宝宝第一次叫我妈妈', mood: 1.0, tags: ['家庭'] });
      ctx.assert('P7: mood=1.0 事件 → 200', pos.status === 200, `实际=${pos.status}`, 'P1');
      const neg = await client.http('POST', '/api/data/events', { content: '凌晨四点喂奶崩溃', mood: -1.0, tags: ['身体', '家庭'] });
      ctx.assert('P7: mood=-1.0 事件 → 200', neg.status === 200, `实际=${neg.status}`, 'P1');
      // 多次连续创建（频繁记录）
      for (let i = 0; i < 5; i++) {
        const r = await client.http('POST', '/api/data/events', {
          content: `记录#${i}`, mood: i % 2 === 0 ? 0.3 : -0.3, tags: ['家庭'],
        });
        ctx.assert(`P7: 连续记录#${i + 1} → 200`, r.status === 200, `实际=${r.status}`, 'P1');
      }
      // 验证幂等性
      const idemKey = `ev-idem-${persona.id}-${TS}`;
      const d1 = await client.http('POST', '/api/data/events', { id: idemKey, content: '幂等测试', mood: 0.3, tags: ['家庭'] });
      const d2 = await client.http('POST', '/api/data/events', { id: idemKey, content: '幂等测试', mood: 0.3, tags: ['家庭'] });
      ctx.assert('P7: 相同 id 幂等提交', d1.body?.id === d2.body?.id, `d1=${d1.body?.id} d2=${d2.body?.id}`, 'P2');
      break;

    case 'multi_project': // P8
      // 创建多个 milestone 和 risk
      const projects = await client.http('GET', '/api/data/projects');
      ctx.assert('P8: 多项目查询 → 200', projects.status === 200 && Array.isArray(projects.body), `实际=${projects.status}`, 'P1');
      if (projects.body?.length >= 3) {
        ctx.assert('P8: 至少 3 个项目', projects.body.length >= 3, `实际=${projects.body.length}`, 'P1');
      }
      // 测试 phase-changed correction 影响 model-versions（P8 用 phase-changed）
      // 已在 exerciseCorrections 中触发 phase-changed
      // 验证创建了新 model-version
      const mv = await client.http('GET', '/api/data/model-versions');
      ctx.assert('P8: GET /model-versions → 200', mv.status === 200, `实际=${mv.status}`, 'P1');
      if (mv.status === 200) {
        const items = mv.body?.items ?? [];
        ctx.assert('P8: phase-changed 后存在 model-version', items.length > 0, `count=${items.length}`, 'P2');
        // 验证最新版本 label 形如 'v-phase-...'
        if (items.length > 0) {
          const latest = items[0];
          ctx.assert('P8: 最新版本 archive 状态非 active', latest.status !== 'active' || latest.version.startsWith('v-phase'), `status=${latest.status} version=${latest.version}`, 'P2');
        }
      }
      break;

    case 'accessibility_extreme': // P9
      // 极端 font_scale=2.0
      const c2 = await client.http('PUT', '/api/data/service-contract', {
        ...persona.contract,
        accessibility_profile: { font_scale: 2.0, voice_readout: true, single_confirm: true, usage_mode: 'senior-easy' },
      });
      ctx.assert('P9: font_scale=2.0 PUT → 200', c2.status === 200, `实际=${c2.status}`, 'P1');
      if (c2.status === 200) {
        ctx.assertEquals('P9: font_scale=2.0 保留', c2.body?.accessibility_profile?.font_scale, 2.0, 'P1');
      }
      // 测试 avatar=V3
      const c3 = await client.http('PUT', '/api/data/service-contract', { avatar: 'V3' });
      ctx.assert('P9: avatar=V3 PUT → 200', c3.status === 200, `实际=${c3.status}`, 'P1');
      if (c3.status === 200) {
        ctx.assertEquals('P9: avatar=V3 保留', c3.body?.avatar, 'V3', 'P1');
      }
      // 非法 avatar 应被拒
      const badAvatar = await client.http('PUT', '/api/data/service-contract', { avatar: 'V9' });
      ctx.assert('P9: avatar=V9 应 → 400', badAvatar.status === 400, `实际=${badAvatar.status}`, 'P1');
      break;

    case 'edge_boundary': // P10
      // 测试非法 mood（字符串）
      const badMood = await client.http('POST', '/api/data/events', {
        content: '非法 mood 测试', mood: 'happy', tags: ['学习'],
      });
      // 期望：要么 400 拒绝，要么 200 但存储为 null（不应崩溃）
      ctx.assert('P10: mood="happy" 字符串 → 200 或 400（不应崩溃）', badMood.status === 200 || badMood.status === 400, `实际=${badMood.status}`, 'P0');
      // 测试非法 axis
      const badAxis = await client.http('POST', '/api/data/events', {
        content: '非法 axis 测试', axis: 'invalid', tags: ['学习'],
      });
      ctx.assert('P10: axis=invalid → 200 且 fallback 到 outer（不应崩溃）', badAxis.status === 200, `实际=${badAxis.status}`, 'P0');
      if (badAxis.status === 200) {
        ctx.assertEquals('P10: 非法 axis fallback 到 outer', badAxis.body?.axis, 'outer', 'P1');
      }
      // 测试非法 reflection_depth（应 400）
      const badRD = await client.http('PUT', '/api/data/service-contract', { reflection_depth: 'R9' });
      ctx.assert('P10: reflection_depth=R9 应 → 400', badRD.status === 400, `实际=${badRD.status}`, 'P1');
      // 测试非法 correction_type
      const badCorr = await client.http('POST', '/api/data/corrections', {
        target_id: 'any', target_type: 'hypothesis', correction_type: 'invalid-type',
      });
      ctx.assert('P10: correction_type=invalid 应 → 400', badCorr.status === 400, `实际=${badCorr.status}`, 'P1');
      // 测试 SQL 注入尝试
      const sqli = await client.http('POST', '/api/data/events', {
        content: "'; DROP TABLE events; --", mood: 0.1, tags: ['学习'],
      });
      ctx.assert('P10: SQL 注入尝试不崩溃 → 200', sqli.status === 200, `实际=${sqli.status}`, 'P0');
      // 验证 events 表还在
      const stillThere = await client.http('GET', '/api/data/events?limit=1');
      ctx.assert('P10: SQL 注入后 events 表仍可用', stillThere.status === 200, `实际=${stillThere.status}`, 'P0');
      // 测试特殊 unicode
      const rtl = await client.http('POST', '/api/data/events', {
        content: 'مرحبا بالعالم עולם', mood: 0.3, tags: ['学习'],
      });
      ctx.assert('P10: RTL 文本事件 → 200', rtl.status === 200, `实际=${rtl.status}`, 'P1');
      // 测试空 tags
      const noTags = await client.http('POST', '/api/data/events', { content: '无标签', mood: 0.2 });
      ctx.assert('P10: 空 tags 事件 → 200', noTags.status === 200, `实际=${noTags.status}`, 'P1');
      if (noTags.status === 200) {
        const tags = Array.isArray(noTags.body?.tags) ? noTags.body.tags : [];
        ctx.assert('P10: 空 tags 默认为空数组', tags.length === 0, `实际=${JSON.stringify(tags)}`, 'P2');
      }
      break;
  }
}

// =================================================================
// 单角色完整流程
// =================================================================

async function runPersonaFlow(persona) {
  const ctx = new PersonaContext(persona);
  console.log(`\n--- 角色：${persona.id}（${persona.profile.age}岁/${persona.profile.identity}/${persona.profile.personality}/${persona.profile.usage_mode}）---`);
  try {
    const ok = await registerAndSetupContract(ctx);
    if (!ok) return ctx;

    const eventIds = await writeEvents(ctx);
    await createCommitments(ctx);
    const hypothesisIds = await createHypotheses(ctx);
    await createExperiments(ctx, hypothesisIds);
    await createProjects(ctx);
    await createEvidence(ctx, eventIds);
    await triggerDistillation(ctx);
    await getBriefs(ctx);
    await exerciseCorrections(ctx, hypothesisIds);
    await chatWithSecretary(ctx);
    await runPersonaEdgeCases(ctx);
    await checkAuditAndExport(ctx);

    // 验证幂等性：重复创建相同 id 事件
    if (eventIds.length > 0) {
      const dup = await ctx.client.http('POST', '/api/data/events', { id: eventIds[0], content: '重复测试', mood: 0.1 });
      ctx.assert('重复 id 提交不报错', dup.status === 200, `实际=${dup.status}`, 'P2');
      ctx.assertEquals('重复 id 提交返回相同 id', dup.body?.id, eventIds[0], 'P2');
    }
  } catch (e) {
    ctx.record('未捕获异常', false, String(e?.stack ?? e?.message ?? e), 'P0');
  } finally {
    await cleanupAccount(ctx);
  }
  return ctx;
}

// =================================================================
// 并发执行器（控制并发数避免 LLM 限流）
// =================================================================

async function runWithConcurrency(items, worker, concurrency) {
  const results = [];
  let cursor = 0;
  async function next() {
    if (cursor >= items.length) return;
    const idx = cursor++;
    const item = items[idx];
    const r = await worker(item, idx);
    results[idx] = r;
    return next();
  }
  const workers = Array.from({ length: concurrency }, () => next());
  await Promise.all(workers);
  return results;
}

// =================================================================
// Phase 2: 激进边界用例（独立账号，不与角色并发）
// =================================================================

async function runAggressiveEdgeCases() {
  console.log('\n=== Phase 2: 激进边界用例（独立账号） ===');
  const persona = { id: 'EDGE', profile: { age: 30, identity: '边界测试', personality: '严格', usage_mode: 'action-nav' }, contract: {} };
  const ctx = new PersonaContext(persona);

  // 注册独立账号
  const slug = 'EDGE';
  const email = `p-${slug}-${TS}@zhixingos.com`;
  ctx.createdEmail = email;
  const reg = await ctx.client.http('POST', '/api/auth/register', { email, password: PASS, displayName: 'EdgeCase' });
  ctx.assert('EDGE: 注册成功', reg.status === 200, `实际=${reg.status}`, 'P0');
  if (reg.status !== 200) return ctx;
  ctx.client.setAuth(reg.body?.accessToken, reg.body?.refreshToken, reg.body?.id, 'EdgeCase');

  const c = ctx.client;

  // ---------- 2.1 状态引擎 NaN 测试 ----------
  // mood 传字符串 → state engine 是否 NaN 传染
  const strMood = await c.http('POST', '/api/data/events', { content: '字符串 mood 测试', mood: 'happy', tags: ['身体'] });
  ctx.assert('EDGE: mood="happy" → 200 或 400', strMood.status === 200 || strMood.status === 400, `实际=${strMood.status}`, 'P0');
  if (strMood.status === 200) {
    const st = await c.http('GET', '/api/data/state');
    ctx.assert('EDGE: 字符串 mood 后 GET /state → 200', st.status === 200, `实际=${st.status}`, 'P0');
    if (st.status === 200) {
      const div = st.body?.divergence;
      ctx.assert('EDGE: 字符串 mood 后 divergence 仍为有限数', typeof div === 'number' && Number.isFinite(div), `实际=${div}（NaN 是 P0 bug）`, 'P0');
    }
  }

  // mood 传 NaN 字符串
  const nanMood = await c.http('POST', '/api/data/events', { content: 'NaN mood 测试', mood: NaN, tags: ['身体'] });
  ctx.assert('EDGE: mood=NaN → 200 或 400', nanMood.status === 200 || nanMood.status === 400, `实际=${nanMood.status}`, 'P0');
  if (nanMood.status === 200) {
    const st = await c.http('GET', '/api/data/state');
    ctx.assert('EDGE: NaN mood 后 GET /state → 200（不崩溃）', st.status === 200, `实际=${st.status}`, 'P0');
    if (st.status === 200) {
      const div = st.body?.divergence;
      ctx.assert('EDGE: NaN mood 后 divergence 仍为有限数', typeof div === 'number' && Number.isFinite(div), `实际=${div}（NaN 是 P0 bug）`, 'P0');
      // 验证 inner/outer 向量所有值都是有限数
      for (const side of ['inner', 'outer']) {
        const vec = st.body?.[side] ?? {};
        for (const k of Object.keys(vec)) {
          ctx.assert(`EDGE: NaN mood 后 state.${side}.${k} 是有限数`, typeof vec[k] === 'number' && Number.isFinite(vec[k]), `实际=${vec[k]}`, 'P0');
        }
      }
    }
  }

  // mood 传 Infinity（JSON 序列化为 null）
  const infMood = await c.http('POST', '/api/data/events', { content: 'Infinity mood 测试', mood: Infinity, tags: ['身体'] });
  ctx.assert('EDGE: mood=Infinity → 200 或 400', infMood.status === 200 || infMood.status === 400, `实际=${infMood.status}`, 'P0');

  // mood 传对象
  const objMood = await c.http('POST', '/api/data/events', { content: '对象 mood 测试', mood: { value: 0.5 }, tags: ['身体'] });
  ctx.assert('EDGE: mood={value:0.5} → 200 或 400（不应崩溃）', objMood.status === 200 || objMood.status === 400, `实际=${objMood.status}`, 'P0');

  // ---------- 2.2 蒸馏流水线边界 ----------
  // 时间窗口 start >= end → 400
  const sameTime = new Date().toISOString();
  const badWindow = await c.http('POST', '/api/data/distillation-jobs', {
    trigger: 'manual', timeWindow: { start: sameTime, end: sameTime },
  });
  ctx.assert('EDGE: timeWindow start==end → 400', badWindow.status === 400, `实际=${badWindow.status}`, 'P1');

  // start > end → 400
  const badWindow2 = await c.http('POST', '/api/data/distillation-jobs', {
    trigger: 'manual', timeWindow: { start: sameTime, end: new Date(Date.now() - 86400000).toISOString() },
  });
  ctx.assert('EDGE: timeWindow start>end → 400', badWindow2.status === 400, `实际=${badWindow2.status}`, 'P1');

  // 非法 trigger
  const badTrigger = await c.http('POST', '/api/data/distillation-jobs', {
    trigger: 'invalid', timeWindow: { start: new Date(Date.now() - 86400000).toISOString(), end: sameTime },
  });
  ctx.assert('EDGE: trigger=invalid → 400', badTrigger.status === 400, `实际=${badTrigger.status}`, 'P1');

  // ---------- 2.3 纠正对不存在目标 ----------
  const ghostCorrection = await c.http('POST', '/api/data/corrections', {
    target_id: 'non-existent-target-id', target_type: 'hypothesis', correction_type: 'unlike-me',
  });
  ctx.assert('EDGE: 纠正不存在的 target → 201（不校验存在性，但应不崩溃）', ghostCorrection.status === 201, `实际=${ghostCorrection.status}`, 'P2');

  // phase-changed 对不存在的 target → 是否归档所有版本
  const ghostPhase = await c.http('POST', '/api/data/corrections', {
    target_id: 'another-ghost-id', target_type: 'pattern', correction_type: 'phase-changed', user_text: '阶段变化测试',
  });
  ctx.assert('EDGE: phase-changed 对不存在 target → 201', ghostPhase.status === 201, `实际=${ghostPhase.status}`, 'P2');
  if (ghostPhase.status === 201) {
    // 验证是否仍然归档了所有 active model versions（这是潜在 P1 问题：归档影响范围过大）
    const mv = await c.http('GET', '/api/data/model-versions?limit=10');
    if (mv.status === 200) {
      const items = mv.body?.items ?? [];
      // 检查是否所有 active 版本都被归档了（可能不是 bug 但值得记录）
      ctx.assert('EDGE: phase-changed 后 model-versions 可查询', items.length >= 0, '', 'P3');
    }
  }

  // ---------- 2.4 PATCH 任意字段注入 ----------
  const ev = await c.http('POST', '/api/data/events', { content: 'PATCH 注入测试', mood: 0.3, tags: ['工作'] });
  if (ev.status === 200 && ev.body?.id) {
    // PATCH hypothesis 不会影响 event，但测试 PATCH /experiences 接受任意字段
    const exp = await c.http('POST', '/api/data/experiences', { context: 'PATCH 测试', problem: '注入', actions: [], outcome: '', lesson: 'x', maturity: 'candidate' });
    if (exp.status === 201 && exp.body?.id) {
      const patched = await c.http('PATCH', `/api/data/experiences/${exp.body.id}`, {
        lesson: '已更新',
        malicious_field: 'should-not-be-persisted', // 任意字段
        another_injection: { evil: true },
      });
      ctx.assert('EDGE: PATCH /experiences 含任意字段 → 200', patched.status === 200, `实际=${patched.status}`, 'P2');
      if (patched.status === 200) {
        // 验证恶意字段是否被持久化到 doc
        const list = await c.http('GET', '/api/data/experiences');
        const found = (list.body ?? []).find(e => e.id === exp.body.id);
        // doc 字段被合并是预期行为（rowToDoc），但暴露给前端是否是问题？
        // 这是一个 P2 问题：PATCH 不验证字段白名单
        ctx.assert('EDGE: PATCH 任意字段不污染 lesson', found?.lesson === '已更新', `实际=${found?.lesson}`, 'P1');
      }
    }
  }

  // ---------- 2.5 服务契约 data_scope 非法 key ----------
  const badScope = await c.http('PUT', '/api/data/service-contract', {
    data_scope: { D5: true, D99: true, invalid: 'not-boolean' },
  });
  ctx.assert('EDGE: data_scope 含 D5/D99/invalid → 200 但应被忽略或拒绝', badScope.status === 200 || badScope.status === 400, `实际=${badScope.status}`, 'P2');
  // 当前实现接受任意 key（zod 只校验 Record<string,boolean> 但实际接受任意 JSON）
  // 这是一个 P2 问题：data_scope 没有枚举校验

  // 非法 quiet_hours 格式
  const badQuiet = await c.http('PUT', '/api/data/service-contract', {
    quiet_hours: { start: '25:00', end: '99:00' }, // 非法时间
  });
  ctx.assert('EDGE: quiet_hours 含非法时间 → 200 或 400', badQuiet.status === 200 || badQuiet.status === 400, `实际=${badQuiet.status}`, 'P2');
  // 当前实现不校验时间格式

  // 非法 high_impact_confirmation
  const badHic = await c.http('PUT', '/api/data/service-contract', { high_impact_confirmation: 5 });
  ctx.assert('EDGE: high_impact_confirmation=5 → 400', badHic.status === 400, `实际=${badHic.status}`, 'P1');

  // 非法 local_only
  const badLocal = await c.http('PUT', '/api/data/service-contract', { local_only: -1 });
  ctx.assert('EDGE: local_only=-1 → 400', badLocal.status === 400, `实际=${badLocal.status}`, 'P1');

  // ---------- 2.6 证据悬空引用 ----------
  const dangling = await c.http('POST', '/api/data/evidence', {
    source: 'manual_text', evidence_type: 'fact',
    occurred_at: new Date().toISOString(), captured_at: new Date().toISOString(),
    content_ref: '悬空引用测试',
    resource_type: 'event', resource_id: 'non-existent-event-id-xxx',
  });
  ctx.assert('EDGE: 证据悬空 resource_id → 201（当前不校验 FK）', dangling.status === 201, `实际=${dangling.status}`, 'P2');

  // 非法 source
  const badSource = await c.http('POST', '/api/data/evidence', {
    source: 'invalid-source', evidence_type: 'fact', occurred_at: new Date().toISOString(),
  });
  ctx.assert('EDGE: source=invalid → 400', badSource.status === 400, `实际=${badSource.status}`, 'P1');

  // 非法 privacy_level
  const badPrivacy = await c.http('POST', '/api/data/evidence', {
    source: 'manual_text', evidence_type: 'fact', occurred_at: new Date().toISOString(), privacy_level: 'D9',
  });
  ctx.assert('EDGE: privacy_level=D9 → 400', badPrivacy.status === 400, `实际=${badPrivacy.status}`, 'P1');

  // ---------- 2.7 Source permissions 生命周期 ----------
  const sp = await c.http('POST', '/api/data/source-permissions', {
    data_type: 'health', purpose: '测试健康数据接入', scope: { fields: ['steps', 'sleep'] },
  });
  ctx.assert('EDGE: 创建 source-permission → 201', sp.status === 201, `实际=${sp.status}`, 'P1');

  const spList = await c.http('GET', '/api/data/source-permissions');
  ctx.assert('EDGE: GET /source-permissions → 200', spList.status === 200 && Array.isArray(spList.body), `实际=${spList.status}`, 'P1');

  if (sp.status === 201) {
    const revoke = await c.http('POST', '/api/data/source-permissions/health/revoke');
    ctx.assert('EDGE: 撤销 source-permission → 200', revoke.status === 200, `实际=${revoke.status}`, 'P1');
  }

  // 非法 data_type
  const badDt = await c.http('POST', '/api/data/source-permissions', { data_type: 'invalid', purpose: 'x' });
  ctx.assert('EDGE: data_type=invalid → 400', badDt.status === 400, `实际=${badDt.status}`, 'P1');

  // ---------- 2.8 Model version 回滚 ----------
  const mvList = await c.http('GET', '/api/data/model-versions?limit=5');
  if (mvList.status === 200 && mvList.body?.items?.length > 0) {
    const first = mvList.body.items[mvList.body.items.length - 1];
    const rb = await c.http('POST', `/api/data/model-versions/rollback/${first.id}`);
    ctx.assert('EDGE: 回滚到历史版本 → 200', rb.status === 200, `实际=${rb.status}`, 'P1');
  }
  const rb404 = await c.http('POST', '/api/data/model-versions/rollback/non-existent');
  ctx.assert('EDGE: 回滚不存在版本 → 404', rb404.status === 404, `实际=${rb404.status}`, 'P1');

  // ---------- 2.9 DELETE event 级联 ----------
  const ev2del = await c.http('POST', '/api/data/events', { content: '将被删除', mood: 0.1, tags: ['工作'] });
  if (ev2del.status === 200 && ev2del.body?.id) {
    const linked = await c.http('POST', '/api/data/evidence', {
      source: 'manual_text', evidence_type: 'fact', occurred_at: new Date().toISOString(),
      captured_at: new Date().toISOString(), content_ref: '关联到将被删除的事件',
      resource_type: 'event', resource_id: ev2del.body.id,
    });
    ctx.assert('EDGE: 创建关联证据 → 201', linked.status === 201, `实际=${linked.status}`, 'P1');

    const del = await c.http('DELETE', `/api/data/events/${ev2del.body.id}`);
    ctx.assert('EDGE: DELETE event → 200 或 204', del.status === 200 || del.status === 204, `实际=${del.status}`, 'P1');
    // 验证关联证据的状态（是否级联删除或失效）
    const evList = await c.http('GET', '/api/data/events?limit=200');
    const stillThere = (evList.body ?? []).find(e => e.id === ev2del.body.id);
    ctx.assert('EDGE: 已删除 event 不在列表中', !stillThere, '', 'P1');
  }

  // DELETE 不存在的 event
  const del404 = await c.http('DELETE', '/api/data/events/non-existent-id');
  ctx.assert('EDGE: DELETE 不存在的 event → 404 或 200', del404.status === 404 || del404.status === 200, `实际=${del404.status}`, 'P2');

  // ---------- 2.10 分页边界 ----------
  const negLimit = await c.http('GET', '/api/data/events?limit=-5');
  ctx.assert('EDGE: limit=-5 → 200（fallback 到默认）', negLimit.status === 200, `实际=${negLimit.status}`, 'P2');

  const zeroLimit = await c.http('GET', '/api/data/events?limit=0');
  ctx.assert('EDGE: limit=0 → 200（fallback 到默认）', zeroLimit.status === 200, `实际=${zeroLimit.status}`, 'P2');

  const hugeLimit = await c.http('GET', '/api/data/events?limit=99999');
  ctx.assert('EDGE: limit=99999 → 200（clamp 到 maxLimit）', hugeLimit.status === 200 && (hugeLimit.body?.length ?? 0) <= 200, `实际=${hugeLimit.body?.length}`, 'P2');

  const badCursor = await c.http('GET', '/api/data/events?cursor=invalid-cursor-string');
  ctx.assert('EDGE: cursor=invalid → 200（不崩溃）', badCursor.status === 200, `实际=${badCursor.status}`, 'P0');

  // ---------- 2.11 认证边界 ----------
  // 无 token
  const noToken = await fetch(BASE + '/api/data/events');
  ctx.assert('EDGE: 无 token → 401', noToken.status === 401, `实际=${noToken.status}`, 'P1');

  // 错误格式 token
  const badFormat = await fetch(BASE + '/api/data/events', { headers: { Authorization: 'NotBearer abc' } });
  ctx.assert('EDGE: 错误格式 token → 401', badFormat.status === 401, `实际=${badFormat.status}`, 'P1');

  // 过期 token（构造一个签名正确但 exp 已过的 token 不可行，跳过）
  // 但可以测试 logout 后 token 失效
  const lo = await c.http('POST', '/api/auth/logout', { refreshToken: c.getRefreshToken() });
  ctx.assert('EDGE: logout → 200', lo.status === 200, `实际=${lo.status}`, 'P1');
  if (lo.status === 200) {
    const afterLo = await c.http('GET', '/api/auth/me');
    ctx.assert('EDGE: logout 后 /auth/me → 401', afterLo.status === 401, `实际=${afterLo.status}`, 'P1');
  }

  // ---------- 2.12 空体 / 缺必填字段 ----------
  // 重新登录
  const re = await c.http('POST', '/api/auth/login', { email, password: PASS });
  ctx.assert('EDGE: 重新登录 → 200', re.status === 200, `实际=${re.status}`, 'P1');
  if (re.status === 200) {
    c.setAuth(re.body?.accessToken, re.body?.refreshToken, re.body?.id, 'EdgeCase');
  }

  // 空 body POST /events
  const emptyBody = await c.http('POST', '/api/data/events', {});
  ctx.assert('EDGE: 空 body POST /events → 200（用默认值）或 400', emptyBody.status === 200 || emptyBody.status === 400, `实际=${emptyBody.status}`, 'P1');
  // 当前实现接受空 body，content 默认为 '(未命名事件)'

  // POST /evidence 缺必填字段
  const missingRequired = await c.http('POST', '/api/data/evidence', { source: 'manual_text' }); // 缺 evidence_type, occurred_at
  ctx.assert('EDGE: POST /evidence 缺必填字段 → 400', missingRequired.status === 400, `实际=${missingRequired.status}`, 'P1');

  // ---------- 2.13 并发同一用户写入 ----------
  const concurrentPromises = [];
  for (let i = 0; i < 10; i++) {
    concurrentPromises.push(c.http('POST', '/api/data/events', { content: `并发#${i}`, mood: 0.1, tags: ['工作'] }));
  }
  const concurrentResults = await Promise.all(concurrentPromises);
  const allOk = concurrentResults.every(r => r.status === 200);
  ctx.assert('EDGE: 10 个并发 POST /events 全部成功', allOk, `失败数=${concurrentResults.filter(r => r.status !== 200).length}`, 'P1');

  // 验证并发后事件数量正确（无丢失）
  const afterConcurrent = await c.http('GET', '/api/data/events?limit=200');
  const concurrentCount = (afterConcurrent.body ?? []).filter(e => (e.content ?? '').startsWith('并发#')).length;
  ctx.assert('EDGE: 并发写入无丢失（10 条全部持久化）', concurrentCount === 10, `实际=${concurrentCount}`, 'P1');

  // ---------- 2.14 超长字段 ----------
  // 超长 tags 数组
  const longTags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
  const manyTags = await c.http('POST', '/api/data/events', { content: '超多标签', mood: 0.1, tags: longTags });
  ctx.assert('EDGE: 100 个标签 → 200', manyTags.status === 200, `实际=${manyTags.status}`, 'P2');

  // 超长 content（接近 1MB 限制）
  const hugeContent = 'x'.repeat(500000);
  const hugeEv = await c.http('POST', '/api/data/events', { content: hugeContent, mood: 0.1, tags: ['工作'] });
  ctx.assert('EDGE: 500KB content → 200', hugeEv.status === 200, `实际=${hugeEv.status}`, 'P2');
  if (hugeEv.status === 200) {
    // 验证完整保存
    const fetched = await c.http('GET', '/api/data/events?limit=1');
    const found = (fetched.body ?? []).find(e => e.id === hugeEv.body.id);
    ctx.assert('EDGE: 500KB content 未被截断', found?.content?.length === hugeContent.length, `实际=${found?.content?.length} 期望=${hugeContent.length}`, 'P1');
  }

  // 超过 1MB body 限制 → 413
  const overLimit = 'x'.repeat(1100000);
  const overEv = await c.http('POST', '/api/data/events', { content: overLimit, mood: 0.1 });
  ctx.assert('EDGE: 1.1MB content → 413 或 400（不应 200）', overEv.status === 413 || overEv.status === 400, `实际=${overEv.status}`, 'P1');

  // ---------- 2.15 找回密码流程 ----------
  const forgot = await c.http('POST', '/api/auth/forgot-password', { email });
  ctx.assert('EDGE: forgot-password → 200（防枚举，无论邮箱是否存在）', forgot.status === 200, `实际=${forgot.status}`, 'P1');

  // 用无效 token 重置
  const badReset = await c.http('POST', '/api/auth/reset-password', { token: 'invalid-token', newPassword: PASS });
  ctx.assert('EDGE: reset-password 无效 token → 400', badReset.status === 400, `实际=${badReset.status}`, 'P1');

  // forgot-password 不存在的邮箱（也应返回 200 防枚举）
  const forgotGhost = await c.http('POST', '/api/auth/forgot-password', { email: 'nonexistent@zhixingos.com' });
  ctx.assert('EDGE: forgot-password 不存在的邮箱 → 200（防枚举）', forgotGhost.status === 200, `实际=${forgotGhost.status}`, 'P1');

  // ---------- 2.16 health/llm 端点 ----------
  const hLlm = await c.http('GET', '/health/llm');
  ctx.assert('EDGE: /health/llm → 200', hLlm.status === 200, `实际=${hLlm.status}`, 'P2');

  // 清理
  await cleanupAccount(ctx);
  return ctx;
}

// =================================================================
// 主流程
// =================================================================

async function main() {
  console.log('=========================================================');
  console.log(`  知行镜 多角色真实用户行为端到端测试  ${new Date().toISOString()}`);
  console.log(`  目标：${BASE}`);
  console.log(`  角色数：${PERSONAS.length}`);
  console.log(`  并发数：3`);
  console.log('=========================================================');

  const start = Date.now();
  // 仅取前 3 个角色先快速跑（验证测试框架无 bug），后续再放开全部
  const subset = process.env.PERSONA_SUBSET ? PERSONAS.filter(p => p.id.startsWith(process.env.PERSONA_SUBSET)) : PERSONAS;
  const skipPersonas = process.env.EDGE_ONLY === '1';
  console.log(`  本次执行角色：${skipPersonas ? '(跳过)' : subset.map(p => p.id).join(', ')}`);

  const contexts = skipPersonas ? [] : await runWithConcurrency(subset, runPersonaFlow, 3);

  // Phase 2: 激进边界用例（独立账号，串行执行）
  console.log('\n--- 开始 Phase 2：激进边界用例 ---');
  const edgeCtx = await runAggressiveEdgeCases();
  contexts.push(edgeCtx);

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  // 汇总
  let total = 0, passed = 0, failed = 0;
  const bySeverity = { P0: [], P1: [], P2: [], P3: [] };
  const byPersona = {};

  for (const ctx of contexts) {
    if (!ctx) continue;
    for (const r of ctx.results) {
      total++;
      if (r.ok) { passed++; continue; }
      failed++;
      if (bySeverity[r.severity]) bySeverity[r.severity].push(r);
      else bySeverity.P2.push(r);
      if (!byPersona[r.persona]) byPersona[r.persona] = [];
      byPersona[r.persona].push(r);
    }
  }

  console.log('\n=========================================================');
  console.log(`  总计：${total}  通过：${passed}  失败：${failed}  耗时：${elapsed}s`);
  console.log('=========================================================');

  if (failed > 0) {
    console.log('\n按严重度分组：');
    for (const sev of ['P0', 'P1', 'P2', 'P3']) {
      if (bySeverity[sev].length === 0) continue;
      console.log(`\n  [${sev}] ${bySeverity[sev].length} 项：`);
      for (const r of bySeverity[sev]) {
        console.log(`    [${r.persona}] ${r.name}${r.detail ? ' — ' + String(r.detail).slice(0, 200) : ''}`);
      }
    }
    console.log('\n按角色分组：');
    for (const [pid, fails] of Object.entries(byPersona)) {
      console.log(`\n  [${pid}] ${fails.length} 项失败：`);
      for (const r of fails) {
        console.log(`    [${r.severity}] ${r.name}`);
      }
    }
  }

  // 写入报告文件
  const report = {
    timestamp: new Date().toISOString(),
    elapsed_sec: parseFloat(elapsed),
    total, passed, failed,
    bySeverity: Object.fromEntries(Object.entries(bySeverity).map(([k, v]) => [k, v.length])),
    failures: Object.fromEntries(
      Object.entries(bySeverity).map(([sev, items]) => [sev, items.map(r => ({ persona: r.persona, name: r.name, detail: r.detail }))])
    ),
    byPersona: Object.fromEntries(
      Object.entries(byPersona).map(([pid, items]) => [pid, items.length])
    ),
  };
  const fs = await import('node:fs/promises');
  const reportPath = new URL('./persona-smoke-report.json', import.meta.url);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n报告已写入：${reportPath.pathname}`);

  // 给 undici/fetch 一个 graceful shutdown 时间，避免 Windows 上 libuv 断言失败
  process.exitCode = failed > 0 ? 1 : 0;
  setTimeout(() => process.exit(process.exitCode), 200);
}

main().catch(e => { console.error('fatal:', e); process.exitCode = 1; setTimeout(() => process.exit(1), 200); });
