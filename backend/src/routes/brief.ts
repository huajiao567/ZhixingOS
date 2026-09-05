import { Router } from 'express';
import { getDb, audit, getPatternsByUser, getExperiencesByUser, getPersonalSkillsByUser } from '../db.js';
import {
  generateTodayBrief,
  generateWeeklyBrief,
  generateMonthlyBrief,
  normalizeHypothesisDoc,
  normalizeExperimentDoc,
} from '../services/brief.js';
import { deriveState } from '../services/stateEngine.js';
import { getIndexedEvents, getIndexedCommitments } from './data.js';
import { buildLlmContext } from '../services/llmContextBuilder.js';

export const briefRouter = Router();

function parse(s: string, f: unknown) { try { return JSON.parse(s); } catch { return f; } }

briefRouter.get('/today', async (req, res) => {
  const userId = (req as any).userId;
  const events = getIndexedEvents(userId);
  const commitments = getIndexedCommitments(userId);
  const state = deriveState(events, commitments);
  const hypDocs = getDb().prepare('SELECT doc FROM hypotheses WHERE user_id = ? LIMIT 8').all(userId) as any[];
  const expDocs = getDb().prepare('SELECT doc FROM experiments WHERE user_id = ? LIMIT 8').all(userId) as any[];
  const hypotheses = hypDocs.map((r) => normalizeHypothesisDoc(parse(r.doc, {})));
  const experiments = expDocs.map((r) => normalizeExperimentDoc(parse(r.doc, {})));
  // V4.3 Task 9.5：拉取模式/经验/方法供 R 轴裁剪
  const patterns = getPatternsByUser(userId, 20);
  const experiences = getExperiencesByUser(userId, 20);
  const personalSkills = getPersonalSkillsByUser(userId, 10);

  // 按服务契约（R/A/D/P）裁剪上下文
  const ctx = buildLlmContext(userId, {
    events, commitments, hypotheses, experiments,
    patterns, experiences, personalSkills,
  });

  try {
    const brief = await generateTodayBrief(
      { events, commitments, hypotheses, experiments, state, userId },
      ctx.systemPrompt,
    );
    audit(userId, 'brief.generate', {
      by: brief.generatedBy,
      contractR: ctx.contract.reflection_depth,
      includedCategories: ctx.includedCategories,
    });
    res.json({ ...brief, state });
  } catch (e: any) {
    res.status(500).json({ error: '简报生成失败', detail: e.message });
  }
});

// Task 4.6: 周镜 LLM 生成（V4.3 §2.2 / §A11）
briefRouter.get('/weekly', async (req, res) => {
  const userId = (req as any).userId;
  const events = getIndexedEvents(userId);
  const commitments = getIndexedCommitments(userId);
  const hypDocs = getDb().prepare('SELECT doc FROM hypotheses WHERE user_id = ? LIMIT 8').all(userId) as any[];
  const expDocs = getDb().prepare('SELECT doc FROM experiments WHERE user_id = ? LIMIT 8').all(userId) as any[];
  const hypotheses = hypDocs.map((r) => normalizeHypothesisDoc(parse(r.doc, {})));
  const experiments = expDocs.map((r) => normalizeExperimentDoc(parse(r.doc, {})));
  // V4.3 Task 9.5：拉取模式/经验/方法供 R 轴裁剪
  const patterns = getPatternsByUser(userId, 20);
  const experiences = getExperiencesByUser(userId, 20);
  const personalSkills = getPersonalSkillsByUser(userId, 10);

  // 按服务契约（R/A/D/P）裁剪上下文
  const ctx = buildLlmContext(userId, {
    events, commitments, hypotheses, experiments,
    patterns, experiences, personalSkills,
  });

  try {
    const brief = await generateWeeklyBrief(
      { events, commitments, hypotheses, experiments, userId },
      ctx.systemPrompt,
    );
    audit(userId, 'brief.weekly', {
      by: brief.generatedBy,
      contractR: ctx.contract.reflection_depth,
      includedCategories: ctx.includedCategories,
    });
    res.json(brief);
  } catch (e: any) {
    res.status(500).json({ error: '周镜生成失败', detail: e.message });
  }
});

// Task 4.6: 月镜 LLM 生成（V4.3 §2.2 / §A11）
briefRouter.get('/monthly', async (req, res) => {
  const userId = (req as any).userId;
  const events = getIndexedEvents(userId);
  const commitments = getIndexedCommitments(userId);
  const hypDocs = getDb().prepare('SELECT doc FROM hypotheses WHERE user_id = ? LIMIT 12').all(userId) as any[];
  const expDocs = getDb().prepare('SELECT doc FROM experiments WHERE user_id = ? LIMIT 12').all(userId) as any[];
  const hypotheses = hypDocs.map((r) => normalizeHypothesisDoc(parse(r.doc, {})));
  const experiments = expDocs.map((r) => normalizeExperimentDoc(parse(r.doc, {})));
  // V4.3 Task 9.5：拉取模式/经验/方法供 R 轴裁剪
  const patterns = getPatternsByUser(userId, 30);
  const experiences = getExperiencesByUser(userId, 30);
  const personalSkills = getPersonalSkillsByUser(userId, 15);

  // 按服务契约（R/A/D/P）裁剪上下文
  const ctx = buildLlmContext(userId, {
    events, commitments, hypotheses, experiments,
    patterns, experiences, personalSkills,
  });

  try {
    const brief = await generateMonthlyBrief(
      { events, commitments, hypotheses, experiments, userId },
      ctx.systemPrompt,
    );
    audit(userId, 'brief.monthly', {
      by: brief.generatedBy,
      contractR: ctx.contract.reflection_depth,
      includedCategories: ctx.includedCategories,
    });
    res.json(brief);
  } catch (e: any) {
    res.status(500).json({ error: '月镜生成失败', detail: e.message });
  }
});
