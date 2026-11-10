#!/bin/sh
# dsh-study-coach 安装器（macOS / Linux）
#   ./install.sh            只有一个 profile 就直接装
#   ./install.sh --profile desktop
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "找不到 node —— 先把 DSH 装好再回来跑这个脚本。"
  exit 1
fi

node install.mjs "$@"
