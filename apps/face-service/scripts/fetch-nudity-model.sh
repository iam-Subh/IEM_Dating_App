#!/bin/sh
# Downloads Freepik's nsfw_image_detector (MIT) and converts it to ONNX for the
# face service: models/nsfw_freepik.onnx (~358 MB, not in git). Needs Docker.
# Checks that the ONNX copy gives the same probabilities as the original.
set -e
cd "$(dirname "$0")/.."
mkdir -p models
cat > models/.export.py <<'PY'
import numpy as np, onnxruntime as ort, timm, torch
model = timm.create_model("hf-hub:Freepik/nsfw_image_detector", pretrained=True).eval()
x = torch.randn(2, 3, 448, 448)
torch.onnx.export(model, x[:1], "nsfw_freepik.onnx", input_names=["pixels"], output_names=["logits"],
                  dynamic_axes={"pixels": {0: "n"}, "logits": {0: "n"}}, opset_version=17, dynamo=False)
with torch.inference_mode():
    expected = model(x).numpy()
got = ort.InferenceSession("nsfw_freepik.onnx", providers=["CPUExecutionProvider"]).run(None, {"pixels": x.numpy()})[0]
assert np.abs(got - expected).max() < 1e-3, "ONNX output differs"
print("models/nsfw_freepik.onnx ready")
PY
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/models:/work" -w /work python:3.11-slim sh -c "\
  pip install -q torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu && \
  pip install -q timm==1.0.12 huggingface_hub==0.27.0 safetensors onnx onnxscript onnx-ir onnxruntime==1.20.1 && \
  python .export.py"
rm -f models/.export.py
