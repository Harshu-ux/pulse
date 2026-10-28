# Build from the repo root so the local SDK can be copied in:
#   docker build -f demo-app/Dockerfile .
FROM node:22-alpine
WORKDIR /app
COPY sdk ./sdk
COPY demo-app/package*.json ./demo-app/
WORKDIR /app/demo-app
RUN npm install --omit=dev
COPY demo-app/index.js ./
USER node
CMD ["node", "index.js"]
