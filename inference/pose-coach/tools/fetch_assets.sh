#!/usr/bin/env bash
# Fetch the pinned MediaPipe assets into web/vendor and web/models (not committed; checksums verified).
#   bash tools/fetch_assets.sh        (from inference/pose-coach)
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=1.1.0                                   # @mediapipe/tasks-vision, released 2026-10-06
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
(cd "$T" && npm pack -q "@mediapipe/tasks-vision@$VERSION" >/dev/null && tar -xzf "mediapipe-tasks-vision-$VERSION.tgz")
mkdir -p "web/vendor/tasks-vision-$VERSION" web/models
cp "$T/package/vision_bundle.mjs" "web/vendor/tasks-vision-$VERSION/"
rm -rf "web/vendor/tasks-vision-$VERSION/wasm" && cp -R "$T/package/wasm" "web/vendor/tasks-vision-$VERSION/"
for m in lite full heavy; do
  f="web/models/pose_landmarker_$m.task"
  [[ -f $f ]] || curl -sfL -o "$f" "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_$m/float16/1/pose_landmarker_$m.task"
done
(cd web/models && shasum -a 256 -c SHA256SUMS)
# three.js for the 3D form check (the person's rep on a 3D character): the core module and the add-ons it uses
THREE=0.170.0                                   # three, released 2024-10-31 (npm checks the package's integrity)
(cd "$T" && npm pack -q "three@$THREE" >/dev/null && tar -xzf "three-$THREE.tgz" && mv package three)
D="web/vendor/three-$THREE"
rm -rf "$D" && mkdir -p "$D/build" "$D/examples/jsm/loaders" "$D/examples/jsm/utils" "$D/examples/jsm/controls"
cp "$T/three/build/three.module.js" "$T/three/LICENSE" "$D/build/"
cp "$T/three/examples/jsm/loaders/GLTFLoader.js" "$D/examples/jsm/loaders/"
cp "$T/three/examples/jsm/utils/BufferGeometryUtils.js" "$T/three/examples/jsm/utils/SkeletonUtils.js" "$D/examples/jsm/utils/"
cp "$T/three/examples/jsm/controls/OrbitControls.js" "$D/examples/jsm/controls/"
# Kokoro-82M, the coach's local voice (web/js/kokoro-worker.js): kokoro-js's browser bundle (transformers.js 3.5.1 and
# the espeak-ng phonemizer inside; GPL-3.0 espeak: fine on this Mac, a licence question before serving it to others),
# the ONNX runtime it expects, its English voices, and the model at a pinned revision, all served from here
KOKORO=1.2.1                                    # kokoro-js, released 2025-05-03
TFJS=3.5.1                                      # @huggingface/transformers bundled in kokoro.web.js, 2025-05-03
KREV=1939ad2a8e416c0acfeecc08a694d14ef25f2231   # onnx-community/Kokoro-82M-v1.0-ONNX, 2025-02-08
(cd "$T" && npm pack -q "kokoro-js@$KOKORO" >/dev/null && mkdir k && tar -xzf "kokoro-js-$KOKORO.tgz" -C k)
(cd "$T" && npm pack -q "@huggingface/transformers@$TFJS" >/dev/null && mkdir tf && tar -xzf "huggingface-transformers-$TFJS.tgz" -C tf)
D="web/vendor/kokoro-js-$KOKORO"
rm -rf "$D" && mkdir -p "$D/voices" "$D/ort"
cp "$T/k/package/dist/kokoro.web.js" "$T/k/package/LICENSE" "$D/"
cp "$T"/k/package/voices/{a,b}[fm]_*.bin "$D/voices/"            # the English voices (American, British)
cp "$T/tf/package/dist/ort-wasm-simd-threaded.jsep.mjs" "$T/tf/package/dist/ort-wasm-simd-threaded.jsep.wasm" "$D/ort/"
cp "$T/tf/package/LICENSE" "$D/ort/LICENSE-transformers"
M=web/models/kokoro
mkdir -p "$M/onnx"
for f in config.json tokenizer.json tokenizer_config.json onnx/model.onnx; do
  [[ -f "$M/$f" ]] || curl -sfL -o "$M/$f" "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/$KREV/$f"
done
(cd "$M" && shasum -a 256 -c SHA256SUMS)
# ElevenLabs agents (web/js/eleven-coach.js): the browser client as one file, and the resampler worklet it would
# otherwise load from a CDN
ELEVEN=1.27.0                                   # @elevenlabs/client, released 2026-10-06
SRC=2.1.2                                       # @alexanderolsen/libsamplerate-js, the version the client names
(cd "$T" && npm pack -q "@elevenlabs/client@$ELEVEN" >/dev/null && mkdir el && tar -xzf "elevenlabs-client-$ELEVEN.tgz" -C el)
(cd "$T" && npm pack -q "@alexanderolsen/libsamplerate-js@$SRC" >/dev/null && mkdir sr && tar -xzf "alexanderolsen-libsamplerate-js-$SRC.tgz" -C sr)
D="web/vendor/elevenlabs-client-$ELEVEN"
rm -rf "$D" && mkdir -p "$D"
cp "$T/el/package/dist/lib.iife.js" "$T/el/package/LICENSE" "$D/"
cp "$T/sr/package/dist/libsamplerate.worklet.js" "$D/"
cp "$T/sr/package/LICENSE.md" "$D/LICENSE-libsamplerate" 2>/dev/null || cp "$T/sr/package/LICENSE" "$D/LICENSE-libsamplerate"
echo "f69a845935c3788ea46a73b09ead74640dfba5be135f225eac719df3a320c9cd  $D/lib.iife.js" | shasum -a 256 -c -
echo "assets ready: tasks-vision $VERSION, pose models lite/full/heavy, three $THREE, kokoro-js $KOKORO + Kokoro-82M," \
  "@elevenlabs/client $ELEVEN"
