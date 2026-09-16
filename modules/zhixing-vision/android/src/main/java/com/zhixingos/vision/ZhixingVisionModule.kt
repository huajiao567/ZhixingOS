package com.zhixingos.vision

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Strict-local privacy stub.
 *
 * The previous Android implementation depended on Google ML Kit face/pose
 * packages. Those packages were removed because their SDK diagnostics/usage
 * telemetry violates the product rule that native application egress is
 * limited to the user-configured LLM API.
 *
 * Keep the Expo module name stable so existing JS imports do not break, but
 * fail closed until a separately audited, telemetry-free offline detector is
 * introduced.
 */
class ZhixingVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZhixingVision")

    AsyncFunction("detectFaceLandmarks") { _: String, promise: Promise ->
      promise.reject(
        "E_STRICT_LOCAL_DISABLED",
        "严格本地构建已关闭 Android 自动照片拟合；可继续使用手动捏脸。",
        null,
      )
    }

    AsyncFunction("detectPoseLandmarks") { _: String, promise: Promise ->
      promise.reject(
        "E_STRICT_LOCAL_DISABLED",
        "严格本地构建已关闭 Android 自动体格拟合；可继续使用手动调整。",
        null,
      )
    }
  }
}
