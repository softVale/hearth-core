#!/usr/bin/env sh
set -eu

if ! command -v docker >/dev/null 2>&1; then
  echo '没有找到 Docker。请先安装 Docker：https://docs.docker.com/get-docker/' >&2
  exit 1
fi
if [ ! -f .env ]; then
  token="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
  sed "s/change-me-before-public-use/$token/" .env.example > .env
  chmod 600 .env
  echo '已创建 .env，并自动生成管理密钥。'
fi
docker compose up -d --build
echo 'Hearth Core 已启动：http://localhost:3520'
echo '管理密钥保存在 .env 的 ADMIN_TOKEN 中，请勿公开。'
