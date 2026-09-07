# 知行镜 ZhixingOS

知行镜是一个面向个人数据主权的开放式智能环境：它把自然语言、照片、语音、日历与生活记录组织成可追溯的“生命对象”，由执行秘书在用户确认后真正创建待办、日程、课程、记录或草稿，并用持久化回执说明做了什么、哪里失败、如何撤销。

它不是心理诊断、医疗建议、命运预测或人格评分工具。系统对人的理解始终是有来源、可质疑、可纠正、会过期的工作假设。

## 核心能力

- 执行秘书：输入“明天下午 3 点开项目会，1 小时”，系统先解析时间与对象，说明变化依据和影响范围，经确认后写入知行镜及设备日历。
- 开放工作台：任务、日程、课程、项目、记录与草稿共享同一套意图、对象、权限、执行和回执协议。
- 数字孪生记忆：单次输入只影响临时状态；多次跨情境证据才形成候选偏好，用户纠正可使推断失效并保留版本。
- 变化推理内核：以“时、位、势、应、变、中”评估时间、边界、趋势、耦合、可逆变化与可持续平衡，不输出吉凶。
- 数据主权：来源授权、证据链、审计、导出、撤回、软删除级联重算与账号彻底删除。
- 3D 数字人：保留 V0–V3 服务契约与完整动态 3D 默认模式，个人模型版本可形成阶段快照。
- 生活数据扩展：统一保留 Health Connect/小米、手机使用、ActivityWatch、饮食照片与条码接口；已确认摘要可通过限幅、衰减和撤回门微调 3D 孪生。
- 多端：Expo SDK 57 / React Native 0.86，支持 Android、iOS 与 Web；≥1100px Web 使用独立桌面工作台，窄屏与原生端保留手机伴侣界面；系统日历需开发构建或安装 APK。

## 架构

```text
文本 / 照片 / 语音 / 日历
              ↓
EventEnvelope → IntentGraph → LifeObjectGraph
              ↓
ChangeReasoningKernel（时位势应变中）
              ↓
ContextSurface → ActionGateway → 真实执行器
              ↓
ActionReceipt / Undo → EvidenceFeedback → TwinProfile

穿戴 / 手机 / 电脑 / 饮食
              ↓
LifeDataConnector → LifeSignalObservation
              ↓
AdaptiveAppearance → VRM 临时材质 / 表情 / 骨骼
```

主要目录：

- `src/ai-native/`：无平台依赖的输入、意图、生命对象、变化推理、界面编译、行动网关与孪生领域层。
- `src/screens/workspace/`：开放工作台。
- `src/services/`：后端 API、系统日历、待办、照片、录音和权限适配器。
- `src/mirror3d/`：数字人渲染、连续性和个人模型映射。
- `backend/src/`：认证、SQLite、证据蒸馏、秘书、生命对象、行动回执和孪生档案 API。
- `tests/`、`backend/tests/`、`e2e/`：领域契约、后端契约与移动视口功能测试。

详见 [ARCHITECTURE.md](ARCHITECTURE.md)、[当前状态](docs/STATUS.md) 和 [生活数据接入](docs/INTEGRATIONS.md)。

## 快速开始

要求：Node.js 22.16+（Expo SDK 57 要求 22.13+；后端 SQLite 备份 API 要求 22.16+）。原生 Android 构建还需要 JDK 17；本仓库的构建脚本可直接使用 `.toolchains/gradle-9.3.1-bin.zip`，该工具链不会进入 Git。

```powershell
git clone <your-repository-url>
cd app
Copy-Item .env.example .env.local
Copy-Item backend\.env.example backend\.env
npm install
npm --prefix backend install
```

开发环境务必把 `backend/.env` 的 `JWT_SECRET` 换为随机值；`DEEPSEEK_API_KEY` 可留空，此时依赖 LLM 的对话/草稿能力会明确报错，其他确定性能力仍可开发和测试。

启动后端：

```powershell
npm --prefix backend run dev
```

启动 Web 或 Expo 开发服务器：

```powershell
npm run web
# 或
npm start
```

开发环境会创建演示账号 `demo@zhixingos.com` / `demo1234`。生产部署不应公开演示账号，并必须设置 HTTPS、强 JWT 密钥和明确的 `CORS_ORIGIN`。

## 手机测试与 APK

构建 APK：

```powershell
npm run build:apk
```

产物写入 ignored 的 `artifacts/`，随后应执行签名和 SHA-256 校验。安装、ADB 和真机检查见 [docs/ANDROID_APK_TEST.md](docs/ANDROID_APK_TEST.md)。

