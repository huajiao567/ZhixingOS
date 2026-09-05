# Changelog

All notable changes are documented here. The project follows Keep a Changelog structure and intends to use semantic versioning after the first public release.

## 版本史（合并自 overview-v47.md，2026-08-23 文档精简）

- **V4.6（3D 镜像主画布交互定型）**：首页定型为持久化 3D 镜像主画布——左侧 3D 孪生体、右侧情绪/健康/规划三项极简指数、顶部玻璃拟态感知流、底部零摩擦记录栏、记忆吸入动画闭环；原五个入口降级为稳定退路。
- **V4.7（UI/交互/文档协同优化，2026-07-29）**：390×844 像素级定型——感知流区 ≤118px、舞台视宽 60%、指数窄栏 112px、记录栏 ≈140px；落地镜台替代圆形相框；IndexPill 指数签替代三张大卡（2px 色条+状态词+趋势+迷你趋势线，无分数）；语音手势数值化（长按 180ms 说话、上滑 40px 锁定、左滑 60px 取消，手势非唯一入口）；记忆吸入动效定格 900ms 贝塞尔轨迹入胸口记忆核心、撤回窗口 5s；动效四档 150/250/400/900ms；关 3D 降级为静态 2D 镜像卡；六条关键路径均 ≤3 级跳转、可撤回。高保真原型 `design/satori-mirror-v47.html`。
- **V4.8（VRM 专业 3D 孪生体与双主题实现）**：three-vrm v3.x 加载管线 + VRoid CC0 AvatarSample_G（52 根 Humanoid 骨骼、BlendShape 表情）；自然待机（呼吸 ±0.03rad/1.4Hz、眨眼 3‰/帧、视线随机游走、A-pose）；四层 Avatar 数据架构 + Zustand 持久化；晨雾镜境/夜航镜境双主题 Design Token（含 3D 四灯光照参数入 Token，WCAG AAA）；9 套主题跟随系统自动切换。
- **文档精简（2026-08-23）**：项目书以 `开发文档/项目书-V4.8.docx` 为唯一真源（旧版 V4.7 及初版已删除）；删除已解压的 `airi-main.zip` 副本（510MB）与设计会话聊天记录 `goon.md`（其决策已同步进项目书 V4.7/4.8 章节，且内含泄露的第三方 API key，不应留在仓库）。

## [Unreleased]

### Added

- AI-native EventEnvelope, IntentGraph, LifeObjectGraph and ContextSurface domain layer.
- Transparent 时、位、势、应、变、中 change-reasoning kernel.
- ActionGateway with agency gating, confirmation, idempotency, partial failure, receipts and real undo.
- Versioned TwinProfile with scoped evidence, counterevidence, correction and rollback.
- Backend life-object, action-receipt and twin-profile persistence and APIs.
- Open workspace for task, event, course, note and draft execution.
- Real Expo SDK 57 photo selection, foreground audio recording and system-calendar adapters.
- Camera capture for photo records (`takePhoto`): the record bar camera button now offers 拍摄 or 相册选择, and every photo record is written through a traceable `photo` EventEnvelope (envelope id, sourceRef, privacy level D1, visible save destination and undo), per the zero-friction record composer contract.
- Photo envelopes with captions can enter the intent parser as `capture_note` candidates without throwing; photos are never auto-inferred into psychological state.
- Open-source governance, security, privacy and audit documentation.
- Local-first L0-L3 memory asset projection with source/version metadata, private agent binding, relevance ranking, strict character/time budgets and structured recall receipts.
- Bundled Android ML Kit face/pose detection through a local Expo module, so photo-to-avatar fitting works in the test APK without uploading pixels or downloading a first-use model.

### Changed

- Secretary action requests enter the shared executable workspace instead of being saved as placeholder journal entries.
- Mirror state UI uses evidence levels and qualitative language instead of frontstage human scores.
- Expo Calendar, ImagePicker and Audio dependencies aligned to SDK 57 recommended versions.
- Production backend refuses a default or weak JWT secret.
- Avatar 3D modules (three / @react-three/fiber / @pixiv/three-vrm) now load through `React.lazy` + dynamic import, so V0/V1 text and icon modes never evaluate them at startup; the web export emits the 3D code as a separate async chunk.
- The Mirror3D editor screen is lazy-loaded at the navigation level, removing the last eager three.js path from the startup bundle; in the web export the main chunk no longer contains three.js (editor and 3D stack ship as on-demand async chunks).
- `ActionCard` and `HypothesisCard` are wrapped in `React.memo` so unchanged cards skip re-render when screen-level state changes.
- Production backend now also requires an explicit `CORS_ORIGIN` list (wildcard rejected); the non-production fallback JWT secret logs a startup warning.
- Frontend `npm test` runs through a root-level `tsx` devDependency instead of reaching into `backend/node_modules`, so tests no longer break when the backend workspace is not installed.
- ESLint is now enforced via `eslint-config-expo` (flat config) with a `lint` script wired into `npm run check`; six real unescaped-entity errors in JSX were fixed and remaining compiler-era react-hooks rules start as warnings to be tightened incrementally.
- Commit engine explainer on the progress screen no longer exposes the technical term DAG, using plain life language (spec A35).
- Hypothesis statements render paired ASCII quotes as Chinese corner brackets on-screen only; raw statements in data and audit layers are untouched (display transform extracted to testable `src/services/hypothesisPresentation.ts`).

### Fixed

- Corrected the repository LICENSE copyright, which previously belonged to an Expo template rather than this project.
- Runtime tables now participate in export and complete account deletion.
- Corrected photo-fitting normalization that saturated real samples at 0/1 by replacing crop-dependent image ratios with face-shape ratios and calibrated pose ranges.
- Excluded real-photo landmark/report artifacts from open-source candidates and taught the release audit to reject them if force-added.
- Secretary memory, skill and history content is now delimited as untrusted data; contract filtering and user corrections run before retrieval.
- Avatar photo fitting explicitly clears only the ImagePicker working copy inside the app cache after parameter extraction.
- Intent time parsing no longer mistakes quantities such as “买2本书” for 02:00, computes `下周` against the following calendar week, and honors the requested IANA timezone instead of hard-coding UTC+8.
- Photo/audio journal records now synchronize opaque receipts instead of device `file://` or `content://` paths; cancelling an app-owned recording deletes its file.
- Removed private local paths from real-photo QA scripts and excluded local Expo-module Gradle outputs from open-source candidates.
