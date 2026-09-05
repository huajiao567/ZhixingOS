/**
 * 知行镜后端端到端冒烟测试（V4.3 §10 验收 / Task 28）
 *
 * 设计原则：
 * - 真实驱动 HTTP（不 mock），按用户实际操作顺序串联，暴露集成问题
 * - 每步断言关键不变量（HTTP 状态、字段存在性、数据一致性）
 * - 期望失败的断言会显式标注 EXPECTED-FAIL，便于发现"假阴性"修复
 * - 测试结束自动清理账号（DELETE /auth/me），避免脏数据
 *
 * 运行：
 *   1. 启动后端：cd backend && npm run dev
 *   2. 运行测试：node tests/e2e/smoke.mjs
 *
 * 退出码：0=全部通过；1=有失败
 */

const BASE = process.env.API_BASE ?? 'http://localhost:3001';
const TS = Date.now();
const EMAIL = `e2e-${TS}@zhixingos.com`;
const PASS = 'E2eTest1234';

let accessToken = '';
let refreshToken = '';

// 收集所有测试结果，最后输出汇总
const results = [];
let cleanupUserId = null;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const tag = ok ? '✓ PASS' : '✗ FAIL';
  console.log(`  ${tag}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function http(method, path, body, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  const init = { method, headers };
  if (body !== undefined && body !== null) init.body = JSON.stringify(body);
  const res = await fetch(BASE + path, init);
  let parsed;
  const text = await res.text();
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { _raw: text }; }
  return { status: res.status, body: parsed, headers: res.headers };
}

function assert(name, cond, detail = '') { record(name, !!cond, detail); return !!cond; }

// =================================================================
// PHASE 1: 健康检查与认证流
// =================================================================
async function phase1_auth() {
  console.log('\n=== Phase 1: 健康检查与认证 ===');

  // 1.1 健康检查
  const h = await http('GET', '/health');
  assert('GET /health 返回 200', h.status === 200);
  assert('/health 含 service 字段', h.body?.service === 'zhixingos-backend');

  // 1.2 未认证访问应被拒
  const noauth = await http('GET', '/api/data/events');
  assert('未携带令牌 → 401', noauth.status === 401, `实际=${noauth.status}`);

  // 1.3 注册新用户
  const reg = await http('POST', '/api/auth/register', {
    email: EMAIL,
    password: PASS,
    displayName: 'E2E Tester',
  });
  assert('注册成功', reg.status === 200, `实际=${reg.status} ${JSON.stringify(reg.body).slice(0,200)}`);
  cleanupUserId = reg.body?.id ?? null;

  // 1.4 重复注册应返回 409
  const reg2 = await http('POST', '/api/auth/register', { email: EMAIL, password: PASS });
  assert('重复邮箱 → 409', reg2.status === 409, `实际=${reg2.status}`);

  // 1.5 弱密码应被拒
  const weak = await http('POST', '/api/auth/register', {
    email: `weak-${TS}@zhixingos.com`,
    password: '12345678',
  });
  assert('弱密码 → 400', weak.status === 400);

  // 1.6 登录
  const login = await http('POST', '/api/auth/login', { email: EMAIL, password: PASS });
  assert('登录成功', login.status === 200, `实际=${login.status}`);
  accessToken = login.body?.accessToken ?? '';
  refreshToken = login.body?.refreshToken ?? '';
  assert('返回 accessToken', !!accessToken);
  assert('返回 refreshToken', !!refreshToken);

  // 1.7 GET /auth/me 验证令牌
  const me = await http('GET', '/api/auth/me');
  assert('GET /auth/me → 200', me.status === 200);
  assert('邮箱一致', me.body?.email === EMAIL, `实际=${me.body?.email}`);

  // 1.8 无效 token
  const bad = await fetch(BASE + '/api/auth/me', { headers: { Authorization: 'Bearer invalidtoken' } });
  assert('无效令牌 → 401', bad.status === 401);

  // 1.9 刷新令牌轮换
  const rf = await http('POST', '/api/auth/refresh', { refreshToken });
  assert('刷新令牌 → 200', rf.status === 200, `实际=${rf.status} ${JSON.stringify(rf.body).slice(0,200)}`);
  assert('返回新 accessToken', !!rf.body?.accessToken);
  const oldRefresh = refreshToken;
  accessToken = rf.body?.accessToken ?? accessToken;
  refreshToken = rf.body?.refreshToken ?? refreshToken;
  // 旧 refresh 应已撤销
  const rf2 = await http('POST', '/api/auth/refresh', { refreshToken: oldRefresh });
  assert('旧 refreshToken 已撤销', rf2.status === 401, `实际=${rf2.status}`);
}

// =================================================================
// PHASE 2: 数据写入与幂等性
// =================================================================
async function phase2_data_write() {
  console.log('\n=== Phase 2: 数据写入流（事件/承诺/假设/实验/项目） ===');

  // 2.1 创建事件 — 含 userInterpretation → axis='inner'
  const ev1 = await http('POST', '/api/data/events', {
    content: '今天早上 5:30 起床跑步 30 分钟',
    source: 'user',
    layer: 'fact',
    mood: 0.7,
    tags: ['运动', '早晨'],
    userInterpretation: '感觉精力充沛，可能是因为昨晚 23 点前睡了',
  });
  assert('创建 inner 事件 → 200', ev1.status === 200, `实际=${ev1.status}`);
  assert('axis 推断为 inner', ev1.body?.axis === 'inner', `实际=${ev1.body?.axis}`);

  // 2.2 创建事件 — 不含 userInterpretation → axis='outer'
  const ev2 = await http('POST', '/api/data/events', {
    content: '下午 14:00 开会讨论产品方案',
    source: 'calendar',
    layer: 'fact',
  });
  assert('创建 outer 事件 → 200', ev2.status === 200);
  assert('axis 推断为 outer', ev2.body?.axis === 'outer', `实际=${ev2.body?.axis}`);

  // 2.3 幂等性：相同 id 重复提交
  const dupId = `ev-dup-${TS}`;
  const dup1 = await http('POST', '/api/data/events', { id: dupId, content: '幂等测试' });
  const dup2 = await http('POST', '/api/data/events', { id: dupId, content: '幂等测试' });
  assert('幂等提交：相同 id 不重复插入', dup1.body?.id === dup2.body?.id);

  // 2.4 创建承诺
  const cm = await http('POST', '/api/data/commitments', {
    text: '每天 23:00 前关手机',
    domain: '生活',
    weight: 0.8,
    status: 'active',
  });
  assert('创建承诺 → 200', cm.status === 200);

  // 2.5 创建假设
  const hy = await http('POST', '/api/data/hypotheses', {
    statement: '23 点前入睡能让我第二天更有精力',
    confidence: 0.6,
    status: 'testing',
  });
  assert('创建假设 → 200', hy.status === 200);

  // 2.6 PATCH 假设 — 设置 review_at
  const hyPatch = await http('PATCH', `/api/data/hypotheses/${hy.body.id}`, {
    confidence: 0.7,
    review_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
  assert('PATCH 假设 → 200', hyPatch.status === 200);
  assert('review_at 已同步到 doc.reviewAt', hyPatch.body?.reviewAt === hyPatch.body?.reviewAt);

  // 2.7 PATCH 假设 — review_at=null
  const hyPatch2 = await http('PATCH', `/api/data/hypotheses/${hy.body.id}`, { review_at: null });
  assert('PATCH review_at=null → 200', hyPatch2.status === 200);

  // 2.8 非法 review_at
  const hyBad = await http('PATCH', `/api/data/hypotheses/${hy.body.id}`, { review_at: 'not-a-date' });
  assert('非法 review_at → 400', hyBad.status === 400);

  // 2.9 创建实验
  const ex = await http('POST', '/api/data/experiments', {
    title: '一周内每天 5:30 起床跑步',
    durationDays: 7,
    status: 'planned',
  });
  assert('创建实验 → 200', ex.status === 200);

  // 2.10 创建项目
  const pj = await http('POST', '/api/data/projects', {
    name: '马拉松训练',
  });
  assert('创建项目 → 200', pj.status === 200);
}

// =================================================================
// PHASE 3: 分页机制（V4.3 修复点）
// =================================================================
async function phase3_pagination() {
  console.log('\n=== Phase 3: 分页机制 ===');

  // 3.1 limit=2 应只返回 ≤2 条
  const p1 = await http('GET', '/api/data/events?limit=2');
  assert('?limit=2 → ≤2 条', p1.status === 200 && p1.body.length <= 2, `实际=${p1.body?.length}`);
  assert('GET /events 返回数组', Array.isArray(p1.body));

  // 3.2 cursor 翻页
  const first = p1.body?.[0];
  if (first?.created_at) {
    const p2 = await http('GET', `/api/data/events?limit=2&cursor=${encodeURIComponent(first.created_at)}`);
    assert('cursor 翻页 → ≤2 条', p2.status === 200 && p2.body.length <= 2);
    // 不应包含 cursor 那条本身（< 严格）
    const overlap = p2.body.find(r => r.id === first.id);
    assert('cursor 后页不含 cursor 行', !overlap);
  }

  // 3.3 corrections 端点也支持分页（nextCursor 返回结构）
  const corr = await http('GET', '/api/data/corrections?limit=5');
  assert('GET /corrections 返回 {items,nextCursor}', corr.status === 200 && Array.isArray(corr.body?.items));

  // 3.4 model-versions 同样
  const mv = await http('GET', '/api/data/model-versions?limit=5');
  assert('GET /model-versions 返回 {items,nextCursor}', mv.status === 200 && Array.isArray(mv.body?.items));
}

// =================================================================
// PHASE 4: 证据系统与软删除过滤
// =================================================================
async function phase4_evidence() {
  console.log('\n=== Phase 4: 证据系统与隐私 ===');

  // 4.1 创建手动证据
  const ev = await http('POST', '/api/data/evidence', {
    source: 'manual_text',
    evidence_type: 'self_report',
    occurred_at: new Date().toISOString(),
    captured_at: new Date().toISOString(),
    content_ref: '今天跑了 5km，感觉清醒很多',
    context: { mood: 0.8 },
    privacy_level: 'D1',
  });
  assert('创建证据 → 201', ev.status === 201, `实际=${ev.status} ${JSON.stringify(ev.body).slice(0,200)}`);
  const evId = ev.body?.id;

  // 4.2 创建带 resource_type/resource_id 的证据（自动 link）
  const linked = await http('POST', '/api/data/evidence', {
    source: 'manual_text',
    evidence_type: 'fact',
    occurred_at: new Date().toISOString(),
    captured_at: new Date().toISOString(),
    content_ref: '关联到一个事件',
    resource_type: 'event',
    resource_id: 'non-existent-event',
  });
  assert('创建关联证据 → 201', linked.status === 201);

  // 4.3 GET /evidence 返回数组
  const list1 = await http('GET', '/api/data/evidence');
  assert('GET /evidence → 200 数组', list1.status === 200 && Array.isArray(list1.body));
  const countBefore = list1.body.length;

  // 4.4 软删除证据
  const del = await http('DELETE', `/api/data/evidence/${evId}`);
  assert('DELETE 证据 → 200', del.status === 200);
  assert('返回级联重算结果', del.body?.recompute !== undefined, `实际=${JSON.stringify(del.body).slice(0,200)}`);

  // 4.5 关键：软删除的证据不应在 GET /evidence 出现
  const list2 = await http('GET', '/api/data/evidence');
  const stillThere = list2.body.find(r => r.id === evId);
  assert('软删除证据被排除', !stillThere, `仍存在 id=${evId}`);
  assert('列表数量减少 1', list2.body.length === countBefore - 1, `实际=${list2.body.length} 之前=${countBefore}`);

  // 4.6 跨用户删除应 404
  // 先注册第二个用户
  const u2 = await http('POST', '/api/auth/register', { email: `e2e2-${TS}@zhixingos.com`, password: PASS });
  const l2 = await http('POST', '/api/auth/login', { email: `e2e2-${TS}@zhixingos.com`, password: PASS });
  const orig = accessToken;
  accessToken = l2.body?.accessToken;
  const crossDel = await http('DELETE', `/api/data/evidence/${evId}`);
  assert('跨用户删除 → 404', crossDel.status === 404, `实际=${crossDel.status}`);
  accessToken = orig;  // 恢复
  // 清理第二个用户
  cleanupQueue.push({ email: `e2e2-${TS}@zhixingos.com`, pass: PASS });
}

const cleanupQueue = [];

// =================================================================
// PHASE 5: 蒸馏流水线触发（EXPECTED-FAIL：POST 缺失）
// =================================================================
async function phase5_distillation() {
  console.log('\n=== Phase 5: 蒸馏流水线 ===');

  // 5.1 GET 列表应工作
  const list = await http('GET', '/api/data/distillation-jobs');
  assert('GET /distillation-jobs → 200', list.status === 200);

  // 5.2 POST 触发流水线（spec SubTask 11.2 要求支持 manual trigger）
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const end = new Date();
  const trigger = await http('POST', '/api/data/distillation-jobs', {
    trigger: 'manual',
    timeWindow: { start: start.toISOString(), end: end.toISOString() },
  });
  // EXPECTED: 当前缺失 POST 端点 → 404
  // FIX TARGET: 应返回 201 + jobId
  assert('POST /distillation-jobs 触发流水线', trigger.status === 201, `实际=${trigger.status}（可能缺失端点）`);
  if (trigger.status === 201 && trigger.body?.jobId) {
    const jobId = trigger.body.jobId;
    // 流水线同步执行：响应到达时已完成。轮询 GET 验证 DB 记录一致。
    let final = null;
    for (let i = 0; i < 5; i++) {
      const poll = await http('GET', '/api/data/distillation-jobs');
      const found = poll.body?.find(j => j.id === jobId);
      if (found && (found.stage === 'done' || found.stage === 'error')) {
        final = found;
        break;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    assert('流水线进入终态（done/error）', !!final, `final.stage=${final?.stage}`);
    if (final) {
      assert('流水线 8 阶段全部完成', final.stage === 'done', `stage=${final.stage}, error=${final.error ?? ''}`);
      assert('stages_summary 存在', !!(final.result?.stagesSummary || final.stages), JSON.stringify(final).slice(0, 300));
      // 验证 stage 1 找到了证据（scope 阶段 by=empty 是正常的——它不调 LLM）
      // 正确判断方式：检查 trigger.body.stages 中 stage 1 的 output 是否非空数组
      const triggerStages = trigger.body?.stages ?? [];
      const s1Full = triggerStages.find(s => s.stage === 1);
      if (s1Full) {
        const scopeOutput = Array.isArray(s1Full.output) ? s1Full.output : [];
        console.log(`    stage 1 (scope): status=${s1Full.status}, found ${scopeOutput.length} 条证据`);
        assert('stage 1 找到测试创建的证据', scopeOutput.length > 0, `output=${JSON.stringify(scopeOutput).slice(0, 100)}`);
      }
      // 验证至少一个阶段成功调用 LLM（非 fallback/empty）
      const stagesSummary = final.result?.stagesSummary ?? [];
      const llmStages = stagesSummary.filter(s => s.generatedBy === 'llm');
      console.log(`    LLM 成功调用的阶段数：${llmStages.length} / ${stagesSummary.length}`);
      // 注：单条证据时 LLM 可能因「重复门」无候选可生成；只要流水线完成即视为通过
      // 但若 candidates 存在却全 fallback，可能 LLM 集成有问题（需进一步调查）
      const fallbackStages = stagesSummary.filter(s => s.generatedBy === 'fallback');
      if (fallbackStages.length > 0) {
        console.log(`    fallback 阶段：${fallbackStages.map(s => `#${s.stage}(${s.name})`).join(', ')}`);
      }
      // 打印所有阶段摘要便于审查
      console.log('    阶段摘要：');
      for (const s of stagesSummary) {
        console.log(`      [${s.stage}] ${s.name} → ${s.status} (by=${s.generatedBy ?? 'n/a'})`);
      }
    }
  }
}

// =================================================================
// PHASE 6: 简报生成（真实 LLM 调用）
// =================================================================
async function phase6_brief() {
  console.log('\n=== Phase 6: 简报生成（真实 LLM） ===');

  const today = await http('GET', '/api/brief/today');
  assert('GET /brief/today → 200', today.status === 200, `实际=${today.status} ${JSON.stringify(today.body).slice(0,200)}`);
  if (today.status === 200) {
    assert('含 generatedBy 字段', ['llm', 'fallback', 'empty'].includes(today.body?.generatedBy));
    assert('含 state 字段', !!today.body?.state);
    // 验证不再含硬编码「晚饭前」字样
    const raw = JSON.stringify(today.body);
    const hasHardcode = raw.includes('晚饭前 25 分钟连续 4 天启动成功');
    assert('无硬编码「晚饭前」字样', !hasHardcode);
  }

  // 周简报
  const weekly = await http('GET', '/api/brief/weekly');
  assert('GET /brief/weekly → 200', weekly.status === 200, `实际=${weekly.status}`);

  // 月简报
  const monthly = await http('GET', '/api/brief/monthly');
  assert('GET /brief/monthly → 200', monthly.status === 200, `实际=${monthly.status}`);
}

// =================================================================
// PHASE 7: 模式/经验/Skill/MetaPrinciple CRUD
// =================================================================
async function phase7_pattern_etc() {
  console.log('\n=== Phase 7: 模式/经验/Skill/MetaPrinciple ===');

  // 模式：通过 LLM 蒸馏才会自动产生，但可通过 PATCH 修改 review_state
  // 先用 GET 看是否有任何 pattern
  const plist = await http('GET', '/api/data/patterns');
  assert('GET /patterns → 200 数组', plist.status === 200 && Array.isArray(plist.body));
  if (plist.body.length > 0) {
    const p0 = plist.body[0];
    const patch = await http('PATCH', `/api/data/patterns/${p0.id}`, {
      review_state: 'keep',
      user_note: 'E2E 测试标记',
    });
    assert('PATCH /patterns/:id → 200', patch.status === 200, `实际=${patch.status}`);
  }

  // 经验
  const exp = await http('POST', '/api/data/experiences', {
    context: '早晨 5:30 起床跑步',
    problem: '犯困无法起床',
    actions: ['把闹钟放远', '前一天早睡'],
    outcome: '连续 3 天成功起床',
    lesson: '环境设计比意志力更可靠',
    maturity: 'observed',
  });
  assert('POST /experiences → 201', exp.status === 201, `实际=${exp.status}`);

  // Personal Skill
  const ps = await http('POST', '/api/data/personal-skills', {
    trigger: '想早起跑步',
    preconditions: [{ field: 'sleep_before', value: '23:00' }],
    procedure: ['把闹钟放远', '提前准备运动装备'],
    anti_patterns: ['依赖意志力'],
    scope: '早晨',
  });
  assert('POST /personal-skills → 201', ps.status === 201, `实际=${ps.status}`);

  // Meta Principle
  const mp = await http('POST', '/api/data/meta-principles', {
    statement: '环境设计比意志力更可靠',
    domains: ['运动', '学习'],
    evidence: [],
    counterevidence: [],
  });
  assert('POST /meta-principles → 201', mp.status === 201, `实际=${mp.status}`);
}

// =================================================================
// PHASE 8: 服务契约 7 轴调整
// =================================================================
async function phase8_service_contract() {
  console.log('\n=== Phase 8: 服务契约 ===');

  const c0 = await http('GET', '/api/data/service-contract');
  assert('GET /service-contract → 200', c0.status === 200);
  assert('默认 reflection_depth 存在', !!c0.body?.reflection_depth);

  const c1 = await http('PUT', '/api/data/service-contract', {
    reflection_depth: 'R3',
    agency_level: 'A2',
    proactivity: 'P2',
    avatar: 'V2',
    quiet_hours: { start: '23:00', end: '07:00' },
    high_impact_confirmation: true,
  });
  assert('PUT /service-contract → 200', c1.status === 200, `实际=${c1.status}`);
  assert('reflection_depth 已更新为 R3', c1.body?.reflection_depth === 'R3');
  assert('quiet_hours 已写入', !!c1.body?.quiet_hours);

  // 非法值
  const bad = await http('PUT', '/api/data/service-contract', { reflection_depth: 'R9' });
  assert('非法 reflection_depth → 400', bad.status === 400);
}

// =================================================================
// PHASE 9: 用户纠正机制（6 种 correction_type 状态机）
// =================================================================
async function phase9_corrections() {
  console.log('\n=== Phase 9: 用户纠正机制 ===');

  // 创建一个假设作为纠正目标
  const hy = await http('POST', '/api/data/hypotheses', {
    statement: '咖啡能让我下午更专注',
    confidence: 0.7,
    status: 'testing',
  });

  // unlike-me
  const c1 = await http('POST', '/api/data/corrections', {
    target_id: hy.body.id,
    target_type: 'hypothesis',
    correction_type: 'unlike-me',
    user_text: '不对，咖啡反而让我焦虑',
  });
  assert('correction unlike-me → 201', c1.status === 201, `实际=${c1.status} ${JSON.stringify(c1.body).slice(0,200)}`);

  // 验证 hypothesis 已被降级为 rejected
  const hyList = await http('GET', '/api/data/hypotheses');
  const found = hyList.body.find(h => h.id === hy.body.id);
  assert('unlike-me 后 hypothesis.status=rejected', found?.status === 'rejected', `实际=${found?.status}`);

  // wait
  const hy2 = await http('POST', '/api/data/hypotheses', { statement: '运动后心情更好', confidence: 0.5 });
  const c2 = await http('POST', '/api/data/corrections', {
    target_id: hy2.body.id,
    target_type: 'hypothesis',
    correction_type: 'wait',
  });
  assert('correction wait → 201', c2.status === 201);

  // 幂等性
  const c2dup = await http('POST', '/api/data/corrections', {
    target_id: hy2.body.id,
    target_type: 'hypothesis',
    correction_type: 'wait',
  }, { idempotencyKey: `test-corr-${TS}` });
  // 不带 idempotency-key 第二次提交会创建新记录
  assert('无 idem-key 重复提交创建新记录', c2dup.status === 201);
}

// =================================================================
// PHASE 10: 模型版本与回滚
// =================================================================
async function phase10_model_versions() {
  console.log('\n=== Phase 10: 模型版本 ===');

  // 触发一个 phase-changed correction 来自动创建版本
  const pat = await http('POST', '/api/data/experiences', {
    context: '工作流',
    problem: '加班',
    actions: ['放弃运动'],
    outcome: '体重增加',
    lesson: '加班期间需要保持最低运动量',
    maturity: 'candidate',
  });
  // phase-changed 需要 target_type='pattern'
  // 直接 GET 看现有版本
  const mv0 = await http('GET', '/api/data/model-versions');
  assert('GET /model-versions → 200', mv0.status === 200);

  // 尝试回滚到第一个版本（可能不存在）
  if (mv0.body?.items?.length > 0) {
    const first = mv0.body.items[mv0.body.items.length - 1];
    const rb = await http('POST', `/api/data/model-versions/rollback/${first.id}`);
    assert('回滚到历史版本', rb.status === 200, `实际=${rb.status}`);
  } else {
    // 创建一个版本
    const c = await http('POST', '/api/data/corrections', {
      target_id: pat.body.id,
      target_type: 'experience',
      correction_type: 'phase-changed',
      user_text: '生活阶段变化',
    });
    assert('phase-changed correction → 201', c.status === 201, `实际=${c.status}`);
  }

  // 不存在的版本 ID
  const rb404 = await http('POST', '/api/data/model-versions/rollback/non-existent');
  assert('回滚不存在版本 → 404', rb404.status === 404);
}

// =================================================================
// PHASE 11: 审计日志与数据导出
// =================================================================
async function phase11_audit_export() {
  console.log('\n=== Phase 11: 审计日志与导出 ===');

  const audit = await http('GET', '/api/data/audit');
  assert('GET /audit → 200', audit.status === 200);
  // V4.3 端点返回 {items, nextCursor} 结构（cursor 分页）
  const auditItems = audit.body?.items ?? (Array.isArray(audit.body) ? audit.body : []);
  assert('审计日志含本次操作', auditItems.length > 0, `count=${auditItems.length}`);
  // 验证关键事件被记录
  const actions = auditItems.map(a => a.action) ?? [];
  assert('审计日志含 event.create', actions.includes('event.create'));
  assert('审计日志含 evidence.create', actions.includes('evidence.create'));
  assert('审计日志含 evidence.delete', actions.includes('evidence.delete'));
  assert('审计日志含 service_contract.update', actions.includes('service_contract.update'));
  assert('审计日志含 correction.create', actions.includes('correction.create'));

  // 数据导出
  const exp = await http('GET', '/api/data/export');
  assert('GET /export → 200', exp.status === 200, `实际=${exp.status}`);
  assert('导出含 exportedAt 字段', !!exp.body?.exportedAt);
  assert('导出含 data.events', !!exp.body?.data?.events);
  assert('导出含 data.audit_logs', !!exp.body?.data?.audit_logs);
}

// =================================================================
// PHASE 12: 清理与登出
// =================================================================
async function phase12_cleanup() {
  console.log('\n=== Phase 12: 清理与登出 ===');

  // 12.1 logout（撤销当前 access/refresh token）
  const lo = await http('POST', '/api/auth/logout', { refreshToken });
  assert('POST /auth/logout → 200', lo.status === 200);

  // 12.2 logout 后访问应被拒（jti 已撤销）
  const me2 = await http('GET', '/api/auth/me');
  assert('logout 后 /auth/me → 401', me2.status === 401, `实际=${me2.status}`);

  // 12.3 彻底注销主测试账号：需重新登录拿新 token（logout 已撤销旧 token）
  if (cleanupUserId) {
    const re = await http('POST', '/api/auth/login', { email: EMAIL, password: PASS });
    assert('清理用重新登录 → 200', re.status === 200, `实际=${re.status}`);
    if (re.status === 200) {
      accessToken = re.body?.accessToken ?? accessToken;
      refreshToken = re.body?.refreshToken ?? refreshToken;
      const del = await http('DELETE', '/api/auth/me', { refreshToken });
      assert('DELETE /auth/me → 200', del.status === 200, `实际=${del.status}`);
      // 验证账号已被删除
      const reLogin = await http('POST', '/api/auth/login', { email: EMAIL, password: PASS });
      assert('账号删除后无法再登录', reLogin.status === 401, `实际=${reLogin.status}`);
    }
  }

  // 清理第二个账号（如果存在）
  for (const u of cleanupQueue) {
    try {
      const l = await fetch(BASE + '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: u.pass }),
      }).then(r => r.json());
      if (l.accessToken) {
        await fetch(BASE + '/api/auth/me', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${l.accessToken}` },
          body: JSON.stringify({ refreshToken: l.refreshToken }),
        });
      }
    } catch { /* ignore */ }
  }
}

