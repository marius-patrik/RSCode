"""Deterministic native archives, using only Python 3.12 standard-library tools."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import zipfile

root = Path(__file__).resolve().parents[2] / "out" / "native"
stages = sorted(p for p in root.iterdir() if p.is_dir() and p.name.startswith("RSCode-v"))
if len(stages) != 1:
    raise SystemExit("Expected exactly one native staging tree, found: " + str(stages))
stage = stages[0]
meta = json.loads((stage / "distribution.json").read_text())
paths = [stage] + sorted(stage.rglob("*"), key=lambda p: p.relative_to(stage).as_posix())
extension = ".zip" if meta["platform"] == "win32" else ".tar.gz"
archive = root / (stage.name + extension)
if extension == ".zip":
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as z:
        for path in paths:
            name = path.relative_to(stage.parent).as_posix()
            if path.is_dir():
                name += "/"
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = ((0o40755 if path.is_dir() else 0o100644) << 16)
            entry.compress_type = zipfile.ZIP_DEFLATED
            if path.is_dir():
                z.writestr(entry, b"")
            elif path.is_symlink():
                raise SystemExit("Windows distribution has unsupported symlink: " + str(path))
            else:
                with path.open("rb") as source, z.open(entry, "w", force_zip64=True) as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
else:
    with archive.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=6) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as tar:
                for path in paths:
                    info = tar.gettarinfo(str(path), arcname=path.relative_to(stage.parent).as_posix())
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mtime = 0
                    if info.isfile():
                        with path.open("rb") as source:
                            tar.addfile(info, source)
                    else:
                        tar.addfile(info)
with archive.open("rb") as source:
    digest = hashlib.file_digest(source, "sha256").hexdigest()
(root / (archive.name + ".sha256")).write_text(digest + "  " + archive.name + "\n")
print(json.dumps({"archive": str(archive), "sha256": digest, "sourceSha": meta["sourceSha"], "platform": meta["platform"], "arch": meta["arch"]}, indent=2))
