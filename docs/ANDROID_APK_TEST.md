# Android 真机 APK 测试

## 构建

项目使用 Expo SDK 57 / React Native 0.86.2，Android 编译参数为 compile/target SDK 36、minSdk 26、JDK 17、NDK 27.1.12297006。

1. 将官方 `gradle-9.3.1-bin.zip` 放到项目根目录的 `.toolchains/gradle-9.3.1-bin.zip`，不要解压。
2. 运行 `npm run build:apk`。
3. 脚本先校验 Gradle SHA-256，再编译、验证 APK 签名并输出 APK SHA-256。
4. 最终测试包位于 `artifacts/ZhixingOS-1.0.0-preview.apk`。

测试 APK 使用 Android debug keystore 签名，适合直接安装测试；正式上架前必须改用受保护的 production keystore，并生成 AAB。

本轮验证产物：

- 字节：`206634741`
- SHA-256：`C2DBE00808A58358265D086CC5D3E3C5A3128ADEDE5E4F10F67C7A947D3DE499`
- 包名：`com.zhixingos.satori`
- ABI：`arm64-v8a`、`armeabi-v7a`、`x86`、`x86_64`
- 权限反查：包含录音与读写日历，不包含悬浮窗权限

包体增大是完整保留四 ABI、3D 运行时以及离线首用的 bundled ML Kit 人脸/姿态模型所致；测试包没有通过删除能力或切换轻量占位模型来降级。正式分发可用 Play AAB 按设备拆分 ABI，在不减少功能的前提下降低单设备下载量。

## 启动手机可访问的后端

1. 电脑与手机连接同一局域网。
2. 在项目根目录运行 `npm run backend:phone`。
3. 首次启动时若 Windows 弹出防火墙提示，允许 Node.js 访问专用网络。
4. APK 登录页展开“服务器设置”，填写脚本显示的地址，点“检测并保存”。
5. 使用演示账号 `demo@zhixingos.com / demo1234`。

也可以用 USB 直接安装：在手机开启开发者选项和 USB 调试，连接电脑并允许调试授权，然后运行：

```powershell
.\.toolchains\android-sdk\platform-tools\adb.exe install -r .\artifacts\ZhixingOS-1.0.0-preview.apk
```

若电脑 IP 变化，无需重打包，直接在登录页的“服务器设置”填写 `npm run backend:phone` 输出的新地址。

## 原生照片拟合验收

1. 登录后进入“现在的我”→ 形象编辑，选择“照片拟合”。
2. 选择一张正脸、肩部可见、光线均匀的照片；确认 Android 直接开始端侧分析，不出现“仅 Web 支持”或模型下载等待。
3. 确认预览参数有变化且仍可逐项手动修正；保存后重启 App，确认阶段形象保持。
4. 断网后重复第 2 步，确认 bundled 模型仍可工作。
5. 在系统文件/网络代理检查中确认照片像素未上传；SDK 可能发送 Google 所述的诊断和使用指标，详见 `PRIVACY.md`。
6. 用无脸、多人、遮挡、横置和极暗照片验证明确错误，不得生成伪造拟合结果。

本机已完成原生模块编译、自动链接和 APK 签名验证；由于当前电脑固件虚拟化关闭且没有连接 Android 真机，上述 6 项仍须由真实设备执行后才能标记为“真机通过”。

## 电脑端手机界面测试

- `npm run build:web` 生成 production Web 产物；3D GLB 由 Metro 作为带哈希资源写入 `dist`。
- 用静态服务器启动 `dist` 后，设置 `WEB_BASE` 并执行 `npm run test:mobile`。
- 手机项目固定使用 390 × 844、2 倍像素密度、触摸输入；主用例必须等真实 3D 模型进入 `ready` 且进度层卸载。

## Android 模拟器前置条件

当前电脑检测到 `VirtualizationFirmwareEnabled=False`。在 BIOS 开启 **Intel Virtualization Technology (VT-x)** 前，不下载 Android Emulator 与 system image，因为即使下载也不能运行硬件加速虚拟设备。开启后再安装官方 emulator、Android 36 Google APIs x86_64 system image，并运行原生 APK 自动化。

## 3D 验收标准（禁止降级）

- 默认服务契约未加载时仍为 V3 动态 3D。
- Android 使用 `@react-three/fiber/native` + `expo-gl` 加载 APK 内置的真实 VRM/GLB。
- VRM 加载或 GPU 渲染失败时只显示明确错误和“重试 3D”，不得显示 2D 图标或替代几何体。
- V0/V1 仅在用户服务契约明确选择时生效，不得作为异常回退路径。
