/**
 * 六位状态（L1–L6）单一语义定义（App 端副本）。
 *
 * ⚠️ 与后端 backend/src/domain/positions.ts 逐字一致；后端为权威，
 * 状态 API（/api/data/state）的 `positions` 字段会回传该定义。
 * 前后端 / 数据库 / 提示词 / 界面只保留这一套语义。
 */
export type PositionKey = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

export interface PositionDef {
  key: PositionKey;
  label: string;
  innerSource: string;
  outerSource: string;
  desc: string;
}

export const POSITION_DEF: PositionDef[] = [
  {
    key: 'L1',
    label: '身体与能量',
    innerSource: '主观精力、睡眠感受、身体信号的自述',
    outerSource: '健康设备按日聚合的睡眠/步数摘要',
    desc: '能量、睡眠、趋近或回避的身体基础',
  },
  {
    key: 'L2',
    label: '情绪与需要',
    innerSource: '日记/语音中自述的情绪与未被满足的需要',
    outerSource: '行为中的情绪信号（如反复推迟、回避）',
    desc: '愉悦、焦虑、归属、自主等情绪侧面',
  },
  {
    key: 'L3',
    label: '关系与角色',
    innerSource: '对关系与角色的解释、价值自述',
    outerSource: '日历与任务中的关系投入（家庭时段、协作）',
    desc: '承诺、边界、支持、冲突的关系场域',
  },
  {
    key: 'L4',
    label: '行动与能力',
    innerSource: '对自身行动能力的主观评估',
    outerSource: '任务/工作完成率与承诺推进（含外部验收）',
    desc: '启动、坚持、技能、可见成果',
  },
  {
    key: 'L5',
    label: '意义与方向',
    innerSource: '意义相关的价值自述与方向确认',
    outerSource: '持续投入、真实作品、服务对象的反馈',
    desc: '意义感来自行动证据，而非用户填写的标签',
  },
  {
    key: 'L6',
    label: '环境与时机',
    innerSource: '对环境的判断与时机感知',
    outerSource: '日历密度、资源、阶段性外部约束',
    desc: '资源、制度、机会、阶段等外部条件',
  },
];

export const POSITION_META = POSITION_DEF;
export const POSITION_KEYS: PositionKey[] = POSITION_DEF.map((p) => p.key);

export function labelOf(k: string): string {
  return POSITION_DEF.find((p) => p.key === k)?.label ?? k;
}