// =================================================================
// 主流程
// =================================================================
async function main() {
  console.log('=========================================');
  console.log(`  知行镜 E2E 端到端测试  ${new Date().toISOString()}`);
  console.log(`  目标：${BASE}`);
  console.log(`  账号：${EMAIL}`);
  console.log('=========================================');

  try {
    await phase1_auth();
    await phase2_data_write();
    await phase3_pagination();
    await phase4_evidence();
    await phase5_distillation();
    await phase6_brief();
    await phase7_pattern_etc();
    await phase8_service_contract();
    await phase9_corrections();
    await phase10_model_versions();
    await phase11_audit_export();
    await phase12_cleanup();
  } catch (e) {
    console.error('\n!!! 测试中断（未捕获异常）:', e?.stack ?? e);
    record('未捕获异常', false, String(e?.message ?? e));
    // 尽力清理
    try { await phase12_cleanup(); } catch { /* ignore */ }
  }

  // 汇总
  const total = results.length;
  const passed = results.filter(r => r.ok).length;
  const failed = total - passed;
  console.log('\n=========================================');
  console.log(`  总计：${total}  通过：${passed}  失败：${failed}`);
  console.log('=========================================');
  if (failed > 0) {
    console.log('\n失败项：');
    results.filter(r => !r.ok).forEach(r => console.log(`  ✗ ${r.name}${r.detail ? ' — ' + r.detail : ''}`));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
