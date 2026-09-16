# Retina, as a service rather than a terminal process.
#
# Built from the repo root so the indexer directory copies whole. Node 22 because
# envio 3.x ships a linux-x64 native binary and wants a current runtime.

FROM node:22-bookworm-slim

WORKDIR /app

# Install deps first so a code edit does not re-fetch the toolchain.
COPY indexer/package.json indexer/package-lock.json ./
RUN npm ci --omit=dev

# Then the indexer itself. .dockerignore keeps node_modules and .env out.
COPY indexer/ ./

# Fail at build time if the native binary is missing, rather than at 3am in a restart loop.
RUN test -x node_modules/envio/bin.mjs || test -f node_modules/envio/bin.mjs

EXPOSE 9899

# `start`, not `dev`: dev tries to manage its own Docker containers, which is exactly the
# behaviour that collided with the other project's stack. Compose owns the containers here.
CMD ["npx", "envio", "start"]
