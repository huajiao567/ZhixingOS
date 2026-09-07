# 测试与证据分级

## 日常质量门

```powershell
npm run check
npm run doctor
npm run build:web
npm run audit:open-source
```

`npm run check` 包含前后端单元测试和严格 TypeScript。后端生产编译可单独执行：

```powershell
npm --prefix backend run build
```

## Web 桌面工作台\n\n先启动后端与 Web，再运行：\n\n```powershell\nnpm --prefix backend run dev\nnpm run web\nnpm run test:desktop\n```\n\nPlaywright 固定使用 1440 × 960 桌面视口，验证宽屏工作台入口、键盘快捷输入、统一执行内核跳转和主要导航。它证明桌面 Web 交互路径通过，不等价于 Windows/macOS 原生桌面壳已经验证。\n\n## Web 手机视口

先启动后端与 Web，再运行：

```powershell
npm --prefix backend run dev
npm run web
npm run test:mobile
```

Playwright 使用 390 × 844、2 倍像素密度、触摸输入。HTML、JSON、截图、trace 和视频是本地生成物，全部被忽略，不进入 Git；代码审查只保留测试源码。

完整角色回归入口：

```powershell
npm --prefix backend run test:e2e
npm --prefix backend run test:e2e:persona
npx playwright test e2e/persona-ui.spec.ts --project=mobile-chromium
```

## Android APK

```powershell
npm run build:apk
```

构建脚本校验 Gradle ZIP、编译 Release APK、验证签名并输出 SHA-256。产物位于 ignored 的 `artifacts/`。安装、权限和 3D 真机步骤见 [ANDROID_APK_TEST.md](ANDROID_APK_TEST.md)。

## 证据等级

| 等级 | 可以声称 | 不能声称 |
|---|---|---|
| 代码/类型 | 接口和实现可编译 | 功能在设备上可用 |
| 单元/契约 | 规则与边界在合成数据通过 | 原生权限、性能或视觉通过 |
| Web 桌面视口 | 宽屏工作台布局和 Web 执行路径通过 | Windows/macOS 原生文件、窗口、托盘等系统能力通过 |\n| Web 移动视口 | 手机布局和 Web 执行路径通过 | Android/iOS 系统能力通过 |
| 原生编译/验签 | APK 包含原生代码且签名可验证 | 已安装、已授权或视觉质量通过 |
| 模拟器 | 特定系统镜像中的原生流程通过 | 物理传感器和厂商 ROM 通过 |
| 物理设备 | 指定设备、系统和步骤通过 | 其他设备矩阵或生产发布通过 |

任何失败都应保留真实状态和诊断信息。3D 加载失败不得用二维头像或替代几何体冒充成功；连接器不可用不得用演示数据冒充已同步。

