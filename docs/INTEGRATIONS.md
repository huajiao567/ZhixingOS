# 生活数据接入与数字孪生适应

## 统一数据流

```text
系统/设备/导入文件
  -> LifeDataConnector（可用性、授权、游标、撤回、清空）
  -> LifeSignalObservation（单位、时间、置信、确认、来源）
  -> 本地聚合与证据门
  -> AvatarAdaptiveAppearance（原因、到期、撤回）
  -> VRM 临时材质/表情/骨骼层
```

接口位于 `src/ai-native/connectors`，推导器位于 `src/mirror3d/avatar/v2/adaptiveAppearance.ts`。原生实现缺失时必须返回明确的不可用或需要设置状态，禁止注入演示数据冒充同步成功。

## 接入矩阵

| 数据源 | 推荐路径 | 当前仓库 | 外部前置 |
|---|---|---|---|
| 小米手环 | Mi Fitness → Health Connect → 知行镜 | 契约、权限、标准化与孪生处理已完成；原生适配待实现 | 支持该同步路径的型号/地区/应用；Android 9-13 另装 Health Connect |
| 小米历史数据 | 小米账号隐私页导出 → 用户显式导入 | 导入契约已保留；解析器待实现 | 用户自行导出，禁止索取账号密码 |
| Android 手机使用 | `UsageStatsManager` → 按日聚合 | 契约与权限分类已完成；原生模块待实现 | 用户在系统设置手动授权“使用情况访问权限” |
| iOS 手机使用 | FamilyControls / DeviceActivity | 契约已保留；entitlement 适配待实现 | Apple entitlement 与用户生物识别授权 |
| 电脑使用 | ActivityWatch/桌面伴侣 → 本地聚合桥 | 契约已完成；桌面伴侣待实现 | 用户在电脑安装并明确配对；默认不传标题/URL |
| 正餐照片 | 本机图像候选 → 用户确认份量 | 候选/确认协议与孪生门已完成；食物模型待实现 | 相机权限；专用模型或后端营养库 |
| 零食/包装食品 | 条码 → Open Food Facts；标签 → 本地 OCR | 契约已完成；条码/OCR 适配待实现 | 社区数据需核对，用户确认实际份量 |

Google Fit API 已进入终止迁移路线，Android 新接入应使用 Health Connect，不应新建 Google Fit 依赖。小米没有在本项目中发现可直接用于普通消费者个人健康数据的稳定公开 API，因此优先使用 Mi Fitness 的系统健康同步或用户导出；这是基于当前公开资料的工程判断，不是厂商永久承诺。

## 自适应规则

- 熬夜/睡眠不足：近 72 小时摘要可提高眼下疲劳、降低动作节奏；到期自动回中性。
- 压力偏高：只提高肩颈、呼吸和表情的轻微紧绷，不输出“焦虑症”等诊断。
- 单次吃多：只形成 12 小时内的餐后饱足说明，不改变长期体型。
- 体型趋势：至少两条跨 14 天体重数据，或至少 10 个独立日期且跨度 13 天的能量平衡摘要；总横向变化限于 -4% 到 +6%。
- 候选、拒绝、低于 0.5 置信度、未来时间戳、超可信范围和超过窗口的数据不驱动外观。
- 用户可关闭全部适应、单独关闭体型趋势或清空效果；基础身份、手动捏脸和历史版本不被自动覆盖。

## 隐私默认值

- 健康样本优先在设备侧聚合，只同步必要的日摘要与不可逆来源引用。
- 手机/电脑原始事件、窗口标题和 URL 默认本地，不进入数字孪生或服务器。
- 饮食照片默认本机短暂处理；只有用户确认后的结构化候选进入趋势。
- USDA 等需要密钥的营养 API 必须由后端代理，密钥不得写入 `EXPO_PUBLIC_*`。
- 撤回采集权限与删除既有历史是两个独立操作；删除历史会触发依赖重算。

## 实现新连接器

1. 实现 `LifeDataConnector`，首先返回真实可用性与授权状态。
2. 只输出 `LifeSignalObservation`；为每个外部记录提供稳定 ID、时间、单位、置信度和不可逆 `sourceRef`。
3. 增量同步使用游标并保持幂等；单源失败不能覆盖其他来源。
4. 候选识别结果保持 `candidate`，直到用户确认。
5. 为权限拒绝、数据越界、重复、撤回、清空、离线和部分失败添加测试。

## 参考

- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/)
- [Android Health Connect](https://developer.android.com/health-and-fitness/health-connect/get-started)
- [Android UsageStatsManager](https://developer.android.com/reference/android/app/usage/UsageStatsManager)
- [ActivityWatch](https://github.com/ActivityWatch/activitywatch)
- [Open Food Facts API](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- [USDA FoodData Central API](https://fdc.nal.usda.gov/api-guide/)

