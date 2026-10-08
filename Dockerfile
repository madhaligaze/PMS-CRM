# Веб Bizdin Auyl: сборка Vite и nginx, который отдаёт статику и проксирует
# /api на сервис API. Собирается из корня репозитория:
#   docker build -t bizdin-auyl-web .
# Запуск: API_UPSTREAM - адрес API без пути, PORT - порт веба (по умолчанию 80).
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@12.3.4 --activate
WORKDIR /app
# Только веб: у API свой lock-файл и свой образ (backend/Dockerfile).
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
# VITE_DEMO=true показывает на входе выбор демо-сотрудника (для презентаций).
ARG VITE_DEMO=false
ENV VITE_DEMO=$VITE_DEMO
RUN pnpm exec tsc -p tsconfig.json --noEmit && pnpm exec vite build

FROM nginx:1.29-alpine AS runtime
# Шаблон превращается в конфиг при старте: подставляются PORT, API_UPSTREAM и
# DNS-сервер контейнера (NGINX_LOCAL_RESOLVERS - по NGINX_ENTRYPOINT_LOCAL_RESOLVERS).
ENV PORT=80 \
    API_UPSTREAM=http://api:4000 \
    NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
RUN rm -f /etc/nginx/conf.d/default.conf
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" >/dev/null || exit 1
