/**
 * 知行镜 ZhixingOS 种子数据推送服务
 *
 * - `seedDemoDataIfEmpty()`：向后兼容，推送默认的知识工作者种子（V4.3 之前的行为）。
 * - `seedDemoDataByIdentity(identity)`：V4.3 Task 18.7 新增，按身份推送对应种子，
 *   用于跨身份测试（学生 / 蓝领 / 平台劳动者 / 白领 / 自由职业者 / 知识工作者）。
 *
 * 设计原则：
 *  1. 单一数据源：所有种子在 App 端定义，后端不内置种子，避免数据漂移。
 *  2. 幂等：后端 `/api/data/*` 路由基于 Idempotency-Key / body.id 去重（见 backend/src/routes/data.ts）。
 *  3. 公平性：`withMood` 启发式只对事实层文本生效；身份种子的 userInterpretation 已显式归因，
 *     不会被启发式误判为「自律差」（见 seed-bluecollar.ts 的 T-夜班 设计注释）。
 */
import { api } from './api';
import {
  seedEvents, seedCommitments, seedHypotheses, seedExperiments,
  seedProjects, seedSkills, seedDirections,
} from '../data/seed';
import {
  seedUser_student, seedCommitments_student, seedEvents_student, seedHypotheses_student,
  seedExperiments_student, seedProjects_student, seedSkills_student, seedDirections_student,
} from '../data/seed-student';
import {
  seedUser_bluecollar, seedCommitments_bluecollar, seedEvents_bluecollar, seedHypotheses_bluecollar,
  seedExperiments_bluecollar, seedProjects_bluecollar, seedSkills_bluecollar, seedDirections_bluecollar,
} from '../data/seed-bluecollar';
import {
  seedUser_platformWorker, seedCommitments_platformWorker, seedEvents_platformWorker, seedHypotheses_platformWorker,
  seedExperiments_platformWorker, seedProjects_platformWorker, seedSkills_platformWorker, seedDirections_platformWorker,
} from '../data/seed-platform-worker';
import {
  seedUser_whitecollar, seedCommitments_whitecollar, seedEvents_whitecollar, seedHypotheses_whitecollar,
  seedExperiments_whitecollar, seedProjects_whitecollar, seedSkills_whitecollar, seedDirections_whitecollar,
} from '../data/seed-whitecollar';
import {
  seedUser_freelancer, seedCommitments_freelancer, seedEvents_freelancer, seedHypotheses_freelancer,
  seedExperiments_freelancer, seedProjects_freelancer, seedSkills_freelancer, seedDirections_freelancer,
} from '../data/seed-freelancer';
import type { LifeEvent, Commitment, Hypothesis, Experiment, Project, SkillTrack, MeaningDirection } from '../types/models';

/** V4.3 Task 18.7：支持的 6 类身份（含默认的知识工作者） */
export type SeedIdentity =
  | 'student'
  | 'bluecollar'
  | 'platform-worker'
  | 'whitecollar'
  | 'freelancer'
  | 'knowledge-worker';

/** 单身份种子包：聚合 7 类领域对象 + 用户档案 */
interface SeedBundle {
  user: import('../types/models').UserProfile;
  events: LifeEvent[];
  commitments: Commitment[];
  hypotheses: Hypothesis[];
  experiments: Experiment[];
  projects: Project[];
  skills: SkillTrack[];
  directions: MeaningDirection[];
}

// 为种子事件补充情绪信号（供六位状态引擎），基于内容启发式。
// 公平性注意：身份种子的 userInterpretation 已显式归因（如蓝领夜班疲劳→外部排班约束），
// 此启发式只读取文本特征词，不会把「外部约束」误判为「自律差」——L4 由 tags+commitments 决定，不由 mood 决定。
function withMood(ev: LifeEvent): LifeEvent {
  const text = `${ev.title} ${ev.detail ?? ''} ${ev.userInterpretation ?? ''}`;
  if (/疲惫|累|推迟|冲突|加班|失眠|低落|后悔/.test(text)) return { ...ev, mood: -0.35 };
  if (/完成|成功|陪|投入|满足|启动成功|达成/.test(text)) return { ...ev, mood: 0.5 };
  if (/写作|创作/.test(text)) return { ...ev, mood: 0.2 };
  return { ...ev, mood: 0.05 };
}

