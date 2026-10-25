"""
Face service for the real-person check (apps/mobile/src/features/verification/PHOTO_VERIFICATION_PLAN.md).

Private, inside our own network only. It computes and forgets: images in,
numbers out, nothing stored.

    POST /nudity    {"images": [...]} -> {"scores": [nudity probability per image]}
    POST /analyze   {"images": ["<base64 JPEG/PNG>", ...]}
      -> {"images": [{"faces": [{"box": [top, right, bottom, left],
                                  "descriptor": [128 floats],
                                  "eyeOpen": float,   # eye aspect ratio; low = closed
                                  "yaw": float,       # nose offset / eye distance; sign = direction
                                  "smile": float}]    # mouth width / eye distance
                     }, ...]}
    GET  /health    -> {"ok": true, "model": "dlib_face_recognition_resnet_model_v1"}

Face matching: dlib's ResNet model (public domain, 99.38% on LFW), through the
face_recognition library. Liveness actions are re-checked from the 68 face
landmarks, so the phone's own detection is never trusted alone.
"""
import base64
import io
import math
import os
from concurrent.futures import ProcessPoolExecutor

import face_recognition
import numpy as np
from fastapi import FastAPI, HTTPException
from PIL import Image, ImageOps
from pydantic import BaseModel

MAX_IMAGES = 24
MAX_SIDE = int(os.environ.get("FACE_MAX_SIDE", "960"))  # larger images are scaled down first
UPSAMPLE = int(os.environ.get("FACE_UPSAMPLE", "1"))
# The pose-tolerant CNN detector is ~15x slower than HOG; faces in a selfie are
# big, so it looks at a smaller copy (3.5s -> 1.4s a frame on CPU).
CNN_SIDE = int(os.environ.get("FACE_CNN_SIDE", "640"))
# dlib holds the GIL, so threads don't help: images are spread over processes
# (6 head-turn frames: 8.8s one by one, 2.3s on 6 processes).
PROCESSES = int(os.environ.get("FACE_PROCESSES", str(min(6, os.cpu_count() or 1))))

app = FastAPI(title="IEM Connect face service")


class AnalyzeRequest(BaseModel):
    images: list[str]


def _load(data: str) -> np.ndarray:
    try:
        raw = base64.b64decode(data, validate=True)
        image = Image.open(io.BytesIO(raw))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception as error:  # noqa: BLE001 - any bad input is the caller's error
        raise HTTPException(status_code=400, detail=f"Unreadable image: {error}") from error
    scale = MAX_SIDE / max(image.size)
    if scale < 1:
        image = image.resize((round(image.width * scale), round(image.height * scale)))
    return np.asarray(image)


def _dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _eye_open(points) -> float:
    # Eye aspect ratio: the two eyelid gaps over the eye's width. About 0.3 open, under 0.2 closed.
    if len(points) != 6:
        return 0.0
    width = _dist(points[0], points[3]) or 1.0
    return (_dist(points[1], points[5]) + _dist(points[2], points[4])) / (2.0 * width)


def _centre(points):
    return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))


def _metrics(landmarks: dict) -> dict:
    left, right = landmarks.get("left_eye", []), landmarks.get("right_eye", [])
    nose = landmarks.get("nose_tip", []) or landmarks.get("nose_bridge", [])
    top_lip = landmarks.get("top_lip", [])
    if not (left and right and nose and top_lip):
        return {"eyeOpen": 0.0, "yaw": 0.0, "smile": 0.0, "lift": 0.0}
    left_c, right_c = _centre(left), _centre(right)
    eyes = _dist(left_c, right_c) or 1.0
    middle_x = (left_c[0] + right_c[0]) / 2.0
    nose_c = _centre(nose)
    # Mouth corners: the outer ends of the top lip.
    xs = [p[0] for p in top_lip]
    mouth_width = (max(xs) - min(xs)) if xs else 0.0
    # Corner lift: how far the corners sit above the middle of the mouth. A
    # smile - even a soft, closed one - raises them; a still face never changes.
    lips = top_lip + landmarks.get("bottom_lip", [])
    left_corner = min(top_lip, key=lambda p: p[0])
    right_corner = max(top_lip, key=lambda p: p[0])
    middle_y = sum(p[1] for p in lips) / len(lips)
    lift = (middle_y - (left_corner[1] + right_corner[1]) / 2.0) / eyes
    return {
        "eyeOpen": round((_eye_open(left) + _eye_open(right)) / 2.0, 4),
        "yaw": round((nose_c[0] - middle_x) / eyes, 4),
        "smile": round(mouth_width / eyes, 4),
        "lift": round(lift, 4),
    }


@app.get("/health")
def health():
    return {"ok": True, "model": "dlib_face_recognition_resnet_model_v1", "nudity": os.path.exists(NUDITY_MODEL)}


