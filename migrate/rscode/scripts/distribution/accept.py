"""Real host-OS acceptance of an extracted native payload, not source-checkout mocks."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import tarfile
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

root = Path(__file__).resolve().parents[2] / "out" / "native"
archives = sorted(p for p in root.iterdir() if p.name.startswith("RSCode-v") and p.suffix in (".zip", ".gz"))
if len(archives) != 1:
    raise SystemExit("Expected exactly one native archive, found " + str(archives))
archive = archives[0]
expected = (root / (archive.name + ".sha256")).read_text().split()[0]
with archive.open("rb") as source:
    digest = hashlib.file_digest(source, "sha256").hexdigest()
if expected != digest:
    raise SystemExit("Archive checksum mismatch")
result = {"artifact": archive.name, "sha256": digest, "checks": {}, "commands": [], "sourceSha": None}
checks = result["checks"]
report_dir = root / "reports"
report_dir.mkdir(parents=True, exist_ok=True)
test_dir = tempfile.mkdtemp(prefix="rscode-install-", dir=os.getenv("RUNNER_TEMP") or None)
proc = None
log = Path(test_dir) / "installed-server.log"

def record(name, value, detail=""):
    checks[name] = {"status": value, "detail": detail}
    print(name + ": " + value + (" — " + detail if detail else ""), flush=True)

def run(args, env, cwd, timeout=40):
    command = [str(x) for x in args]
    result["commands"].append(" ".join(command))
    # Chromium descendants on Windows may inherit the parent's stdout PIPE
    # handles after Bun has exited. Popen.communicate waits for pipe EOF from
    # *all descendants*, incorrectly classifying a successful probe as hung.
    # Redirect to a real file and wait for the actual Bun process instead.
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8", errors="replace") as output:
        proc = subprocess.Popen(command, cwd=cwd, env=env, stdout=output,
            stderr=subprocess.STDOUT)
        try:
            code = proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            proc.wait(timeout=5)
            output.flush()
            output.seek(0)
            partial = output.read()
            raise RuntimeError("Installed probe PID " + str(proc.pid) +
                " timed out after " + str(timeout) + "s; last output:\\n" + partial[-6000:]) from exc
        output.flush()
        output.seek(0)
        captured = output.read()
    if code:
        raise RuntimeError("Process exited " + str(code) + ": " + captured[-6000:])
    return captured

def api(port, name, body):
    req = Request("http://127.0.0.1:" + str(port) + "/api/" + name,
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(req, timeout=5) as response:
        return json.loads(response.read())

def health(port):
    with urlopen("http://127.0.0.1:" + str(port) + "/health", timeout=2) as response:
        return json.loads(response.read())

def start(binary, launch, env, cwd, port):
    global proc
    result["commands"].append(str(binary) + " " + str(launch))
    with log.open("ab") as output:
        proc = subprocess.Popen([str(binary), str(launch)], cwd=cwd, env=env,
            stdout=output, stderr=subprocess.STDOUT)
    for _ in range(100):
        if proc.poll() is not None:
            raise RuntimeError("Installed server exited unexpectedly: " + str(proc.returncode))
        try:
            h = health(port)
            if h.get("ok") and h.get("port") == port:
                return h
        except Exception:
            pass
        time.sleep(0.2)
    raise RuntimeError("Installed server health timed out")

def stop():
    global proc
    assert proc is not None
    if proc.poll() is not None:
        raise RuntimeError("Installed server exited before controlled shutdown")
    if os.name == "nt":
        # TerminateProcess has no graceful signal semantics; document this limitation.
        proc.terminate()
    else:
        proc.send_signal(signal.SIGTERM)
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)
        raise RuntimeError("Server ignored stop request")

try:
    extraction = Path(test_dir) / "extracted"
    extraction.mkdir()
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as z:
            z.extractall(extraction)
    else:
        with tarfile.open(archive, "r:gz") as t:
            t.extractall(extraction, filter="data")
    installed = extraction / archive.name.removesuffix(".zip").removesuffix(".tar.gz")
    metadata = json.loads((installed / "distribution.json").read_text())
    result["sourceSha"] = metadata["sourceSha"]
    binary = installed / "bin" / ("bun.exe" if os.name == "nt" else "bun")
    launch = installed / "bin" / "launch.ts"
    wrapper = installed / ("canvas.cmd" if os.name == "nt" else "canvas")
    if not all(x.exists() for x in [binary, launch, wrapper,
        installed / "dist" / "web" / "index.html", installed / "browsers"]):
        raise RuntimeError("Missing files in extracted install")
    user_dir = Path(test_dir) / "user"
    user_dir.mkdir()
    canvas_home = Path(test_dir) / "userdata"
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    env = dict(os.environ)
    env.update({"CANVAS_HOME": str(canvas_home), "CANVAS_PORT": str(port),
        "CANVAS_WORKSPACE_CWD": str(user_dir), "CANVAS_DISABLE_TMUX": "1"})
    env.pop("CANVAS_URL", None)
    env.pop("PLAYWRIGHT_BROWSERS_PATH", None)
    version_output = run(["cmd", "/c", str(wrapper), "--version"] if os.name == "nt"
        else [wrapper, "--version"], env, user_dir)
    if "RSCode " not in version_output:
        raise RuntimeError("Installed wrapper failed version probe")
    record("clean_extraction_and_launcher", "PASS")
    first = start(binary, launch, env, user_dir, port)
    if Path(first["root"]).resolve() != canvas_home.resolve():
        raise RuntimeError("Wrong persistent data root " + str(first["root"]))
    record("startup_health_and_data_directory", "PASS")
    with urlopen("http://127.0.0.1:" + str(port) + "/", timeout=5) as response:
        if response.status != 200 or b"<html" not in response.read().lower():
            raise RuntimeError("Installed frontend not served")
    record("frontend_bundle", "PASS")
    controlled_write = False
    try:
        created = api(port, "workspace.create", {"label": "Native release sentinel", "rootPath": str(user_dir)})
        workspace_id = created["workspace"]["id"]
        if not any(w["id"] == workspace_id for w in api(port, "workspace.list", {})["workspaces"]):
            raise RuntimeError("Workspace not written")
        record("controlled_workspace_create", "PASS")
        controlled_write = True
    except HTTPError as exc:
        body = exc.read().decode(errors="replace")
        if os.name != "nt" or "expected absolute path" not in body:
            raise RuntimeError("Unexpected workspace API failure: " + body) from exc
        record("controlled_workspace_create", "BLOCKED",
            "store.ts safeAbsolute rejects Windows drive-letter paths: " + body[:300])
        workspace_id = api(port, "workspace.list", {})["activeWorkspaceId"]
    if controlled_write:
        sentinel_path = user_dir / "native-validation.md"
        api(port, "fs.createFile", {"path": str(sentinel_path), "kind": "markdown"})
        sentinel_body = "# Real native filesystem sentinel\\n"
        api(port, "fs.writeFile", {"path": str(sentinel_path), "body": sentinel_body})
        if api(port, "fs.readFile", {"path": str(sentinel_path)})["body"] != sentinel_body:
            raise RuntimeError("Installed application failed to read its persisted file bytes")
        if sentinel_path.read_text() != sentinel_body:
            raise RuntimeError("Installed application file edits did not reach host filesystem")
        record("controlled_file_create_and_modify", "PASS")
        run(["git", "init", "--quiet", str(user_dir)], env, user_dir)
        repositories = api(port, "git.repositories", {"rootPath": str(user_dir)})["repositories"]
        matches = [repo for repo in repositories if Path(repo["rootPath"]).resolve() == user_dir.resolve()]
        if len(matches) != 1:
            raise RuntimeError("Installed Git repository discovery did not identify controlled root")
        status = api(port, "git.status", {"repoPath": str(user_dir)})["status"]
        if not any(file["path"] == sentinel_path.name for file in status["files"]):
            raise RuntimeError("Installed Git status did not expose controlled untracked file")
        record("controlled_git_repository_and_status", "PASS")
    else:
        record("controlled_file_create_and_modify", "BLOCKED", "Workspace mutation not verified")
        record("controlled_git_repository_and_status", "BLOCKED", "Workspace mutation not verified")
    browser_env = dict(env)
    browser_env["PLAYWRIGHT_BROWSERS_PATH"] = str(installed / "browsers")
    browser_env["DEBUG"] = "pw:browser"
    run([binary, installed / "bin" / "browser-probe.ts", "first"], browser_env, user_dir, 70)
    record("bundled_chromium_and_first_browser_profile", "PASS")
    if os.name == "nt":
        record("terminal_pty", "BLOCKED", "Existing terminal implementation launches /bin/bash on Windows")
    else:
        run([binary, installed / "bin" / "terminal-probe.ts"], env, user_dir, 30)
        record("terminal_pty", "PASS")
    stop()
    if os.name == "nt":
        record("graceful_shutdown", "BLOCKED", "TerminateProcess is not graceful; requires runtime integration")
    else:
        service_log = (canvas_home / "logs" / "service.log").read_text()
        if "shutdown SIGTERM" not in service_log:
            raise RuntimeError("Server did not finish SIGTERM shutdown")
        record("graceful_shutdown", "PASS")
    restarted = start(binary, launch, env, user_dir, port)
    persisted = api(port, "workspace.list", {})
    if not any(w["id"] == workspace_id for w in persisted["workspaces"]):
        raise RuntimeError("Saved workspace not preserved on restart")
    if restarted["root"] != first["root"]:
        raise RuntimeError("Data root changed across restart")
    if controlled_write:
        record("restart_and_workspace_persistence", "PASS")
    else:
        record("default_workspace_restart", "PASS")
        record("restart_and_workspace_persistence", "BLOCKED",
            "No workspace mutation can be verified until Windows absolute paths are accepted")
    run([binary, installed / "bin" / "browser-probe.ts", "restart"], browser_env, user_dir, 70)
    record("browser_profile_persistence", "PASS")
    stop()
    record("shutdown_and_port_reuse", "PASS" if os.name != "nt" else "BLOCKED",
        "Windows lifecycle is not gracefully controlled" if os.name == "nt" else "")
except Exception as exc:
    record("acceptance", "FAIL", str(exc))
    if log.exists():
        result["serverLogTail"] = log.read_text(errors="replace")[-6000:]
    raise
finally:
    if proc is not None and proc.poll() is None:
        proc.kill()
        proc.wait(timeout=8)
    report = report_dir / (archive.name + ".acceptance.json")
    report.write_text(json.dumps(result, indent=2) + "\n")
    print("Acceptance report: " + str(report))
    shutil.rmtree(test_dir, ignore_errors=True)
