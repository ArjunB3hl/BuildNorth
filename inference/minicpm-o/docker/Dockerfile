# syntax=docker/dockerfile:1.10
#
# MiniCPM-o 4.5 streaming inference for Rhythm: the official PyTorch backend of OpenBMB/MiniCPM-o-Demo (backend +
# worker + gateway) in ONE container for a Runpod Pod (Pods run no Docker Compose), behind a token-checking Caddy.
#
# Build (linux/amd64 only; CI does this, see .github/workflows/minicpm-o-image.yml). Context = inference/minicpm-o:
#   docker buildx build --platform linux/amd64 -f docker/Dockerfile \
#     $(sed -n 's/^\([A-Z_]*\)=\(.*\)$/--build-arg \1=\2/p' versions.env) .
#
# Model weights are NOT in the image: they are mounted from the Runpod network volume (MODEL_DIR, see README.md).
# No CUDA extension is compiled: the demo runs attention through PyTorch SDPA (flash-attn is optional upstream and not
# installed), and torch.compile is off by default (it compiles on the GPU at run time, so it cannot be built here).

ARG BASE_IMAGE
FROM ${BASE_IMAGE}

ARG DEMO_REPO
ARG DEMO_COMMIT
ARG MODEL_ID
ARG MODEL_REVISION
ARG IMAGE_VERSION
ARG TORCH_VERSION
ARG CUDA_RUNTIME
ARG MIN_DRIVER_MAJOR
ARG CADDY_VERSION=2.11.7
ARG CADDY_SHA512=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
ARG UV_VERSION=0.12.17
ARG UV_WHEEL_SHA256=9e25bb39e1674799c408345a6397ebc2c7c719d498be0ce9d935466d36ceacf5

LABEL org.opencontainers.image.title="rhythm-minicpm-o" \
      org.opencontainers.image.description="MiniCPM-o 4.5 full-duplex video+audio streaming (PyTorch backend) for Rhythm" \
      org.opencontainers.image.source="https://github.com/ArjunB3hl/BuildNorth" \
      org.opencontainers.image.version="${IMAGE_VERSION}" \
      rhythm.model.id="${MODEL_ID}" \
      rhythm.model.revision="${MODEL_REVISION}" \
      rhythm.demo.commit="${DEMO_COMMIT}"

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/app \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    RHYTHM_IMAGE_VERSION=${IMAGE_VERSION} \
    MODEL_ID=${MODEL_ID} \
    MODEL_REVISION=${MODEL_REVISION} \
    RHYTHM_MIN_DRIVER_MAJOR=${MIN_DRIVER_MAJOR}

