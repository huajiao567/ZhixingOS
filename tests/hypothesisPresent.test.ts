import assert from 'node:assert/strict';
import test from 'node:test';
import { presentHypothesisStatement } from '../src/services/hypothesisPresentation';

test('假设卡展示层：括号比例与半角引号转换，原文语义不变', () => {
  // 模型生成的括号比例 → 生活语言（% 紧连右括号时触发）
  assert.equal(
    presentHypothesisStatement('长期独处后精力恢复更慢（恢复速度 12%）'),
    '长期独处后精力恢复更慢（恢复速度相关证据仍需积累）',
  );
  // % 后还有其他内容时不触发改写
  assert.equal(
    presentHypothesisStatement('长期独处后精力恢复更慢（样本 12%，仍在积累）'),
    '长期独处后精力恢复更慢（样本 12%，仍在积累）',
  );
  // LLM 输出的半角引号 → 中文全角引号，成对且内容原样保留
  assert.equal(
    presentHypothesisStatement('当前更像"角色挤压"而非价值改变'),
    '当前更像「角色挤压」而非价值改变',
  );
  // 无引号/奇数引号保持原样，不做破坏性替换
  assert.equal(presentHypothesisStatement('普通陈述没有引号'), '普通陈述没有引号');
  assert.equal(presentHypothesisStatement('单个引号"不转换'), '单个引号"不转换');
  // 跨行内容不吞并（只允许引号内单行匹配）
  assert.equal(presentHypothesisStatement('第一"段\n落"第二'), '第一"段\n落"第二');
});
