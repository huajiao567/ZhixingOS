import assert from 'node:assert/strict';
import test from 'node:test';
import { inferJournalDomain, journalSourceLabel, journalTitle } from '../src/ai-native/intake/journalRecord';

test('journal domain inference favors concrete life domains', () => {
  assert.equal(inferJournalDomain('昨晚只睡了4小时，今天很累'), '身体');
  assert.equal(inferJournalDomain('今天继续修改论文并阅读三篇文献'), '学习');
  assert.equal(inferJournalDomain('晚上和父母一起吃饭'), '身体');
  assert.equal(inferJournalDomain('项目会议确定了下一轮开发任务'), '工作');
  assert.equal(inferJournalDomain('周末散步放松了一会儿'), '休息');
});

test('journal source labels stay explicit', () => {
  assert.equal(journalSourceLabel('text-diary'), '文字');
  assert.equal(journalSourceLabel('photo-note'), '照片');
  assert.equal(journalSourceLabel('voice-note'), '语音');
  assert.equal(journalSourceLabel('avatar-editor'), '孪生');
  assert.equal(journalSourceLabel('avatar-editor:photo:local:abc123'), '孪生');
  assert.equal(journalSourceLabel('external'), '记录');
});

test('journal titles are compact and deterministic', () => {
  assert.equal(journalTitle('  今天   很平静  ', '记录'), '记录：今天 很平静');
  assert.ok(journalTitle('这是一个非常非常长的记录内容用于测试标题截断').endsWith('…'));
});
