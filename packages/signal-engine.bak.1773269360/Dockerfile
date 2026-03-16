FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src/ src/
RUN npx tsc

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist/ dist/
COPY --from=builder /app/node_modules/ node_modules/
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 9090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:9090/ || exit 1

CMD ["node", "dist/index.js"]
