#!/usr/bin/env python3
"""Build a macOS .app bundle for the sub2api desktop CLI bridge."""

from __future__ import annotations

import argparse
import plistlib
import shutil
import subprocess
import tempfile
import textwrap
from pathlib import Path


APP_NAME = "sub2api Desktop Helper"
DEFAULT_ICON_SOURCE = "frontend/public/logo.png"
SCRIPT_NAMES = [
    "desktop_cli_bridge.py",
    "export_antigravity_accounts.py",
    "export_claude_accounts.py",
    "export_gemini_accounts.py",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Package the local desktop CLI bridge as a macOS .app that can be "
            "double-clicked from Finder."
        )
    )
    parser.add_argument(
        "--out",
        help=(
            "Output path for the generated .app bundle. "
            f"Defaults to ./dist/{APP_NAME}.app"
        ),
    )
    parser.add_argument(
        "--icon",
        help=(
            "PNG icon source used to generate the app icon. "
            f"Defaults to {DEFAULT_ICON_SOURCE!r}."
        ),
    )
    return parser.parse_args()


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_output_path() -> Path:
    return repo_root() / "dist" / f"{APP_NAME}.app"


def run(cmd: list[str], **kwargs) -> None:
    subprocess.run(cmd, check=True, **kwargs)


def build_icon(icon_source: Path, resources_dir: Path) -> None:
    if not icon_source.is_file():
        return

    iconset_sizes = {
        "icon_16x16.png": 16,
        "icon_16x16@2x.png": 32,
        "icon_32x32.png": 32,
        "icon_32x32@2x.png": 64,
        "icon_128x128.png": 128,
        "icon_128x128@2x.png": 256,
        "icon_256x256.png": 256,
        "icon_256x256@2x.png": 512,
        "icon_512x512.png": 512,
        "icon_512x512@2x.png": 1024,
    }

    with tempfile.TemporaryDirectory(prefix="sub2api-iconset-") as tmp_dir:
        iconset_dir = Path(tmp_dir) / "AppIcon.iconset"
        iconset_dir.mkdir(parents=True, exist_ok=True)

        for filename, size in iconset_sizes.items():
            run(
                [
                    "/usr/bin/sips",
                    "-z",
                    str(size),
                    str(size),
                    str(icon_source),
                    "--out",
                    str(iconset_dir / filename),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

        try:
            run(
                [
                    "/usr/bin/iconutil",
                    "-c",
                    "icns",
                    str(iconset_dir),
                    "-o",
                    str(resources_dir / "applet.icns"),
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except subprocess.CalledProcessError:
            return


def launcher_script() -> str:
    return textwrap.dedent(
        """\
        #!/bin/zsh
        set -euo pipefail

        RESOURCE_DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
        BRIDGE_DIR="$RESOURCE_DIR/bridge"
        APP_SUPPORT_DIR="$HOME/Library/Application Support/sub2api-desktop-helper"
        LOG_DIR="$HOME/Library/Logs/sub2api-desktop-helper"
        PID_FILE="$APP_SUPPORT_DIR/helper.pid"
        LOG_FILE="$LOG_DIR/helper.log"
        HEALTH_URL="http://127.0.0.1:32191/healthz"
        PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || true)}"

        if [[ -z "$PYTHON_BIN" ]]; then
          /usr/bin/osascript -e 'display alert "sub2api Desktop Helper" message "python3 not found. Please install Python 3 first." as critical' >/dev/null 2>&1 || true
          exit 1
        fi

        mkdir -p "$APP_SUPPORT_DIR" "$LOG_DIR"

        if command -v curl >/dev/null 2>&1 && curl --silent --fail "$HEALTH_URL" >/dev/null 2>&1; then
          /usr/bin/osascript -e 'display notification "Desktop helper is already running on 127.0.0.1:32191." with title "sub2api Desktop Helper"' >/dev/null 2>&1 || true
          exit 0
        fi

        if [[ -f "$PID_FILE" ]]; then
          OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
          if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
            /usr/bin/osascript -e 'display notification "Desktop helper is already running on 127.0.0.1:32191." with title "sub2api Desktop Helper"' >/dev/null 2>&1 || true
            exit 0
          fi
          rm -f "$PID_FILE"
        fi

        nohup "$PYTHON_BIN" "$BRIDGE_DIR/desktop_cli_bridge.py" >"$LOG_FILE" 2>&1 &
        NEW_PID=$!
        echo "$NEW_PID" >"$PID_FILE"

        for _ in {1..15}; do
          sleep 0.2
          if command -v curl >/dev/null 2>&1 && curl --silent --fail "$HEALTH_URL" >/dev/null 2>&1; then
            /usr/bin/osascript -e 'display notification "Desktop helper started. You can now use one-click scan in the admin import dialog." with title "sub2api Desktop Helper"' >/dev/null 2>&1 || true
            exit 0
          fi
          if ! kill -0 "$NEW_PID" 2>/dev/null; then
            break
          fi
        done

        /usr/bin/osascript -e 'display notification "Desktop helper started in the background. Check ~/Library/Logs/sub2api-desktop-helper/helper.log if needed." with title "sub2api Desktop Helper"' >/dev/null 2>&1 || true
        exit 0
        """
    )


def write_launcher_executable(macos_dir: Path) -> None:
    launcher_path = macos_dir / "sub2api-desktop-helper"
    launcher_path.write_text(launcher_script(), encoding="utf-8")
    launcher_path.chmod(0o755)


def copy_bridge_scripts(resources_dir: Path) -> None:
    bridge_dir = resources_dir / "bridge"
    bridge_dir.mkdir(parents=True, exist_ok=True)

    tools_dir = repo_root() / "tools"
    for script_name in SCRIPT_NAMES:
        shutil.copy2(tools_dir / script_name, bridge_dir / script_name)

    start_script = bridge_dir / "start_helper.sh"
    start_script.write_text(
        textwrap.dedent(
            """\
            #!/bin/zsh
            set -euo pipefail

            RESOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
            MACOS_EXECUTABLE="$RESOURCE_DIR/../MacOS/sub2api-desktop-helper"
            exec "$MACOS_EXECUTABLE"
            """
        ),
        encoding="utf-8",
    )
    start_script.chmod(0o755)


def update_info_plist(app_path: Path) -> None:
    plist_path = app_path / "Contents" / "Info.plist"
    info = {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": APP_NAME,
        "CFBundleExecutable": "sub2api-desktop-helper",
        "CFBundleIconFile": "applet",
        "CFBundleIdentifier": "com.zaoyoe.sub2api.desktop-helper",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": APP_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
    }
    with plist_path.open("wb") as handle:
        plistlib.dump(info, handle)


def build_app(output_path: Path, icon_source: Path | None) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        shutil.rmtree(output_path)

    contents_dir = output_path / "Contents"
    macos_dir = contents_dir / "MacOS"
    resources_dir = output_path / "Contents" / "Resources"
    macos_dir.mkdir(parents=True, exist_ok=True)
    resources_dir.mkdir(parents=True, exist_ok=True)
    write_launcher_executable(macos_dir)
    copy_bridge_scripts(resources_dir)
    if icon_source is not None:
        build_icon(icon_source, resources_dir)
    update_info_plist(output_path)
    return output_path


def main() -> int:
    args = parse_args()
    output_path = Path(args.out).expanduser().resolve() if args.out else default_output_path()
    icon_source = Path(args.icon).expanduser().resolve() if args.icon else (repo_root() / DEFAULT_ICON_SOURCE)
    built_path = build_app(output_path, icon_source if icon_source.exists() else None)
    print(f"Built macOS app bundle at: {built_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
