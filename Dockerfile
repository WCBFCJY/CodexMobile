# syntax=docker/dockerfile:1

# ---------- Stage 1: Build PWA ----------
FROM node:24-trixie-slim AS builder

WORKDIR /app

# 先复制 package 文件和 scripts（postinstall 需要 scripts/patch-codex-sdk.mjs）
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/

RUN npm ci

# 复制源码并构建前端
COPY client/ ./client/
COPY server/ ./server/
COPY shared/ ./shared/

RUN npm run build

# ---------- Stage 2: Runtime ----------
FROM node:24-trixie-slim AS runtime

WORKDIR /app

# 运行时系统依赖：
#   git             — Codex 项目检测/会话需要
#   ca-certificates  — HTTPS 请求
#   openssl         — 可选的自签名证书生成
#   python3 + pip   — Codex 执行 Python 任务需要
#   curl, jq, wget  — 网络请求与 JSON 处理
#   build-essential — 部分依赖需要编译
#   ffmpeg          — 音视频处理/转码
#   sqlite3         — 轻量数据库操作
#   unzip, zip      — 压缩/解压
#   nano            — 文本编辑器
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git ca-certificates openssl tmux \
        python3 python3-pip python3-venv \
        curl jq wget \
        build-essential \
        ffmpeg sqlite3 \
        unzip zip tree \
        nano file less \
        bubblewrap htop \
        ripgrep procps yq \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python \
    && rm -f /usr/lib/python3*/EXTERNALLY-MANAGED

# 复制 package 文件和 scripts，安装生产依赖（postinstall 会 patch codex-sdk）
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/
RUN npm ci --omit=dev

# 全局安装 codex CLI（供手动使用，生成项目记录等）
RUN npm install -g @openai/codex

# 复制构建产物和运行时文件
COPY --from=builder /app/client/dist ./client/dist
COPY client/public/ ./client/public/
COPY server/ ./server/
COPY shared/ ./shared/
COPY docker-entrypoint.sh ./

RUN chmod +x docker-entrypoint.sh

# 创建数据目录
# /app/.codex           — Codex 配置（config.toml 等），外部映射
# /app/.codexmobile/*   — CodexMobile 自身状态/配置，配置目录（/app 不变）
#   state/              — 状态文件
#   state/default/      — 默认工作目录（fallback，无项目时使用）
#   uploads/            — 上传文件
#   generated/          — 生成文件
#   tls/                — TLS 证书
# /workspace            — 工作目录，Codex 项目代码存放处，与配置目录分离
RUN mkdir -p /app/.codex \
             /app/.codexmobile/state/default \
             /app/.codexmobile/uploads \
             /app/.codexmobile/generated \
             /app/.codexmobile/tls \
             /workspace/Default \
    && touch /app/.env

# 默认环境变量
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3321 \
    HTTPS_PORT=3443 \
    CODEX_HOME=/app/.codex \
    CODEXMOBILE_HOME=/app/.codexmobile/state \
    CODEXMOBILE_WORKDIR=/workspace

EXPOSE 3321

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "--env-file=/app/.env", "server/index.js"]
