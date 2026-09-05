/**
 * 假设卡的展示层文本变换：只影响界面呈现，原始 statement 仍完整保留在数据与审计层。
 * 放在纯逻辑模块以便单元测试（组件文件引入 react-native，无法在 node 测试中加载）。
 */

/**
 * 模型自动生成的括号比例改写为生活语言；LLM 输出的成对半角引号转为中文全角引号。
 */
export function presentHypothesisStatement(statement: string): string {
  return statement
    .replace(/（([^（）]*?)\s*\d+(?:\.\d+)?%）/g, '（$1相关证据仍需积累）')
    .replace(/"([^"\n]{1,40}?)"/g, '「$1」');
}
