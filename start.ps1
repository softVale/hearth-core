$ErrorActionPreference = 'Stop'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw '没有找到 Docker。请先安装并启动 Docker Desktop：https://www.docker.com/products/docker-desktop/'
}
if (-not (Test-Path '.env')) {
  $token = ([guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N'))
  (Get-Content '.env.example' -Raw).Replace('change-me-before-public-use', $token) | Set-Content '.env' -Encoding utf8
  Write-Host '已创建 .env，并自动生成管理密钥。'
}
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw '启动失败。请确认 Docker Desktop 正在运行。' }
Write-Host 'Hearth Core 已启动：http://localhost:3520'
Write-Host '管理密钥保存在 .env 的 ADMIN_TOKEN 中，请勿公开。'