# ---------------------------------------------------------------------------
# Nudity: Freepik's nsfw_image_detector (MIT, models/FREEPIK_NSFW_LICENSE), an
# EVA-02 vision transformer converted to ONNX by scripts/fetch-nudity-model.sh.
# Same computing-and-forgetting rule: images in, scores out, nothing stored.
#
#     POST /nudity  {"images": ["<base64 JPEG/PNG/WebP>", ...]}
#       -> {"scores": [0.0-1.0, ...], "levels": [[neutral, low, medium, high], ...]}
#
# The model sorts an image into four levels: neutral, low (suggestive, e.g.
# swimwear), medium (nudity) and high (explicit). The score is p(medium) +
# p(high): how likely it shows nudity. The API decides what it means
# (apps/api/src/services/nudity.service.ts).
# ---------------------------------------------------------------------------
NUDITY_MODEL = os.environ.get("NUDITY_MODEL", os.path.join(os.path.dirname(__file__), "models", "nsfw_freepik.onnx"))
NUDITY_SIZE = 448
# The model's own preprocessing (timm, eva02_base_patch14_448): squashed to
# 448x448, bicubic, CLIP normalisation.
NUDITY_MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
NUDITY_STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
_nudity_session = None


def _nudity():
    """Loaded on first use: 358 MB."""
    global _nudity_session
    if _nudity_session is None:
        if not os.path.exists(NUDITY_MODEL):
            raise HTTPException(status_code=503, detail="Nudity model not installed")
        import onnxruntime as ort
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get("NUDITY_THREADS", "4"))
        _nudity_session = ort.InferenceSession(NUDITY_MODEL, sess_options=options, providers=["CPUExecutionProvider"])
    return _nudity_session


def _nudity_input(data: str) -> np.ndarray:
    try:
        image = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(data, validate=True)))).convert("RGB")
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Unreadable image: {error}") from error
    pixels = np.asarray(image.resize((NUDITY_SIZE, NUDITY_SIZE), Image.BICUBIC), dtype=np.float32) / 255.0
    return ((pixels - NUDITY_MEAN) / NUDITY_STD).transpose(2, 0, 1)


@app.post("/nudity")
def nudity(request: AnalyzeRequest):
    if not request.images or len(request.images) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"Send 1 to {MAX_IMAGES} images")
    session = _nudity()
    batch = np.stack([_nudity_input(data) for data in request.images])
    logits = session.run(None, {session.get_inputs()[0].name: batch})[0]
    levels = np.exp(logits - logits.max(axis=1, keepdims=True))
    levels /= levels.sum(axis=1, keepdims=True)
    return {
        "scores": [round(float(row[2] + row[3]), 4) for row in levels],
        "levels": [[round(float(value), 4) for value in row] for row in levels],
        "model": "freepik-nsfw-image-detector",
    }


_executor = None


def _pool() -> ProcessPoolExecutor:
    global _executor
    if _executor is None:
        _executor = ProcessPoolExecutor(PROCESSES)
    return _executor


def _cnn_boxes(pixels: np.ndarray):
    scale = CNN_SIDE / max(pixels.shape[:2])
    if scale >= 1:
        return face_recognition.face_locations(pixels, number_of_times_to_upsample=0, model="cnn")
    small = np.asarray(Image.fromarray(pixels).resize((round(pixels.shape[1] * scale), round(pixels.shape[0] * scale))))
    found = face_recognition.face_locations(small, number_of_times_to_upsample=0, model="cnn")
    height, width = pixels.shape[:2]
    return [(max(0, round(top / scale)), min(width, round(right / scale)), min(height, round(bottom / scale)), max(0, round(left / scale)))
            for top, right, bottom, left in found]


def _analyze_one(pixels: np.ndarray) -> dict:
    boxes = face_recognition.face_locations(pixels, number_of_times_to_upsample=UPSAMPLE, model="hog")
    if not boxes:
        # The fast detector only sees faces from the front; a turned head
        # needs the slower, pose-tolerant CNN detector (the head-turn step).
        boxes = _cnn_boxes(pixels)
    descriptors = face_recognition.face_encodings(pixels, known_face_locations=boxes, num_jitters=1)
    landmarks = face_recognition.face_landmarks(pixels, face_locations=boxes)
    faces = []
    for box, descriptor, points in zip(boxes, descriptors, landmarks):
        faces.append({
            "box": list(box),
            "descriptor": [round(float(value), 6) for value in descriptor],
            **_metrics(points),
        })
    return {"faces": faces, "width": int(pixels.shape[1]), "height": int(pixels.shape[0])}


@app.post("/analyze")
def analyze(request: AnalyzeRequest):
    if not request.images or len(request.images) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"Send 1 to {MAX_IMAGES} images")
    pixels = [_load(data) for data in request.images]
    if len(pixels) == 1:
        return {"images": [_analyze_one(pixels[0])]}
    return {"images": list(_pool().map(_analyze_one, pixels))}
    return {"images": out}
