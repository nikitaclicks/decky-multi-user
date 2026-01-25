#!/usr/bin/env bash
PROJECT_DIR="$(pwd)"
OUT_DIR="$PROJECT_DIR/out"
# Get plugin name from settings.json or default to a safe value
PLUGIN_NAME="decky-multi-user"

echo "Building plugin in $PROJECT_DIR"

# 1. Clean previous build
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR/$PLUGIN_NAME"

# 2. Build Frontend
echo "Running pnpm build..."
pnpm run build

# 3. Copy files to staging area
echo "Copying files..."
cp plugin.json "$OUT_DIR/$PLUGIN_NAME/"
cp package.json "$OUT_DIR/$PLUGIN_NAME/"
cp main.py "$OUT_DIR/$PLUGIN_NAME/"
if [ -f "README.md" ]; then cp README.md "$OUT_DIR/$PLUGIN_NAME/"; fi
if [ -f "LICENSE" ]; then cp LICENSE "$OUT_DIR/$PLUGIN_NAME/"; fi

# Copy directories if they exist
[ -d "dist" ] && cp -r dist "$OUT_DIR/$PLUGIN_NAME/"
[ -d "py_modules" ] && cp -r py_modules "$OUT_DIR/$PLUGIN_NAME/"
[ -d "assets" ] && cp -r assets "$OUT_DIR/$PLUGIN_NAME/"
[ -d "defaults" ] && cp -r defaults "$OUT_DIR/$PLUGIN_NAME/"
[ -d "bin" ] && cp -r bin "$OUT_DIR/$PLUGIN_NAME/"

# 4. Zip it up
echo "Creating zip package..."
cd "$OUT_DIR"
# Zip the directory, usually Decky CLI creates a zip with the folder inside
if command -v zip >/dev/null 2>&1; then
    zip -r "$PLUGIN_NAME.zip" "$PLUGIN_NAME"
else
    echo "zip command not found, trying tar..."
    tar -czf "$PLUGIN_NAME.zip" "$PLUGIN_NAME"
fi

echo "Build complete. Output: $OUT_DIR/$PLUGIN_NAME.zip"