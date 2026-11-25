# Marquee: Node server + Python analyzer + ffmpeg in one small image.
# Media is expected as a mounted volume (see docker-compose.yml), not baked in.
FROM node:24-trixie-slim

ENV NODE_ENV=production \
    PORT=8080 \
    MEDIA_DIR=/media \
    DATA_DIR=/data \
    CONFIG_DIR=/app/config \
    PYTHONDONTWRITEBYTECODE=1

# ffmpeg: probing, thumbnails, decoding for analysis, lossless FLAC fallbacks
# numpy/scipy: the music analyzer      fonts: captions in the generated test media
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg python3 python3-numpy python3-scipy fonts-dejavu-core tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
COPY analyzer ./analyzer
COPY scripts ./scripts
COPY config ./config

RUN mkdir -p /media/demos /media/movies /media/music /data \
 && chown -R node:node /data /media

USER node
EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server/index.js"]
