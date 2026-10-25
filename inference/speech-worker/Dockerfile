FROM python:3.11-slim
ENV PYTHONUNBUFFERED=1 HF_HOME=/models HF_HUB_DISABLE_TELEMETRY=1 SPEECH_DEVICE=cpu
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ffmpeg libsndfile1 espeak-ng git && rm -rf /var/lib/apt/lists/*
WORKDIR /srv/speech
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
# Bake model/voice downloads into the image, avoiding a multi-GB download on each cold start.
RUN python -c 'from server import Models; Models()'
EXPOSE 8095
CMD ["sh", "-c", "python -m uvicorn server:app --host 0.0.0.0 --port ${PORT:-8095} --workers 1"]
