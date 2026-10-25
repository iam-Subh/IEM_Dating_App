# Face service for the real-person check (PHOTO_VERIFICATION_PLAN.md 7.1).
# Prebuilt dlib (dlib-bin), so the image builds in a minute instead of compiling dlib.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

RUN pip install --no-cache-dir \
      dlib-bin==20.0.1.post1 \
      face_recognition_models==0.3.0 \
      numpy==2.1.3 \
      pillow==11.0.0 \
      fastapi==0.115.6 \
      uvicorn==0.32.1 \
      onnxruntime==1.20.1 \
 && pip install --no-cache-dir --no-deps face_recognition==1.3.0 Click==8.1.7

COPY app.py .
# The nudity model (scripts/fetch-nudity-model.sh) and its licence.
COPY models/ ./models/

# Private: reached only by the API, never published to the internet.
EXPOSE 8090
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
