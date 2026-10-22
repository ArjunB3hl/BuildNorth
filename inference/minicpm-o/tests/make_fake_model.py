"""Write a small synthetic model directory that passes runtime/preflight.py: every REQUIRED file, two fake shards, a
manifest with sizes and sha256 / git blob ids, and the completion marker. CPU tests only; no real weights.

    python tests/make_fake_model.py DIR REVISION
"""
import hashlib
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "runtime"))
import preflight  # noqa: E402

root, rev = sys.argv[1], sys.argv[2]
files = {p: (b"{}" if p.endswith(".json") else f"fake {p}\n".encode()) for p in preflight.REQUIRED}
files["model.safetensors.index.json"] = json.dumps({"weight_map": {"a": "model-00001-of-00002.safetensors",
                                                                   "b": "model-00002-of-00002.safetensors"}}).encode()
files["model-00001-of-00002.safetensors"] = b"x" * 1000
files["model-00002-of-00002.safetensors"] = b"y" * 2000
entries = []
for p, data in sorted(files.items()):
    os.makedirs(os.path.dirname(os.path.join(root, p)), exist_ok=True)
    with open(os.path.join(root, p), "wb") as f:
        f.write(data)
    if p.endswith(".safetensors"):
        entries.append({"path": p, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    else:
        entries.append({"path": p, "size": len(data),
                        "git_oid": hashlib.sha1(f"blob {len(data)}\0".encode() + data).hexdigest()})
os.makedirs(os.path.join(root, ".rhythm"), exist_ok=True)
with open(os.path.join(root, preflight.MANIFEST), "w") as f:
    json.dump({"schema": preflight.MANIFEST_SCHEMA, "model_id": "openbmb/MiniCPM-o-4_5", "revision": rev,
               "files": entries}, f)
with open(os.path.join(root, preflight.COMPLETE), "w") as f:
    json.dump({"revision": rev}, f)
