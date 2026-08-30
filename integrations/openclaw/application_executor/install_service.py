"""Install the macOS worker LaunchAgent in safe mode (never enables live)."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

LABEL = "ai.auto-resume.executor"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--discord-user-id", required=True)
    parser.add_argument("--discord-channel-id", required=True)
    args = parser.parse_args()
    if sys.platform != "darwin" or not all(value.isdigit() for value in (args.discord_user_id, args.discord_channel_id)):
        parser.error("Requires macOS and numeric Discord IDs")
    openclaw = shutil.which("openclaw")
    if not openclaw:
        parser.error("openclaw must be installed and on PATH")
    root = Path(__file__).resolve().parents[3]
    state = Path.home() / ".openclaw" / "auto-resume-executor"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    if plist.exists():
        parser.error(f"Service already exists; inspect it before replacing: {plist}")
    os.umask(0o077)
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    plist.parent.mkdir(parents=True, exist_ok=True)
    command = [sys.executable, "-u", "-m", "integrations.openclaw.application_executor.worker",
        "--loop", "--discord-user-id", args.discord_user_id,
        "--discord-channel-id", args.discord_channel_id, "--state-dir", str(state)]
    config = {"Label": LABEL, "ProgramArguments": command,
        "WorkingDirectory": str(root), "RunAtLoad": True, "KeepAlive": True,
        "ThrottleInterval": 30, "EnvironmentVariables": {
            "PATH": os.pathsep.join(dict.fromkeys([str(Path(openclaw).parent), *os.environ.get("PATH", "").split(os.pathsep)]))},
        "StandardOutPath": str(state / "worker.log"), "StandardErrorPath": str(state / "worker-error.log")}
    with plist.open("xb") as output:
        plistlib.dump(config, output)
    os.chmod(plist, 0o600)
    subprocess.run(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)], check=True)
    print(f"Installed {LABEL} in safe mode. Queued real applications are not claimed.")


if __name__ == "__main__":
    main()
