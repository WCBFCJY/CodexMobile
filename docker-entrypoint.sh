#!/bin/sh
set -e

# 确保运行时数据目录存在（卷可能是空挂载）
STATE_DIR="${CODEXMOBILE_HOME:-/app/.codexmobile/state}"
APP_STATE_ROOT="$(dirname "$STATE_DIR")"
mkdir -p "$STATE_DIR/default" \
         "$APP_STATE_ROOT/uploads" \
         "$APP_STATE_ROOT/generated" \
         "$APP_STATE_ROOT/tls"

# 确保工作目录存在（与配置目录分离）
WORKDIR="${CODEXMOBILE_WORKDIR:-/workspace}"
mkdir -p "$WORKDIR"

exec "$@"
