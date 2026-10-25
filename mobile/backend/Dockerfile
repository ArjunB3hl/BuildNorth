# Main Rhythm API only. Build context: mobile/backend (no model weights or GPU runtime).
FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    AUTO_MIGRATE=false \
    PORT=10000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --gid 10001 rhythm \
    && useradd --uid 10001 --gid rhythm --no-create-home rhythm \
    && mkdir -p /app/var \
    && chown rhythm:rhythm /app/var

COPY app ./app
COPY migrations ./migrations
COPY alembic.ini ./
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/rhythm-api

USER rhythm
EXPOSE 10000
CMD ["/usr/local/bin/rhythm-api"]