当前已验证的侧载测试包：`artifacts/ZhixingOS-1.0.0-preview.apk`，SHA-256 `C2DBE00808A58358265D086CC5D3E3C5A3128ADEDE5E4F10F67C7A947D3DE499`。它使用 Android debug certificate 的 v2 签名，适合手机直接测试，不是商店生产签名。

设备能力说明：

- 照片选择和录音使用 SDK 57 的 `expo-image-picker` 与 `expo-audio`，只在用户触发时请求权限。
- Android 形象照片拟合使用 APK 内置的人脸/姿态模型；像素端侧处理，但 ML Kit 的诊断遥测仍须按 `PRIVACY.md` 披露。
- 系统日历使用 SDK 57 的 `expo-calendar`；它不受 Expo Go 支持，必须使用开发构建或 APK。
- Web 不能直接写设备系统日历。系统会保留真实的知行镜对象并把日历步骤标记为失败/待执行，不会伪装成功。
- iOS 可选择同步到 Reminders；Android 待办首先保存为知行镜生命对象，具备可审计和可撤销语义。

## 质量门禁

```powershell
npm run check          # 前后端单测 + 严格类型检查
npm run doctor         # Expo SDK 与原生依赖一致性
npm run build:web      # 可部署 Web 构建
npm run test:desktop   # 1440×960 桌面工作台功能测试\nnpm run test:mobile    # 390×844 移动视口功能测试
npm run audit:open-source
```

后端完整构建：

```powershell
npm --prefix backend run build
```

测试结果必须区分：代码完成、自动化验证、Web 移动视口验证、真机验证和受硬件阻塞。电脑未启用 BIOS 虚拟化时不能把 Android Emulator 结果写成通过。

## 数据与安全边界

- `.env`、SQLite、备份、APK、工具链、日志、测试截图和私有项目书均被 `.gitignore` 排除。
- `EXPO_PUBLIC_*` 会进入客户端包，只能存放公开配置，绝不能存放模型密钥或 JWT 密钥。
- 高影响动作（金钱、公开发布、医疗、关系终止、法律文件）不会由确定性解析器直接执行。
- 动作部分失败必须返回 `partial_failure`；撤销只有在真实执行器提供 `undoToken` 时可用。
- 生产环境使用默认或不足 32 字符的 JWT 密钥时，后端会拒绝启动。

详见 [SECURITY.md](SECURITY.md)、[PRIVACY.md](PRIVACY.md) 和 [docs/OPEN_SOURCE_RELEASE_CHECKLIST.md](docs/OPEN_SOURCE_RELEASE_CHECKLIST.md)。

## API 概览

所有 `/api/data/*`、`/api/runtime/*`、`/api/secretary/*` 与 `/api/brief/*` 都需要 Bearer access token。

- `/api/auth/*`：注册、登录、刷新、注销、令牌撤销和账号删除。
- `/api/data/*`：事件、承诺、假设、实验、项目、技能、意义、证据、蒸馏、纠正、权限、服务契约、导出。
- `/api/runtime/life-objects`：生命对象读取、写入和按版本取消。
- `/api/runtime/action-receipts`：幂等行动回执和撤销状态。
- `/api/runtime/twin-profile`：版本化孪生档案。
- `/api/secretary/chat`：带安全门控和个人上下文的秘书对话。
- `/api/brief/*`：今日、周度与月度简报。

## 开源协作

本项目采用 [MIT License](LICENSE)。提交前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)、[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) 和 [GOVERNANCE.md](GOVERNANCE.md)。安全问题不要公开提交 Issue，请按 [SECURITY.md](SECURITY.md) 私下报告。

第三方 3D 模型与素材保留各自许可证；来源、文件级权限与哈希见 [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md)。不能假定主仓库 MIT 自动覆盖第三方资产。

## 当前仍需长期推进

- 离线优先队列和多设备冲突合并。
- 端到端加密与可移植的个人数据包。
- Android 系统级待办连接器与更多开放标准适配器。
- Health Connect/小米、手机使用、ActivityWatch 和饮食识别的真实平台适配器；当前仓库已完成统一契约与安全处理层。
- 真实设备上的日历/照片/录音回归矩阵。
- 公共治理、可访问性共建和非商业公共实例运维方案。

当前进度、已知限制与三种核心思想的融合见 [docs/STATUS.md](docs/STATUS.md)；测试命令与证据分级见 [docs/TESTING.md](docs/TESTING.md)。
