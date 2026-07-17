#!/bin/bash

set -euo pipefail

APP_PATH='/Applications/Axiomate.app'
BINARY_PATH="$APP_PATH/Contents/MacOS/axiomate"
BIN_DIR='/usr/local/bin'
LINK_PATH="$BIN_DIR/axiomate"

echo ''
echo 'Axiomate CLI installer'
echo ''

if [[ ! -d "$APP_PATH" ]]; then
  echo 'Axiomate.app is not installed in /Applications.' >&2
  echo 'Drag Axiomate.app to Applications, then run this installer again.' >&2
  exit 1
fi

if [[ ! -x "$BINARY_PATH" ]]; then
  echo "Axiomate executable is missing or not executable: $BINARY_PATH" >&2
  exit 1
fi

if [[ -e "$LINK_PATH" && ! -L "$LINK_PATH" ]]; then
  echo "Cannot install the CLI because a non-link file already exists: $LINK_PATH" >&2
  exit 1
fi

if [[ -L "$LINK_PATH" && "$(readlink "$LINK_PATH")" == "$BINARY_PATH" ]]; then
  echo "Already installed: $LINK_PATH"
  exit 0
fi

if [[ ! -d "$BIN_DIR" ]]; then
  if ! mkdir -p "$BIN_DIR" 2>/dev/null; then
    echo "Administrator permission is required to create $BIN_DIR."
    sudo mkdir -p "$BIN_DIR"
  fi
fi

if ! ln -sfn "$BINARY_PATH" "$LINK_PATH" 2>/dev/null; then
  echo "Administrator permission is required to install $LINK_PATH."
  sudo ln -sfn "$BINARY_PATH" "$LINK_PATH"
fi

echo ''
echo "Installed: $LINK_PATH -> $BINARY_PATH"
echo 'Open a new terminal and run: axiomate --version'
echo ''