/** 按身份选择种子包。knowledge-worker 复用历史 seed.ts（默认用户「一舟」）。 */
function getBundle(identity: SeedIdentity): SeedBundle {
  switch (identity) {
    case 'student':
      return {
        user: seedUser_student,
        events: seedEvents_student,
        commitments: seedCommitments_student,
        hypotheses: seedHypotheses_student,
        experiments: seedExperiments_student,
        projects: seedProjects_student,
        skills: seedSkills_student,
        directions: seedDirections_student,
      };
    case 'bluecollar':
      return {
        user: seedUser_bluecollar,
        events: seedEvents_bluecollar,
        commitments: seedCommitments_bluecollar,
        hypotheses: seedHypotheses_bluecollar,
        experiments: seedExperiments_bluecollar,
        projects: seedProjects_bluecollar,
        skills: seedSkills_bluecollar,
        directions: seedDirections_bluecollar,
      };
    case 'platform-worker':
      return {
        user: seedUser_platformWorker,
        events: seedEvents_platformWorker,
        commitments: seedCommitments_platformWorker,
        hypotheses: seedHypotheses_platformWorker,
        experiments: seedExperiments_platformWorker,
        projects: seedProjects_platformWorker,
        skills: seedSkills_platformWorker,
        directions: seedDirections_platformWorker,
      };
    case 'whitecollar':
      return {
        user: seedUser_whitecollar,
        events: seedEvents_whitecollar,
        commitments: seedCommitments_whitecollar,
        hypotheses: seedHypotheses_whitecollar,
        experiments: seedExperiments_whitecollar,
        projects: seedProjects_whitecollar,
        skills: seedSkills_whitecollar,
        directions: seedDirections_whitecollar,
      };
    case 'freelancer':
      return {
        user: seedUser_freelancer,
        events: seedEvents_freelancer,
        commitments: seedCommitments_freelancer,
        hypotheses: seedHypotheses_freelancer,
        experiments: seedExperiments_freelancer,
        projects: seedProjects_freelancer,
        skills: seedSkills_freelancer,
        directions: seedDirections_freelancer,
      };
    case 'knowledge-worker':
    default:
      // knowledge-worker 复用 seed.ts（历史默认用户「一舟」）。
      // seed.ts 未导出 seedUser，保持向后兼容：不推送 user 档案，仅推送 7 类领域对象。
      return {
        user: {
          name: '一舟', lifeStage: '成年人',
          constraints: ['季度冲刺期工作强度大', '周末需陪伴家人', '晚间 23 点后精力明显下降'],
          onboarded: true, silentMode: false, proactivity: 'P1', secretaryLevel: 'L2', weeksOfData: 6,
        },
        events: seedEvents,
        commitments: seedCommitments,
        hypotheses: seedHypotheses,
        experiments: seedExperiments,
        projects: seedProjects,
        skills: seedSkills,
        directions: seedDirections,
      };
  }
}

/** 推送一个种子包到后端。被 `seedDemoDataIfEmpty` 与 `seedDemoDataByIdentity` 复用。 */
async function pushBundle(bundle: SeedBundle): Promise<boolean> {
  try {
    // 事件（含 mood 启发式）
    for (const ev of bundle.events) {
      await api.post('/api/data/events', withMood(ev));
    }
    // 承诺
    for (const c of bundle.commitments) {
      await api.post('/api/data/commitments', c);
    }
    // 假设
    for (const h of bundle.hypotheses) {
      await api.post('/api/data/hypotheses', h);
    }
    // 实验
    for (const e of bundle.experiments) {
      await api.post('/api/data/experiments', e);
    }
    // 项目
    for (const p of bundle.projects) {
      await api.post('/api/data/projects', p);
    }
    // 技能
    for (const s of bundle.skills) {
      await api.post('/api/data/skills', s);
    }
    // 意义方向
    for (const m of bundle.directions) {
      await api.post('/api/data/meanings', m);
    }
    return true;
  } catch (e) {
    console.warn('种子推送失败:', e);
    return false;
  }
}

/**
 * 演示账号首次登录时，把 App 端丰富的种子数据推送到后端（单一数据源）。
 * 向后兼容：等价于 `seedDemoDataByIdentity('knowledge-worker')`。
 */
export async function seedDemoDataIfEmpty(): Promise<boolean> {
  return pushBundle(getBundle('knowledge-worker'));
}

/**
 * V4.3 Task 18.7：按身份推送对应种子，用于跨身份测试。
 *
 * @param identity 身份标识（学生 / 蓝领 / 平台劳动者 / 白领 / 自由职业者 / 知识工作者）
 * @returns 推送是否成功
 *
 * 公平性：蓝领种子（bluecollar）的夜班事件已显式归因到外部排班约束，
 * stateEngine.deriveState 计算时 L4（行动与能力）由 工作 tag + active commitments 保底为正向，
 * 不会被误判为「自律差」（T-夜班 测试，V4.3 §7.11 / 附录 AB）。
 */
export async function seedDemoDataByIdentity(identity: SeedIdentity): Promise<boolean> {
  return pushBundle(getBundle(identity));
}
