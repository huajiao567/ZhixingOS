import type {
  DailySignals,
  DailyState,
  DiaryFeatures,
  PersonalBaseline,
} from '../types/avatar';
import { clamp, inverseLerp, ratioToBaseline, round } from './math';

const LEXICONS = {
  positive: ['开心', '满足', '完成', '进展', '顺利', '喜欢', '有趣', '期待', '平静', '充实', '感谢'],
  negative: ['难过', '低落', '失望', '烦', '痛苦', '糟糕', '后悔', '无聊', '空虚'],
  stress: ['压力', '焦虑', '紧张', '赶', '来不及', '堆积', '冲突', '担心', '害怕', '失控'],
  fatigue: ['累', '疲惫', '困', '熬夜', '没睡好', '乏力', '休息', '头疼'],
  meaning: ['值得', '意义', '帮助', '创造', '长期', '成长', '贡献', '重要', '想成为', '使命'],
  focus: ['专注', '推进', '完成', '写完', '学会', '练习', '作品', '里程碑', '深度工作'],
  social: ['朋友', '家人', '同事', '交流', '陪伴', '见面', '合作', '关系', '沟通'],
} as const;

function countMatches(text: string, words: readonly string[]): number {
  return words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
}

export function analyzeDiary(text: string): DiaryFeatures {
  const normalized = text.trim();
  if (!normalized) {
    return {
      valence: 0.5,
      stress: 0.35,
      fatigue: 0.35,
      meaning: 0.5,
      focus: 0.5,
      sociality: 0.5,
      evidenceCount: 0,
    };
  }

  const positive = countMatches(normalized, LEXICONS.positive);
  const negative = countMatches(normalized, LEXICONS.negative);
  const stress = countMatches(normalized, LEXICONS.stress);
  const fatigue = countMatches(normalized, LEXICONS.fatigue);
  const meaning = countMatches(normalized, LEXICONS.meaning);
  const focus = countMatches(normalized, LEXICONS.focus);
  const social = countMatches(normalized, LEXICONS.social);
  const total = positive + negative + stress + fatigue + meaning + focus + social;

  return {
    valence: clamp(0.5 + positive * 0.11 - negative * 0.13 - stress * 0.04),
    stress: clamp(0.28 + stress * 0.16 + negative * 0.05),
    fatigue: clamp(0.25 + fatigue * 0.17),
    meaning: clamp(0.45 + meaning * 0.13),
    focus: clamp(0.42 + focus * 0.12 - stress * 0.03),
    sociality: clamp(0.45 + social * 0.11),
    evidenceCount: total,
  };
}

export function inferDailyState(
  signals: DailySignals,
  baseline: PersonalBaseline,
): DailyState {
  const diary = analyzeDiary(signals.diary);
  const sleepAmount = clamp(ratioToBaseline(signals.sleepHours, baseline.sleepHours) / 1.15);
  const sleepQuality = clamp(signals.sleepQuality);
  const hrv = clamp(ratioToBaseline(signals.hrvRelative, baseline.hrvRelative) / 1.2);
  const steps = clamp(ratioToBaseline(signals.steps, baseline.steps) / 1.35);
  const workout = clamp(ratioToBaseline(signals.workoutMinutes, baseline.workoutMinutes) / 1.35);
  const focusMinutes = clamp(ratioToBaseline(signals.focusMinutes, baseline.focusMinutes) / 1.3);
  const completion = clamp(signals.taskCompletion);
  const momentum = clamp(signals.projectMomentum);
  const load = clamp(signals.scheduleLoad);

  const energy = clamp(
    0.30 * sleepAmount +
      0.25 * sleepQuality +
      0.18 * hrv +
      0.12 * steps +
      0.08 * workout +
      0.07 * (1 - diary.fatigue),
  );

  const stress = clamp(
    0.34 * load +
      0.28 * diary.stress +
      0.16 * (1 - sleepQuality) +
      0.12 * (1 - completion) +
      0.10 * (1 - hrv),
  );

  const mood = clamp(
    0.46 * diary.valence +
      0.17 * energy +
      0.15 * completion +
      0.12 * momentum +
      0.10 * (1 - stress),
  );

  const focus = clamp(
    0.34 * focusMinutes +
      0.25 * diary.focus +
      0.19 * completion +
      0.12 * energy +
      0.10 * (1 - load * 0.8),
  );

  const physicality = clamp(0.48 * steps + 0.38 * workout + 0.14 * energy);
  const selfcare = clamp(0.42 * sleepQuality + 0.24 * sleepAmount + 0.20 * workout + 0.14 * (1 - load));
  const meaningMomentum = clamp(0.36 * diary.meaning + 0.27 * momentum + 0.20 * focus + 0.17 * completion);
  const sociality = clamp(0.66 * diary.sociality + 0.18 * mood + 0.16 * (1 - stress));
  const arousal = clamp(0.45 * energy + 0.26 * stress + 0.18 * physicality + 0.11 * load);

  const diaryHasEvidence = diary.evidenceCount > 0;
  const availableSources = [
    signals.sleepHours > 0,
    signals.hrvRelative > 0,
    signals.steps > 0,
    signals.focusMinutes > 0,
    signals.taskCompletion > 0,
    signals.diary.trim().length > 0,
    diaryHasEvidence,
  ].filter(Boolean).length;

  return {
    energy: round(energy),
    mood: round(mood),
    stress: round(stress),
    arousal: round(arousal),
    sociality: round(sociality),
    focus: round(focus),
    selfcare: round(selfcare),
    physicality: round(physicality),
    meaningMomentum: round(meaningMomentum),
    evidenceCoverage: round(inverseLerp(1, 6, availableSources)),
  };
}
