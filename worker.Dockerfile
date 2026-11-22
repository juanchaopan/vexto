# The one image of the Cloud Run job vexto-collect and the services vexto-tts and
# vexto-billing-guard. Node runs the TypeScript entries in src/worker/ directly; each Cloud Run
# resource picks its entry with its args, for example `src/worker/tts.ts`. The speech model is
# not in the image: Cloud Run mounts the model bucket and MODEL_DIR names the model's directory.
#
# The base image is the Node.js version of .nvmrc, pinned by digest; Renovate updates both.
# Layers go from the least to the most often changed, so consecutive images can share the system
# packages and, while the lockfile stays the same, the dependencies.
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base

# Production dependencies only, installed from the lockfile with the pnpm version of
# packageManager. Install scripts follow allowBuilds in pnpm-workspace.yaml. onnxruntime-node
# ships its native library for every platform; only the image's own is kept.
FROM base AS dependencies
ARG TARGETARCH
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN npm install --global --no-fund --no-audit "$(node -p "require('./package.json').packageManager")" \
  && pnpm install --frozen-lockfile --prod --config.confirm-modules-purge=false \
  && arch="$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64)" \
  && for dir in node_modules/.pnpm/onnxruntime-node@*/node_modules/onnxruntime-node/bin/napi-v*; do \
    find "$dir" -mindepth 1 -maxdepth 1 ! -name linux -exec rm -rf {} + \
    && find "$dir/linux" -mindepth 1 -maxdepth 1 ! -name "$arch" -exec rm -rf {} +; \
  done

FROM base
# ffmpeg encodes the speech as MP3; it comes from the distribution's packages.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /build/node_modules ./node_modules
COPY package.json ./
COPY config ./config
COPY src ./src
# The node user of the base image; the files stay owned by root, so the process cannot change them.
USER node
ENTRYPOINT ["node"]
