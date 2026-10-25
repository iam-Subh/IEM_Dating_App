package expo.modules.glasssurface

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GlassSurfaceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GlassSurface")
    View(GlassSourceView::class) { Name("Source") }
    View(GlassSurfaceView::class) {
      Name("Surface")
      Prop("bottomCornerRadius") { view: GlassSurfaceView, value: Float ->
        view.setBottomCornerRadius(value)
      }
      Prop("cornerRadius") { view: GlassSurfaceView, value: Float ->
        view.setCornerRadius(value)
      }
      Prop("shape") { view: GlassSurfaceView, value: String ->
        view.setPillShape(value == "pill")
      }
      Prop("reduceTransparency") { view: GlassSurfaceView, value: Boolean ->
        view.reduceTransparency = value
        view.invalidate()
      }
    }
  }
}
