# syntax=docker/dockerfile:1
#
# Streambert in a browser-accessible desktop container (linuxserver Selkies).
# Multi-arch: linux/amd64 and linux/arm64.
#
#   docker buildx build --platform linux/amd64,linux/arm64 -t streambert:latest .
#
# See docker/README.md for running instructions.

ARG VID_DL_VERSION=v.2.3.3

# ── Stage 1: build + package the Electron app ────────────────────────────────
# Runs on the build host's native arch. The app has no native node modules, so
# electron-builder can package the target-arch Electron without emulation.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS app
ARG TARGETARCH
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) EB_ARCH=x64 ;; \
      arm64) EB_ARCH=arm64 ;; \
      *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; \
    esac; \
    ELECTRON_DIST=1 npx vite build; \
    npx electron-builder --linux dir --${EB_ARCH} --publish never; \
    mv dist/linux-*unpacked /out

# ── Stage 2: build vid-dl (the downloader) for the target arch ───────────────
# Upstream only publishes a Linux x64 binary, so build it from source with
# PyInstaller. Uses the same --onedir layout the app expects (_internal/ + exe).
FROM python:3.12-slim-bookworm AS viddl
ARG VID_DL_VERSION
RUN apt-get update \
 && apt-get install -y --no-install-recommends binutils curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /build
RUN curl -fsSL "https://github.com/truelockmc/vid-dl-cli-only/archive/refs/tags/${VID_DL_VERSION}.tar.gz" \
      | tar xz --strip-components=1 \
 && pip install --no-cache-dir -r requirements.txt pyinstaller \
 && python -m PyInstaller --noconfirm --onedir --clean --noupx \
      --exclude-module pycryptodomex.selftest \
      --exclude-module pycryptodomex.tests \
      --name vid-dl cli.py \
 && ./dist/vid-dl/vid-dl --help >/dev/null

# ── Stage 3: uosc (modern mpv player UI) ─────────────────────────────────────
# Pure Lua + fonts, so it is fetched once on the build host for every arch.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS uosc
ARG UOSC_VERSION=5.13.0
ADD https://github.com/tomasklaen/uosc/releases/download/${UOSC_VERSION}/uosc.zip /tmp/uosc.zip
RUN mkdir /uosc && unzip -q /tmp/uosc.zip -d /uosc

# ── Stage 4: runtime ─────────────────────────────────────────────────────────
FROM ghcr.io/linuxserver/baseimage-selkies:debiantrixie

ENV TITLE=Streambert \
    NO_DECOR=true

# Electron runtime libraries, ffmpeg (needed for downloads) and mpv (the app
# plays downloaded files and "open in external player" streams through mpv;
# its window shows up in the browser like the app itself).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg \
      mpv \
      libasound2t64 \
      libatk-bridge2.0-0t64 \
      libatspi2.0-0t64 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0t64 \
      libnotify4 \
      libnss3 \
      libsecret-1-0 \
      libxkbcommon0 \
      libxss1 \
      libxtst6 \
      xdg-utils \
 && apt-get autoclean \
 && rm -rf /var/lib/apt/lists/* /var/tmp/* /tmp/*

COPY --from=app /out /opt/streambert
COPY --from=viddl /build/dist/vid-dl /opt/vid-dl
COPY --from=uosc /uosc/scripts/ /etc/mpv/scripts/
COPY --from=uosc /uosc/fonts/ /etc/mpv/fonts/
COPY --from=uosc /uosc/fonts/ /usr/share/fonts/truetype/uosc/
COPY docker/root/ /
COPY public/sized/256x256.png /usr/share/selkies/www/icon.png

# Strip any CRLF from Windows checkouts, then make the scripts executable.
# Make mpv the default app for video files (used when the app hands a file to
# the system via xdg-open).
RUN sed -i 's/\r$//' /usr/local/bin/streambert-launch /defaults/autostart /etc/mpv/mpv.conf /etc/mpv/script-opts/uosc.conf /etc/mpv/input.conf \
 && chmod +x /usr/local/bin/streambert-launch /defaults/autostart \
 && for t in video/mp4 video/x-matroska video/webm video/x-msvideo video/quicktime video/mp2t; do \
      echo "$t=mpv.desktop"; done \
      | sed '1i [Default Applications]' > /etc/xdg/mimeapps.list

EXPOSE 3001
VOLUME /config