# System packages: ffmpeg + libsndfile1 (the demo's media/audio stack), curl (health polling), git + ca-certificates
# (fetching the demo at its commit), openssh-server (Runpod "SSH over exposed TCP" for administration), tini (PID 1),
# procps. Debian bookworm's current versions are recorded in /opt/rhythm/build-info.json. The SSH host keys that the
# openssh-server package generates are deleted so no private key ships in the image; the entrypoint makes one per volume.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 curl ca-certificates git openssh-server tini procps \
 && rm -rf /var/lib/apt/lists/* /etc/ssh/ssh_host_* \
 && mkdir -p /run/sshd

# The demo's serving code at its exact commit. Its committed self-signed TLS key (certs/) is removed: TLS is
# terminated by Runpod's HTTPS proxy, and a private key must not ship in an image.
RUN git init -q /app \
 && git -C /app remote add origin "${DEMO_REPO}" \
 && git -C /app fetch -q --depth 1 origin "${DEMO_COMMIT}" \
 && git -C /app checkout -q FETCH_HEAD \
 && test "$(git -C /app rev-parse HEAD)" = "${DEMO_COMMIT}" \
 && rm -rf /app/.git /app/certs \
 && test -f /app/py_backend/server.py -a -f /app/worker.py -a -f /app/gateway.py \
 && test -f /app/assets/vad_model/silero_vad.onnx -a -f /app/assets/ref_audio/ref_minicpm_signature.wav \
 && test -f /app/assets/ref_audio/ref_en_dlc_1.wav

# Rhythm's patch of the demo's browser client: several camera samples per second (default: current frame + a 2x2
# grid), coaching prompt in the English preset, settings from the environment. Fails the build if upstream changed.
COPY docker/patch_demo.py /opt/rhythm/patch_demo.py
RUN python /opt/rhythm/patch_demo.py /app

# Python dependencies from the hash-checked lock (no resolution at build time). uv itself is installed from a pinned,
# hash-checked wheel; the one sdist (minicpmo-utils) is built with hash-pinned setuptools/wheel.
COPY requirements/requirements.lock requirements/build-constraints.txt /opt/rhythm/requirements/
RUN printf 'uv==%s --hash=sha256:%s\n' "${UV_VERSION}" "${UV_WHEEL_SHA256}" > /tmp/uv.txt \
 && pip install --require-hashes --no-deps -r /tmp/uv.txt \
 && uv pip install --system --require-hashes --no-deps --compile-bytecode \
        --build-constraints /opt/rhythm/requirements/build-constraints.txt \
        -r /opt/rhythm/requirements/requirements.lock \
 && rm -rf /tmp/uv.txt /root/.cache \
 && python -c "import torch, torchaudio, transformers; assert torch.__version__.startswith('${TORCH_VERSION}'), torch.__version__; assert torch.version.cuda.startswith('${CUDA_RUNTIME}'), torch.version.cuda; print('torch', torch.__version__, 'cuda', torch.version.cuda, 'transformers', transformers.__version__)"

# Caddy: the only public listener (HTTP behind Runpod's HTTPS proxy); checks the bearer token and forwards to the
# gateway on 127.0.0.1. Download verified against the release's published sha512.
RUN curl -fsSL -o /tmp/caddy.tar.gz \
        "https://github.com/caddyserver/caddy/releases/download/v${CADDY_VERSION}/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" \
 && echo "${CADDY_SHA512}  /tmp/caddy.tar.gz" | sha512sum -c - \
 && tar -xzf /tmp/caddy.tar.gz -C /usr/local/bin caddy \
 && rm /tmp/caddy.tar.gz \
 && caddy version

# Deployment runtime: entrypoint, preflight, warm-up, Caddy config, demo config template, pinned versions.
COPY runtime/ /opt/rhythm/runtime/
COPY versions.env /opt/rhythm/versions.env
RUN chmod +x /opt/rhythm/runtime/entrypoint.sh \
 && python -m py_compile /opt/rhythm/runtime/preflight.py /opt/rhythm/runtime/warmup.py /opt/rhythm/runtime/write_config.py \
        /opt/rhythm/runtime/clip_eval.py \
 && RHYTHM_API_TOKEN=build-time-validation-only-0123456789abcdef \
        caddy validate --config /opt/rhythm/runtime/Caddyfile --adapter caddyfile \
 && python - <<'EOF'
import json, subprocess, sys
pkgs = subprocess.run([sys.executable, "-m", "pip", "list", "--format=json"], capture_output=True, text=True, check=True).stdout
deb = subprocess.run(["dpkg-query", "-W", "--showformat=${Package}=${Version}\n"], capture_output=True, text=True, check=True).stdout.split()
info = {k: v for k, v in (l.split("=", 1) for l in open("/opt/rhythm/versions.env") if "=" in l and not l.startswith("#"))}
info = {k: v.strip() for k, v in info.items()}
info.update(python=sys.version.split()[0], pip_packages=json.loads(pkgs), debian_packages=deb)
json.dump(info, open("/opt/rhythm/build-info.json", "w"), indent=1)
EOF

WORKDIR /app

# 8000: Caddy (expose as HTTP in the Runpod template). 22: SSH for administration (expose as TCP). The gateway (8006,
# 8007), worker (22400) and backend (22500) listen on 127.0.0.1 only.
EXPOSE 8000 22

STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/opt/rhythm/runtime/entrypoint.sh"]
