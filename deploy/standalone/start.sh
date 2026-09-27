#!/bin/sh
# Shipped as "Rally Gate.command" on macOS (double-clickable in Finder) and
# rally-gate.sh on Linux.
cd "$(dirname "$0")" && exec ./node app/start.js
