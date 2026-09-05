/**
 * 知行镜 ZhixingOS · 可选原生模块的类型声明（Task 26.2 / 26.3 / 26.4）
 *
 * 这些原生模块需要 Development Build 才能使用，在 Expo Go / Web 端通过动态导入 +
 * try/catch 优雅降级。声明为 `any` 类型避免阻塞 tsc；运行时若包不存在，动态 import
 * 会抛错并被调用方 catch 后返回空数组（spec A21.5：拒绝后核心 App 仍可用）。
 *
 * 不引入死代码：本文件仅声明类型，不引入实际依赖。
 */

declare module 'react-native-health' {
  /** iOS HealthKit 桥接包（社区包，非 Expo SDK 内置） */
  const Health: any;
  export default Health;
}

declare module 'react-native-health-connect' {
  /** Android Health Connect 桥接包（社区包，非 Expo SDK 内置） */
  const HealthConnect: any;
  export default HealthConnect;
  export const getHealthConnectApiStatus: () => Promise<string>;
  export const requestPermission: (types: { accessType: string; dataType: string }[]) => Promise<boolean>;
  export const readRecords: (dataType: string, options: { timeRangeFilter: { operator: string; startTime: string; endTime: string } }) => Promise<any[]>;
}
