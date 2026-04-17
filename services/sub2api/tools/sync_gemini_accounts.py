#!/usr/bin/env python3
"""Export Gemini CLI OAuth accounts and import them into a sub2api admin panel."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


DEFAULT_TIMEOUT_SECONDS = 30


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Export local Gemini CLI OAuth accounts and sync them directly to "
            "a sub2api admin backend."
        )
    )
    parser.add_argument(
        "--admin-base-url",
        default=os.environ.get("SUB2API_ADMIN_BASE_URL", ""),
        help=(
            "sub2api base URL, for example https://sub2api.example.com or "
            "https://sub2api.example.com/api/v1. Defaults to $SUB2API_ADMIN_BASE_URL."
        ),
    )
    auth_group = parser.add_mutually_exclusive_group()
    auth_group.add_argument(
        "--admin-token",
        default=os.environ.get("SUB2API_ADMIN_TOKEN", ""),
        help="Admin JWT token. Defaults to $SUB2API_ADMIN_TOKEN.",
    )
    auth_group.add_argument(
        "--admin-api-key",
        default=os.environ.get("SUB2API_ADMIN_API_KEY", ""),
        help="Admin API key sent via x-api-key. Defaults to $SUB2API_ADMIN_API_KEY.",
    )
    parser.add_argument(
        "--config-dir",
        action="append",
        dest="config_dirs",
        help="Gemini config directory to export. Repeat to include multiple profiles.",
    )
    parser.add_argument(
        "--config-dir-glob",
        action="append",
        dest="config_dir_globs",
        help="Glob for multiple Gemini config directories, such as '~/.gemini-profiles/*'.",
    )
    parser.add_argument(
        "--project-id",
        default=os.environ.get("SUB2API_GEMINI_PROJECT_ID", ""),
        help="Optional Google Cloud project ID to write into exported credentials.",
    )
    parser.add_argument(
        "--oauth-type",
        default="auto",
        help="Gemini OAuth type to export. Use auto, code_assist, google_one, or ai_studio.",
    )
    parser.add_argument(
        "--tier-id",
        default=os.environ.get("SUB2API_GEMINI_TIER_ID", ""),
        help="Optional Gemini tier_id to include in exported credentials.",
    )
    parser.add_argument(
        "--disable-keychain",
        action="store_true",
        help="Skip macOS Keychain lookup and read only the encrypted gemini-credentials.json fallback.",
    )
    parser.add_argument(
        "--name-prefix",
        default="gemini",
        help="Prefix for generated account names. Use an empty string to keep only the detected label.",
    )
    parser.add_argument(
        "--notes-prefix",
        default="Imported from local Gemini CLI OAuth storage",
        help="Prefix for generated account notes.",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Account concurrency to write into the export payload. Default: 10.",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=1,
        help="Account priority to write into the export payload. Default: 1.",
    )
    parser.add_argument(
        "--rate-multiplier",
        type=float,
        default=1.0,
        help="Account rate_multiplier to write into the export payload. Default: 1.0.",
    )
    parser.add_argument(
        "--group-id",
        dest="group_ids",
        type=int,
        action="append",
        default=[],
        help=(
            "Optional group ID to bind synced accounts to. Repeat this flag to "
            "attach multiple groups."
        ),
    )
    parser.add_argument(
        "--save-export",
        help="Optional path to save the generated sub2api-data JSON before uploading.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"HTTP timeout in seconds. Default: {DEFAULT_TIMEOUT_SECONDS}.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only export and summarize accounts locally without uploading to sub2api.",
    )
    parser.add_argument(
        "--skip-default-group-bind",
        dest="skip_default_group_bind",
        action="store_true",
        default=True,
        help="Skip default group binding during import. This is the default behavior.",
    )
    parser.add_argument(
        "--bind-default-group",
        dest="skip_default_group_bind",
        action="store_false",
        help="Allow backend default group binding during import.",
    )
    parser.add_argument(
        "--allow-partial-success",
        action="store_true",
        help="Return exit code 0 even if the import response contains failed accounts or proxies.",
    )
    return parser.parse_args()


def ensure_auth(args: argparse.Namespace) -> None:
    if not args.admin_token and not args.admin_api_key and not args.dry_run:
        raise SystemExit(
            "Provide --admin-token or --admin-api-key, or set "
            "$SUB2API_ADMIN_TOKEN / $SUB2API_ADMIN_API_KEY."
        )


def ensure_base_url(args: argparse.Namespace) -> None:
    if args.dry_run:
        return
    if not args.admin_base_url.strip():
        raise SystemExit("Provide --admin-base-url or set $SUB2API_ADMIN_BASE_URL.")


def exporter_path() -> Path:
    return Path(__file__).resolve().with_name("export_gemini_accounts.py")


def build_export_command(args: argparse.Namespace) -> list[str]:
    cmd = [sys.executable, str(exporter_path()), "--stdout"]

    if args.config_dirs:
        for config_dir in args.config_dirs:
            cmd.extend(["--config-dir", config_dir])
    if args.config_dir_globs:
        for pattern in args.config_dir_globs:
            cmd.extend(["--config-dir-glob", pattern])
    if args.project_id:
        cmd.extend(["--project-id", args.project_id])
    if args.oauth_type:
        cmd.extend(["--oauth-type", args.oauth_type])
    if args.tier_id:
        cmd.extend(["--tier-id", args.tier_id])
    if args.disable_keychain:
        cmd.append("--disable-keychain")

    cmd.extend(["--name-prefix", args.name_prefix])
    cmd.extend(["--notes-prefix", args.notes_prefix])
    cmd.extend(["--concurrency", str(args.concurrency)])
    cmd.extend(["--priority", str(args.priority)])
    cmd.extend(["--rate-multiplier", str(args.rate_multiplier)])
    for group_id in args.group_ids:
        cmd.extend(["--group-id", str(group_id)])
    return cmd


def run_export(args: argparse.Namespace) -> dict[str, Any]:
    proc = subprocess.run(
        build_export_command(args),
        capture_output=True,
        text=True,
        check=False,
    )

    if proc.stderr:
        sys.stderr.write(proc.stderr)

    if proc.returncode != 0:
        raise SystemExit(proc.returncode)

    try:
        payload = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Failed to parse exporter JSON output: {exc}") from exc

    if not isinstance(payload, dict):
        raise SystemExit("Exporter output is not a JSON object.")
    return payload


def maybe_save_export(payload: dict[str, Any], raw_path: str | None) -> Path | None:
    if not raw_path:
        return None

    output_path = Path(raw_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output_path


def normalize_api_base_url(raw: str) -> str:
    stripped = raw.strip().rstrip("/")
    if not stripped:
        raise ValueError("empty base url")
    if stripped.endswith("/api/v1"):
        return stripped
    return stripped + "/api/v1"


def import_endpoint(base_url: str) -> str:
    return normalize_api_base_url(base_url) + "/admin/accounts/data"


def unwrap_api_response(payload: dict[str, Any]) -> dict[str, Any]:
    if "code" not in payload:
        return payload
    if payload.get("code") != 0:
        message = str(payload.get("message") or "Unknown API error")
        reason = payload.get("reason")
        if reason:
            raise SystemExit(f"{message} ({reason})")
        raise SystemExit(message)
    data = payload.get("data")
    if not isinstance(data, dict):
        raise SystemExit("API returned an unexpected success payload.")
    return data


def post_import(args: argparse.Namespace, payload: dict[str, Any]) -> dict[str, Any]:
    request_body = json.dumps(
        {
            "data": payload,
            "skip_default_group_bind": args.skip_default_group_bind,
        }
    ).encode("utf-8")

    request = urllib.request.Request(import_endpoint(args.admin_base_url), data=request_body, method="POST")
    request.add_header("Content-Type", "application/json")
    request.add_header("Accept", "application/json")

    if args.admin_api_key:
        request.add_header("x-api-key", args.admin_api_key)
    elif args.admin_token:
        request.add_header("Authorization", f"Bearer {args.admin_token}")

    try:
        with urllib.request.urlopen(request, timeout=args.timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            error_payload = json.loads(body)
        except json.JSONDecodeError:
            raise SystemExit(f"Import failed: HTTP {exc.code}: {body}") from exc
        if isinstance(error_payload, dict):
            unwrapped = unwrap_api_response(error_payload)
            raise SystemExit(json.dumps(unwrapped, ensure_ascii=False))
        raise SystemExit(f"Import failed: HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Import request failed: {exc}") from exc

    try:
        response_payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Import API did not return valid JSON: {body}") from exc

    if not isinstance(response_payload, dict):
        raise SystemExit("Import API returned a non-object JSON payload.")
    return unwrap_api_response(response_payload)


def print_import_summary(result: dict[str, Any]) -> None:
    print(
        (
            "Import summary: "
            f"account_created={result.get('account_created', 0)}, "
            f"account_failed={result.get('account_failed', 0)}, "
            f"proxy_created={result.get('proxy_created', 0)}, "
            f"proxy_reused={result.get('proxy_reused', 0)}, "
            f"proxy_failed={result.get('proxy_failed', 0)}"
        ),
        file=sys.stderr,
    )

    errors = result.get("errors")
    if isinstance(errors, list) and errors:
        print("Import errors:", file=sys.stderr)
        for item in errors:
            if not isinstance(item, dict):
                continue
            kind = item.get("kind", "unknown")
            name = item.get("name") or item.get("proxy_key") or "-"
            message = item.get("message") or "unknown error"
            print(f"  - {kind} {name}: {message}", file=sys.stderr)


def has_failures(result: dict[str, Any]) -> bool:
    return any(
        int(result.get(key, 0) or 0) > 0
        for key in ("account_failed", "proxy_failed")
    )


def main() -> int:
    args = parse_args()
    ensure_auth(args)
    ensure_base_url(args)

    payload = run_export(args)
    saved = maybe_save_export(payload, args.save_export)

    exported_accounts = payload.get("accounts", [])
    exported_count = len(exported_accounts) if isinstance(exported_accounts, list) else 0
    print(f"Prepared {exported_count} Gemini account(s) for sync.", file=sys.stderr)
    if saved is not None:
        print(f"Saved export snapshot to {saved}", file=sys.stderr)

    if args.dry_run:
        print("Dry run enabled; skipping upload.", file=sys.stderr)
        return 0

    result = post_import(args, payload)
    print_import_summary(result)

    if has_failures(result) and not args.allow_partial_success:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
