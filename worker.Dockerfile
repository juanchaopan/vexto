# The one image of the Cloud Run job vexto-collect and the services vexto-tts and
# vexto-billing-guard. Node runs the TypeScript entries in src/worker/ directly; each Cloud Run
# resource picks its entry with its args, for example `src/worker/tts.ts`. The speech model is
# not in the image: Cloud Run mounts the model bucket and MODEL_DIR names the model's directory.
#
# The base image is the Node.js version of .nvmrc, pinned by digest; Renovate updates both.
# Layers go from the least to the most often changed, so consecutive images can share the system
# packages and, while the lockfile stays the same, the dependencies.
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base

# Production dependencies of the Cloud Run entries only, with the pnpm version of packageManager.
# scripts/worker-dependencies.ts takes the packages only the web application uses
# (scripts/worker-image.json) out of the manifest and the lockfile, and the frozen install puts
# every remaining package at its locked version. Install scripts follow allowBuilds in
# pnpm-workspace.yaml. onnxruntime-node ships its native library for every platform; only the
# image's own is kept.
FROM base AS dependencies
ARG TARGETARCH
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/worker-dependencies.ts scripts/worker-image.json ./scripts/
COPY scripts/lib/worker-dependencies.ts ./scripts/lib/
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")" \
  && node scripts/worker-dependencies.ts . \
  && pnpm install --frozen-lockfile --prod --config.confirm-modules-purge=false \
  && arch="$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64)" \
  && for dir in node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
    find "$dir" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
    && find "$dir/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +; \
  done

FROM base
# lame encodes the speech as MP3; it comes from the distribution's packages.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends lame \
  && rm -rf /var/lib/apt/lists/*
# onnxruntime's Linux library would otherwise send usage telemetry to Microsoft.
ENV NODE_ENV=production ORT_DISABLE_TELEMETRY=1
WORKDIR /app
COPY --from=dependencies /build/node_modules ./node_modules
COPY --from=dependencies /build/package.json ./
# VERSION names the release in the User-Agent of the collection job's fetches.
COPY VERSION ./
COPY config ./config
COPY src ./src
# The node user of the base image; the files stay owned by root, so the process cannot change them.
USER node
# The image's lame must take the arguments the speech code gives it: a second of silence is
# encoded with the configured settings and has to read back as a constant-bitrate mono MP3 at
# the configured rate, with the AI voice comment. A build whose lame does not fails here.
RUN node --input-type=module --eval " \
  import { speechConfig } from './src/lib/config/speech-config.ts'; \
  import { configuredEncoder, readMp3 } from './src/features/speech/index.ts'; \
  const { encoding } = speechConfig; \
  const mp3 = readMp3(await configuredEncoder(speechConfig)(new Uint8Array(88200), 44100)); \
  const fits = mp3.comment === encoding.comment && mp3.channelMode === 'mono' \
    && mp3.sampleRateHz === encoding.sampleRateHz \
    && mp3.bitratesKbps.join() === String(encoding.bitrateKbps); \
  if (!fits) { console.error('lame wrote an unexpected MP3:', mp3); process.exit(1); } \
  console.log('lame writes', JSON.stringify(mp3));"
ENTRYPOINT ["node"]
