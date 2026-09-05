#!/usr/bin/env bash
# Собрать игру одной командой (Linux / macOS).
set -e
cd "$(dirname "$0")/.."
python3 roblox-devsim/tools/build_place.py "$@"
