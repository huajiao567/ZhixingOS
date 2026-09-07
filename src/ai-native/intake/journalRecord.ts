import type { Domain, Sensitivity } from '../../types/models';

export type JournalSourceRef = 'text-diary' | 'photo-note' | 'voice-note' | 'avatar-editor' | string;

export interface JournalInputOptions {
  sourceRef?: JournalSourceRef;
  domain?: Domain;
  sensitivity?: Sensitivity;
  titlePrefix?: string;
}

const rules: Array<{ domain: Domain; pattern: RegExp }> = [
  { domain: '身体', pattern: /(睡眠|睡觉|熬夜|疲劳|累|运动|跑步|健身|健康|身体|心率|步数|疼|痛|恢复|食物|饮食|吃饭|早餐|午餐|晚餐)/i },
  { domain: '学习', pattern: /(学习|课程|上课|考试|论文|文献|读书|阅读|复习|科研|research|paper|study)/i },
  { domain: '创造', pattern: /(创作|设计|写作|画画|绘图|作品|灵感|原型|界面|ui|ux)/i },
  { domain: '家庭', pattern: /(家庭|家人|父母|妈妈|爸爸|孩子|儿子|女儿|亲人)/i },
  { domain: '关系', pattern: /(朋友|同事关系|伴侣|恋人|关系|社交|交流|争吵|沟通)/i },
  { domain: '休息', pattern: /(休息|放松|散步|旅行|休假|周末|娱乐|电影|游戏)/i },
  { domain: '财务', pattern: /(财务|花钱|消费|收入|工资|预算|投资|股票|基金|money|finance)/i },
  { domain: '公共贡献', pattern: /(公益|志愿|社区|公共|捐赠|社会贡献)/i },
  { domain: '工作', pattern: /(工作|项目|会议|任务|实验|开发|代码|提交|客户|报告|方案|app|工程)/i },
];

export function inferJournalDomain(text: string): Domain {
  const normalized = text.trim();
  for (const rule of rules) {
    if (rule.pattern.test(normalized)) return rule.domain;
  }
  // 现有数据模型没有“其他/日常”域。为保持既有统计兼容，无法可靠分类时沿用工作域，
  // 但不把这一默认值解释成用户实际在工作。
  return '工作';
}

export function journalSourceLabel(sourceRef: string): '文字' | '照片' | '语音' | '孪生' | '记录' {
  if (sourceRef.startsWith('photo')) return '照片';
  if (sourceRef.startsWith('voice')) return '语音';
  if (sourceRef.startsWith('avatar')) return '孪生';
  if (sourceRef.startsWith('text')) return '文字';
  return '记录';
}

export function journalTitle(text: string, prefix = '日记'): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return `${prefix}：${clean.slice(0, 18)}${clean.length > 18 ? '…' : ''}`;
}
