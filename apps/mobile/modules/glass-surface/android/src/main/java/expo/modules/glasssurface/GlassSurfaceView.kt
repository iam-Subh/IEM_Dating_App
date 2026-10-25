package expo.modules.glasssurface

import android.content.Context
import android.graphics.*
import android.os.Build
import android.util.Log
import android.view.View
import android.view.ViewGroup
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class GlassSurfaceView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val ownLocation = IntArray(2)
  private val sourceLocation = IntArray(2)
  private val material = if (Build.VERSION.SDK_INT >= 31) RenderNode("GlassMaterial") else null
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
  private val outline = Path()
  private var effectWidth = 0
  private var effectHeight = 0
  internal var reduceTransparency = false
  private var pillShape = false
  private var cornerRadiusDp = 26f
  private var bottomCornerRadiusDp: Float? = null
  internal fun setBottomCornerRadius(value: Float) {
    bottomCornerRadiusDp = if (value.isFinite()) value.coerceAtLeast(0f) else null
    effectWidth = 0
    invalidate()
  }
  internal fun setCornerRadius(value: Float) {
    val radius = if (value.isFinite()) value.coerceAtLeast(0f) else 26f
    if (cornerRadiusDp == radius) return
    cornerRadiusDp = radius
    effectWidth = 0
    invalidate()
  }
  internal fun setPillShape(value: Boolean) {
    if (pillShape == value) return
    pillShape = value
    effectWidth = 0
    invalidate()
  }
  private val density = resources.displayMetrics.density
  // Keep the material equally inset inside the drawing bounds on every side.
  private val surfaceInsetDp = 1f

  init {
    // ExpoView is a container. Its default skip-draw flag would bypass the
    // material and draw only React children when used in a normal hierarchy.
    setWillNotDraw(false)
  }

  private fun findSource(): GlassSourceView? {
    var ancestor = parent
    while (ancestor is ViewGroup) {
      for (index in 0 until ancestor.childCount) {
        val child = ancestor.getChildAt(index)
        if (child is GlassSourceView) return child
      }
      ancestor = ancestor.parent
    }
    return null
  }

  override fun onDetachedFromWindow() {
    material?.discardDisplayList()
    super.onDetachedFromWindow()
  }

  override fun draw(canvas: Canvas) {
    val host = findSource()
    getLocationInWindow(ownLocation)
    host?.getLocationInWindow(sourceLocation)
    drawSurface(canvas, host?.source, ownLocation[0] - sourceLocation[0], ownLocation[1] - sourceLocation[1])
  }

  private fun updateShape() {
    val w = width / density
    outline.reset()
    if (pillShape) {
      val inset = surfaceInsetDp * density
      val radius = minOf(cornerRadiusDp * density, (height - 2 * inset) / 2, (width - 2 * inset) / 2).coerceAtLeast(0f)
      val bottomRadius = minOf((bottomCornerRadiusDp ?: cornerRadiusDp) * density, (height - 2 * inset) / 2, (width - 2 * inset) / 2).coerceAtLeast(0f)
      outline.addRoundRect(RectF(inset, inset, width - inset, height - inset), floatArrayOf(radius, radius, radius, radius, bottomRadius, bottomRadius, bottomRadius, bottomRadius), Path.Direction.CW)
      return
    }
    outline.moveTo(31f, 22f)
    outline.lineTo(w / 2 - 55, 22f)
    outline.cubicTo(w / 2 - 40, 22f, w / 2 - 35, 20f, w / 2 - 25, 10f)
    outline.cubicTo(w / 2 - 18, 3f, w / 2 - 10, 0f, w / 2, 0f)
    outline.cubicTo(w / 2 + 10, 0f, w / 2 + 18, 3f, w / 2 + 25, 10f)
    outline.cubicTo(w / 2 + 35, 20f, w / 2 + 40, 22f, w / 2 + 55, 22f)
    outline.lineTo(w - 31, 22f)
    outline.cubicTo(w - 13.879f, 22f, w, 35.879f, w, 53f)
    outline.cubicTo(w, 70.121f, w - 13.879f, 84f, w - 31, 84f)
    outline.lineTo(31f, 84f)
    outline.cubicTo(13.879f, 84f, 0f, 70.121f, 0f, 53f)
    outline.cubicTo(0f, 35.879f, 13.879f, 22f, 31f, 22f)
    outline.close()
    val inset = surfaceInsetDp * density
    outline.transform(Matrix().apply {
      setScale((width - 2 * inset) / w, (height - 2 * inset) / 84f)
      postTranslate(inset, inset)
    })
  }

  internal fun drawSurface(canvas: Canvas, source: RenderNode?, x: Int, y: Int) {
    if (width <= 0 || height <= 0) return
    if (width != effectWidth || height != effectHeight) {
      updateShape()
      if (Build.VERSION.SDK_INT >= 31) configureEffect()
      effectWidth = width
      effectHeight = height
    }
    val saved = canvas.save()
    canvas.clipPath(outline)
    val node = material
    if (!reduceTransparency && Build.VERSION.SDK_INT >= 31 && canvas.isHardwareAccelerated && source != null && node != null) {
      node.setPosition(0, 0, width, height)
      val content = node.beginRecording()
      content.translate(-x.toFloat(), -y.toFloat())
      content.drawRenderNode(source)
      node.endRecording()
      canvas.drawRenderNode(node)
      // Use the requested #1C1C1C material color. Retain limited transparency
      // so the refracted source remains visible through the surface.
      paint.color = Color.argb(218, 28, 28, 28)
    } else {
      paint.color = Color.rgb(28, 28, 28)
    }
    paint.style = Paint.Style.FILL
    canvas.drawPath(outline, paint)
    canvas.restoreToCount(saved)
    super.dispatchDraw(canvas)
  }

  @android.annotation.TargetApi(31)
  private fun configureEffect() {
    // Keep enough background detail for refraction to be visible. The blur-only
    // fallback remains softer on devices without runtime shaders.
    val radius = if (Build.VERSION.SDK_INT >= 33) 2f else 5f
    val blur = RenderEffect.createBlurEffect(radius * density, radius * density, Shader.TileMode.CLAMP)
    if (Build.VERSION.SDK_INT >= 33) {
      try {
        val shader = RuntimeShader(EDGE_SHADER)
        shader.setFloatUniform("size", width / density, height / density)
        shader.setFloatUniform("density", density)
        shader.setFloatUniform("inset", surfaceInsetDp)
        shader.setFloatUniform("pillShape", if (pillShape) 1f else 0f)
        shader.setFloatUniform("cornerRadius", cornerRadiusDp)
        shader.setFloatUniform("bottomCornerRadius", bottomCornerRadiusDp ?: cornerRadiusDp)
        material?.setRenderEffect(RenderEffect.createChainEffect(
          RenderEffect.createRuntimeShaderEffect(shader, "background"), blur))
        return
      } catch (error: IllegalArgumentException) {
        Log.w("GlassSurface", "Refraction unavailable; using hardware blur", error)
      }
    }
    material?.setRenderEffect(blur)
  }

  companion object {
    private const val EDGE_SHADER = """
      uniform shader background;
      uniform float2 size;
      uniform float density;
      uniform float inset;
      uniform float pillShape;
      uniform float cornerRadius;
      uniform float bottomCornerRadius;
      float distanceToEdge(float2 p) {
        if (pillShape > .5) {
          float2 halfSize = size * .5 - inset;
          float selectedRadius = p.y > size.y * .5 ? bottomCornerRadius : cornerRadius;
          float radius = max(0.0, min(selectedRadius, min(halfSize.x, halfSize.y)));
          float2 q = abs(p - size * .5) - (halfSize - radius);
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
        }
        // Use the same inset and scale as the visible outline.
        float2 scale = (size - 2.0 * inset) / float2(size.x, 84.0);
        p = (p - inset) / scale;
        float2 q = abs(p - float2(size.x * .5, 53.0)) - float2(size.x * .5 - 31.0, 0.0);
        float pill = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 31.0;
        float circle = length(p - float2(size.x * .5, 33.0)) - 33.0;
        float h = max(12.0 - abs(pill - circle), 0.0) / 12.0;
        return (min(pill, circle) - h * h * 3.0) * min(scale.x, scale.y);
      }
      half4 main(float2 pixel) {
        float2 p = pixel / density;
        float d = distanceToEdge(p);
        float2 gradient = float2(distanceToEdge(p + float2(.4, 0.0)) - distanceToEdge(p - float2(.4, 0.0)),
          distanceToEdge(p + float2(0.0, .4)) - distanceToEdge(p - float2(0.0, .4)));
        float2 normal = gradient / max(length(gradient), .001);
        float depth = max(-d, 0.0);
        // Match CustomTabBar's clear lens: 11dp * refraction 1.35 * thickness 1.1.
        // Keep the outer bevel calm, then fade the lens before opposing normals
        // meet. Maximum displacement at the outline itself causes stretched text.
        float lensWidth = 33.0 * 1.4;
        float rim = 1.0 - clamp(depth / lensWidth, 0.0, 1.0);
        float contourFade = 1.0 - smoothstep(lensWidth * .18, lensWidth * .42, depth);
        float axisFade = smoothstep(.15, .8, length(gradient) / .8);
        float edgeGuard = smoothstep(0.0, max(12.0 / density, 33.0 * .7 * .18), depth);
        float bend = 16.335 * rim * rim * contourFade * axisFade * edgeGuard;
        return background.eval(pixel - normal * bend * density);
      }
    """
  }
}
