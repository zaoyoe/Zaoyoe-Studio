#!/usr/bin/env python3
"""Local desktop helper that scans CLI login state and returns sub2api-data JSON."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from typing import Any

import export_antigravity_accounts as antigravity_export
import export_claude_accounts as claude_export
import export_gemini_accounts as gemini_export


DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 32191


class BridgeError(Exception):
    """Human-readable bridge error."""


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Run a local helper on 127.0.0.1 so the admin page can scan local CLI "
            "login state and generate sub2api-data JSON with one click."
        )
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"Bind host. Default: {DEFAULT_HOST}.")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Bind port. Default: {DEFAULT_PORT}.")
    return parser.parse_args()


def _coerce_group_ids(raw: Any) -> list[int]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise BridgeError("group_ids must be an array of integers")
    out: list[int] = []
    for item in raw:
        if isinstance(item, bool):
            raise BridgeError("group_ids must contain integers")
        try:
            value = int(item)
        except (TypeError, ValueError) as exc:
            raise BridgeError("group_ids must contain integers") from exc
        out.append(value)
    return out


def _antigravity_skipped(stats: antigravity_export.ExportStats) -> int:
    return (
        stats.skipped_disabled
        + stats.skipped_missing_refresh_token
        + stats.skipped_invalid_json
        + stats.skipped_invalid_shape
    )


def _claude_skipped(stats: claude_export.ExportStats) -> int:
    return (
        stats.skipped_invalid_json
        + stats.skipped_invalid_shape
        + stats.skipped_missing_storage
        + stats.skipped_missing_claude_oauth
        + stats.skipped_missing_refresh_token
        + stats.skipped_duplicates
    )


def _gemini_skipped(stats: gemini_export.ExportStats) -> int:
    return (
        stats.skipped_invalid_json
        + stats.skipped_invalid_shape
        + stats.skipped_missing_storage
        + stats.skipped_missing_gemini_oauth
        + stats.skipped_missing_refresh_token
        + stats.skipped_duplicates
    )


def build_antigravity_response(body: dict[str, Any]) -> dict[str, Any]:
    args = SimpleNamespace(
        input_globs=body.get("input_globs"),
        name_prefix=str(body.get("name_prefix") or "antigravity"),
        notes_prefix=str(body.get("notes_prefix") or "Imported from local Antigravity cache"),
        concurrency=int(body.get("concurrency") or 10),
        priority=int(body.get("priority") or 1),
        rate_multiplier=float(body.get("rate_multiplier") or 1.0),
        group_ids=_coerce_group_ids(body.get("group_ids")),
        mixed_scheduling=bool(body.get("mixed_scheduling", True)),
        include_disabled=bool(body.get("include_disabled", False)),
        out=None,
        stdout=False,
        dry_run=False,
    )
    files = antigravity_export.expand_inputs(args.input_globs)
    if not files:
        raise BridgeError("No Antigravity cache files matched the provided input globs.")
    payload, stats = antigravity_export.build_payload(args, files)
    if stats.exported == 0:
        raise BridgeError("No exportable Antigravity accounts were found.")
    return {
        "payload": payload,
        "meta": {
            "source": "antigravity",
            "exported": stats.exported,
            "skipped": _antigravity_skipped(stats),
            "stats": asdict(stats),
        },
    }


def build_claude_response(body: dict[str, Any]) -> dict[str, Any]:
    args = SimpleNamespace(
        config_dirs=body.get("config_dirs"),
        config_dir_globs=body.get("config_dir_globs"),
        name_prefix=str(body.get("name_prefix") or claude_export.DEFAULT_NAME_PREFIX),
        notes_prefix=str(body.get("notes_prefix") or claude_export.DEFAULT_NOTES_PREFIX),
        concurrency=int(body.get("concurrency") or 10),
        priority=int(body.get("priority") or 1),
        rate_multiplier=float(body.get("rate_multiplier") or 1.0),
        oauth_suffix=str(body.get("oauth_suffix") or claude_export.default_oauth_suffix()),
        disable_keychain=bool(body.get("disable_keychain", False)),
        out=None,
        stdout=False,
        dry_run=False,
    )
    config_dirs = claude_export.expand_config_dirs(args.config_dirs, args.config_dir_globs)
    if not config_dirs:
        raise BridgeError("No Claude config directories matched the provided inputs.")
    payload, stats = claude_export.build_payload(args, config_dirs)
    if stats.exported == 0:
        raise BridgeError("No exportable Claude Code OAuth accounts were found.")
    return {
        "payload": payload,
        "meta": {
            "source": "claude",
            "exported": stats.exported,
            "skipped": _claude_skipped(stats),
            "stats": asdict(stats),
        },
    }


def build_gemini_response(body: dict[str, Any]) -> dict[str, Any]:
    args = SimpleNamespace(
        config_dirs=body.get("config_dirs"),
        config_dir_globs=body.get("config_dir_globs"),
        name_prefix=str(body.get("name_prefix") or gemini_export.DEFAULT_NAME_PREFIX),
        notes_prefix=str(body.get("notes_prefix") or gemini_export.DEFAULT_NOTES_PREFIX),
        concurrency=int(body.get("concurrency") or 10),
        priority=int(body.get("priority") or 1),
        rate_multiplier=float(body.get("rate_multiplier") or 1.0),
        group_ids=_coerce_group_ids(body.get("group_ids")),
        project_id=str(body.get("project_id") or ""),
        oauth_type=str(body.get("oauth_type") or "auto"),
        tier_id=str(body.get("tier_id") or ""),
        disable_keychain=bool(body.get("disable_keychain", False)),
        out=None,
        stdout=False,
        dry_run=False,
    )
    config_dirs = gemini_export.expand_config_dirs(args.config_dirs, args.config_dir_globs)
    if not config_dirs:
        raise BridgeError("No Gemini config directories matched the provided inputs.")
    payload, stats = gemini_export.build_payload(args, config_dirs)
    if stats.exported == 0:
        raise BridgeError("No exportable Gemini CLI OAuth accounts were found.")
    return {
        "payload": payload,
        "meta": {
            "source": "gemini",
            "exported": stats.exported,
            "skipped": _gemini_skipped(stats),
            "stats": asdict(stats),
        },
    }


def build_export_response(body: dict[str, Any]) -> dict[str, Any]:
    source = str(body.get("source") or "antigravity").strip().lower()
    if source == "antigravity":
        return build_antigravity_response(body)
    if source == "claude":
        return build_claude_response(body)
    if source == "gemini":
        return build_gemini_response(body)
    raise BridgeError("Unsupported source. Use 'antigravity', 'claude', or 'gemini'.")


class DesktopBridgeHandler(BaseHTTPRequestHandler):
    server_version = "sub2api-desktop-cli-bridge/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _write_json(self, status_code: int, payload: dict[str, Any]) -> None:
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(content)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self._write_json(200, {"ok": True})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            self._write_json(
                200,
                {
                    "ok": True,
                    "service": "desktop-cli-bridge",
                    "sources": ["antigravity", "claude", "gemini"],
                },
            )
            return
        self._write_json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/api/v1/local-cli/export":
            self._write_json(404, {"error": "Not found"})
            return

        content_length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(content_length) if content_length > 0 else b"{}"

        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self._write_json(400, {"error": "Request body must be valid JSON"})
            return

        if not isinstance(body, dict):
            self._write_json(400, {"error": "Request body must be a JSON object"})
            return

        try:
            response = build_export_response(body)
        except BridgeError as exc:
            self._write_json(400, {"error": str(exc)})
            return
        except Exception as exc:  # pragma: no cover - defensive guard
            self._write_json(500, {"error": f"Desktop helper failed: {exc}"})
            return

        self._write_json(200, response)


def main() -> int:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), DesktopBridgeHandler)
    print(
        f"Desktop CLI bridge listening on http://{args.host}:{args.port} "
        "(POST /api/v1/local-cli/export, GET /healthz)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nDesktop CLI bridge stopped.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
