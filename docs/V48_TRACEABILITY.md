# 知镜行 Satori V4.8 需求追踪矩阵

当前真理之源：`开发文档/项目书-V4.8.docx`（2026-07-29）。本矩阵于 2026-08-22 深度升级后复核；不得用“文档已写”替代真实运行验证。

| REQ-ID | 项目书位置 | 用户价值 | 数据/契约 | 代码模块 | 验证 | 状态 |
|---|---|---|---|---|---|---|
| V48-AQ-01 | 附录 AQ：身份稳定 | 长期仍感知为同一个角色 | AvatarIdentity + append-only AvatarTimeline | `src/mirror3d/avatar/v2/avatarTypes.ts`、`src/mirror3d/store/useAvatarV2Store.ts` | avatarTimeline test | implemented |
| V48-AQ-05 | 附录 AQ：性能降级 | 3D 不可用时仍能记录、查看和导航 | ServiceContract.avatar V0-V3 | `src/screens/mirror/MirrorHome.tsx`、`src/mirror3d/avatar/AvatarCanvasFlagged.tsx`、`src/mirror3d/avatar/v2/AvatarModelView.tsx` | 四档映射测试、真实导航 E2E、Web export | implemented |
| V48-AQ-06 | 附录 AQ：历史真实性 | 不用今天的模型伪造过去 | PersonalModelVersion（响应边界解析 JSON）→ AvatarTimeline source link | `backend/src/routes/data.ts`、`src/mirror3d/avatar/avatarTimeline.ts`、`src/mirror3d/integration/Mirror3DPanel.tsx` | 排序、幂等、来源测试 | implemented |
| V48-AK-03 | 附录 AK：ready/empty/offline/error | 失败不被静默吞掉且主流程可用 | render failure state | `src/mirror3d/avatar/v2/AvatarModelView.tsx` | TypeScript、Web export | implemented |
| V48-AK-07 | 附录 AK：3D Feature Flag | 用户决定形象出现程度，V4.8 新用户默认动态 3D | ServiceContract.avatar（默认 V3，既有数据库中的选择不迁移覆盖） | `src/store/useServiceContractStore.ts`、`src/navigation/RootNavigator.tsx`、`backend/src/db.ts` | 登录加载 + 四档测试 | implemented |
| V48-AQ-02 | 附录 AQ：手机内完成 | 手机内拍照、捏脸、保存、校正 | Avatar identity/appearance | `src/mirror3d/screens/Mirror3DEditor.tsx`、`modules/zhixing-vision` | Android Release 编译 + 真机拟合验收 | implemented-code：Android 端侧 ML Kit 已接入；真机质量待验 |
| V48-AQ-08 | 附录 AQ：自拍隐私 | 原图默认删除，参数与人脸模板区分 | permissions + local processing | `photoFitting.ts`、`mediaCapture.ts`、开源审计 | 缓存副本清除 + 路径脱敏 + 生物特征发布阻断 + 真机测试 | implemented-code：同步只含不可逆凭据，只删 App cache 副本、不碰相册原件；真机文件检查待验 |
| V48-AI-01 | AI 原生运行时 | 任意输入进入同一对象与行动协议 | EventEnvelope + IntentGraph + LifeObject | `src/ai-native/intake/`、`intent/`、`objects/` | intent tests 6 类输入 | implemented |
| V48-AI-02 | Surface Compiler | 界面随当前对象和执行状态组织 | ContextSurface | `src/ai-native/surfaces/`、`src/components/workspace/` | mobile E2E | implemented |
| V48-AI-03 | Action Gateway | 权限、幂等、失败、回执与撤销真实可追溯 | ActionPlan + ActionReceipt | `src/ai-native/actions/`、`src/hooks/useSecretaryRuntime.ts` | gateway tests + mobile E2E | implemented |
| V48-AI-04 | Life Object | 待办、日程、课程、记录和草稿共享身份 | life_objects + optimistic version | `backend/src/routes/runtime.ts`、`backend/src/db.ts` | contract + HTTP integration | implemented |
| V48-CR-01 | 变化推演内核 | 建议有时位势应变中、风险、停止与复审 | PathCandidate | `src/ai-native/reasoning/changeKernel.ts` | change kernel tests | implemented-v1 |
| V48-TW-01 | 可养成孪生体 | 证据阈值、反例、纠正、回滚 | TwinProfile + version | `src/ai-native/twin/`、`src/store/useTwinProfileStore.ts` | twin tests + API contract | implemented-v1 |
| V48-MEM-01 | 长期记忆召回 | 秘书按问题使用私有、可追溯、可纠正的分层记忆 | L0-L3 MemoryAsset + RecallReceipt | `backend/src/services/memoryRetrieval.ts`、`llmContextBuilder.ts` | memory retrieval tests + backend typecheck | implemented-v1（本地词面+时效；向量/RRF 留作可替换后端） |
| V48-MD-01 | 真实多模态 | 照片/录音不再写占位文本 | 设备内二进制 + 不可逆引用凭据 + MIME + size/duration | `src/services/mediaCapture.ts`、`src/screens/mirror/MirrorHome.tsx` | SDK 57 native compile；真机待验 | partial：实现完成，真机待验 |
| V48-MD-02 | 5 章：底部记录栏“相机直接拍摄或选图” | 相机按钮一步进入拍摄，而非只有相册 | `takePhoto`（相机权限 + launchCameraAsync + 授权登记） | `src/services/mediaCapture.ts`、`src/screens/mirror/MirrorHome.tsx`（choosePhotoSource 选择器） | intent tests + typecheck；真机待验 | implemented（2026-08-23） |
| V48-MD-03 | 5 章：ZeroFriction Record Composer 首响契约 | 照片第一响应=接收+时间+隐私级别+可见去向+撤回，不立即解释人格 | `photo` EventEnvelope（id/sourceRef/consentId/checksum/privacy D1） | `src/ai-native/intake/eventEnvelope.ts`（createPhotoEnvelope）、`MirrorHome.handlePhoto`、`TodayScreen.handleQuickPhoto` | intentGraph tests（3 条照片用例） | implemented（2026-08-23） |
| V48-MD-04 | 10 章：照片+说明进入统一意图入口，且“照片默认只作为记录附件，不自动推断心理状态” | 说明文字可携带待办/日程意图，照片本身永不推断心理状态 | photo envelope payload.caption + constraints | `src/ai-native/intent/intentParser.ts`（photo kind 分支）、`tests/intentGraph.test.ts` | intent tests | implemented（2026-08-23） |
| V48-LD-01 | 数字孪生生活数据扩展 | 穿戴、手机、电脑、饮食共享可替换接口且不伪装已连接 | LifeDataConnector + LifeSignalObservation | `src/ai-native/connectors/` | adaptiveAppearance tests + typecheck | contract implemented；平台适配待实现（2026-08-26） |
| V48-LD-02 | 生活状态适应 | 熬夜、压力、饮食与长期趋势以克制、可解释、可撤回方式作用于 3D | AvatarAdaptiveAppearance | `adaptiveAppearance.ts`、`useLifeSignalStore.ts`、`VRMAvatarView.tsx` | 7 项生活信号/渲染边界测试 | implemented-v1（2026-08-26） |
| V48-OS-01 | 开源发布准备 | 新协作者可复现、边界与治理清楚 | docs + audit policy | 根目录治理文件、`scripts/open-source-audit.ps1` | audit PASS | implemented |
