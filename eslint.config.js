// Expo SDK 57 官方 lint 预设（eslint-config-expo flat config），覆盖 TS/React/RN 规则。
// 仅供工程约束，不参与构建；新增规则应先以 warning 观察，再收紧为 error。
const expoFlat = require('eslint-config-expo/flat');

module.exports = [
  ...expoFlat,
  {
    ignores: [
      'dist/**',
      'backend/**',
      'node_modules/**',
      'e2e/html-report/**',
      '开发文档/**',
      '.workbuddy/**',
      '.toolchains/**',
    ],
  },
  {
    rules: {
      // React Native 的样式属性（position 等）被 DOM 规则误判为未知 HTML 属性；
      // 真实的属性拼写问题由 TypeScript 收口。
      'react/no-unknown-property': 'off',
      // eslint-plugin-react-hooks v7 Compiler 时代新规则：现有 3D/动画代码中
      // 有数十处既定模式（动画循环改 ref、渲染中定义子组件等），先降为 warning
      // 观察，待专项重构后逐条收紧为 error。
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
];
