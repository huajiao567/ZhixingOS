package com.zhixingos.vision

import android.graphics.PointF
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceContour
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import com.google.mlkit.vision.pose.PoseDetection
import com.google.mlkit.vision.pose.defaults.PoseDetectorOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ZhixingVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ZhixingVision")

    AsyncFunction("detectFaceLandmarks") { imageUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "Android context is unavailable", null)
        return@AsyncFunction
      }
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(imageUri))
      } catch (error: Exception) {
        promise.reject("E_IMAGE_DECODE", "无法读取所选照片", error)
        return@AsyncFunction
      }
      val options = FaceDetectorOptions.Builder()
        .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
        .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
        .setContourMode(FaceDetectorOptions.CONTOUR_MODE_ALL)
        .setMinFaceSize(0.12f)
        .build()
      val detector = FaceDetection.getClient(options)
      detector.process(image)
        .addOnSuccessListener { faces ->
          val primary = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
          promise.resolve(primary?.let { sparseFaceLandmarks(it, image.width, image.height) })
        }
        .addOnFailureListener { error ->
          promise.reject("E_FACE_DETECTION", "端侧人脸检测失败", error)
        }
        .addOnCompleteListener { detector.close() }
    }

    AsyncFunction("detectPoseLandmarks") { imageUri: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject("E_NO_CONTEXT", "Android context is unavailable", null)
        return@AsyncFunction
      }
      val image = try {
        InputImage.fromFilePath(context, Uri.parse(imageUri))
      } catch (error: Exception) {
        promise.reject("E_IMAGE_DECODE", "无法读取所选照片", error)
        return@AsyncFunction
      }
      val options = PoseDetectorOptions.Builder()
        .setDetectorMode(PoseDetectorOptions.SINGLE_IMAGE_MODE)
        .build()
      val detector = PoseDetection.getClient(options)
      detector.process(image)
        .addOnSuccessListener { pose ->
          if (pose.allPoseLandmarks.isEmpty()) {
            promise.resolve(null)
          } else {
            val points = MutableList(33) { landmark(0.5f, 0.5f, 0f, 0f) }
            pose.allPoseLandmarks.forEach { item ->
              if (item.landmarkType in 0..32) {
                points[item.landmarkType] = landmark(
                  item.position.x / image.width.toFloat(),
                  item.position.y / image.height.toFloat(),
                  item.position3D.z / image.width.toFloat(),
                  item.inFrameLikelihood,
                )
              }
            }
            promise.resolve(mapOf("landmarks" to points, "width" to image.width, "height" to image.height))
          }
        }
        .addOnFailureListener { error ->
          promise.reject("E_POSE_DETECTION", "端侧姿态检测失败", error)
        }
        .addOnCompleteListener { detector.close() }
    }
  }

  /**
   * ML Kit Face Detection 返回轮廓而不是 478 点 FaceMesh。这里把同义几何点
   * 投影到应用现有的稀疏索引契约，后续仍由 TypeScript 可审计数学层统一计算。
   */
  private fun sparseFaceLandmarks(face: Face, width: Int, height: Int): Map<String, Any>? {
    val oval = face.getContour(FaceContour.FACE)?.points.orEmpty()
    val rightEye = face.getContour(FaceContour.RIGHT_EYE)?.points.orEmpty()
    val leftEye = face.getContour(FaceContour.LEFT_EYE)?.points.orEmpty()
    val rightBrow = face.getContour(FaceContour.RIGHT_EYEBROW_TOP)?.points.orEmpty()
    val leftBrow = face.getContour(FaceContour.LEFT_EYEBROW_TOP)?.points.orEmpty()
    val mouth = listOf(
      FaceContour.UPPER_LIP_TOP,
      FaceContour.UPPER_LIP_BOTTOM,
      FaceContour.LOWER_LIP_TOP,
      FaceContour.LOWER_LIP_BOTTOM,
    ).flatMap { face.getContour(it)?.points.orEmpty() }
    if (oval.isEmpty() || rightEye.isEmpty() || leftEye.isEmpty() || mouth.isEmpty()) return null

    val center = face.boundingBox.exactCenterX() to face.boundingBox.exactCenterY()
    val result = MutableList(478) { landmark(center.first / width, center.second / height) }
    fun put(index: Int, point: PointF) {
      result[index] = landmark(point.x / width, point.y / height)
    }

    val top = oval.minBy { it.y }
    val chin = oval.maxBy { it.y }
    val rightCheek = oval.minBy { it.x }
    val leftCheek = oval.maxBy { it.x }
    val lowerOval = oval.filter { it.y >= face.boundingBox.exactCenterY() }.ifEmpty { oval }

    put(10, top)
    put(152, chin)
    put(234, rightCheek)
    put(454, leftCheek)
    put(33, rightEye.minBy { it.x })
    put(133, rightEye.maxBy { it.x })
    put(159, rightEye.minBy { it.y })
    put(145, rightEye.maxBy { it.y })
    put(263, leftEye.maxBy { it.x })
    put(362, leftEye.minBy { it.x })
    put(386, leftEye.minBy { it.y })
    put(374, leftEye.maxBy { it.y })

    val rightInner = rightEye.maxBy { it.x }
    val leftInner = leftEye.minBy { it.x }
    put(168, PointF((rightInner.x + leftInner.x) / 2f, (rightInner.y + leftInner.y) / 2f))
    val nose = face.getLandmark(FaceLandmark.NOSE_BASE)?.position
      ?: face.getContour(FaceContour.NOSE_BOTTOM)?.points?.maxByOrNull { it.y }
      ?: return null
    put(1, nose)
    put(61, mouth.minBy { it.x })
    put(291, mouth.maxBy { it.x })
    put(172, lowerOval.minBy { it.x })
    put(397, lowerOval.maxBy { it.x })
    put(105, (rightBrow.ifEmpty { rightEye }).minBy { it.y })
    put(334, (leftBrow.ifEmpty { leftEye }).minBy { it.y })

    return mapOf("landmarks" to result, "width" to width, "height" to height)
  }

  private fun landmark(x: Float, y: Float, z: Float = 0f, visibility: Float? = null): Map<String, Double> {
    val value = mutableMapOf("x" to x.toDouble(), "y" to y.toDouble(), "z" to z.toDouble())
    if (visibility != null) value["visibility"] = visibility.toDouble()
    return value
  }
}
