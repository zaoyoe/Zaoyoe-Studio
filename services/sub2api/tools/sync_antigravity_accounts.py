#!/usr/bin/env python3
"""Export local Antigravity cache accounts and import them into a sub2api admin panel."""

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
            "Export local Antigravity cache accounts and sync them directly to "
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
        "--input-glob",
        action="append",
        dest="input_globs",
        help=(
            "Glob for local Antigravity cache files. Repeat to export multiple "
            "cache locations."
        ),
    )
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Include cache files marked as disabled.",
    )
    parser.add_argument(
        "--name-prefix",
        default="antigravity",
        help="Prefix for generated account names. Use an empty string to keep only the email.",
    )
    parser.add_argument(
        "--notes-prefix",
        default="Imported from local Antigravity cache",
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
        "--mixed-scheduling",
        dest="mixed_scheduling",
        action="store_true",
        default=True,
        help=(
            "Enable mixed_scheduling=true in exported account extra data so synced "
            "Antigravity accounts can join Gemini/Anthropic group scheduling. "
            "This is the default behavior."
        ),
    )
    parser.add_argument(
        "--no-mixed-scheduling",
        dest="mixed_scheduling",
        action="store_false",
        help="Do not write mixed_scheduling into synced account extra data.",
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
    return Path(__file__).resolve().with_name("export_antigravity_accounts.py")


def build_export_command(args: argparse.Namespace) -> list[str]:
    cmd = [sys.executable, str(exporter_path()), "--stdout"]

    if args.input_globs:
        for pattern in args.input_globs:
            cmd.extend(["--input-glob", pattern])
    if args.include_disabled:
        cmd.append("--include-disabled")

    cmd.extend(["--name-prefix", args.name_prefix])
    cmd.extend(["--notes-prefix", args.notes_prefix])
    cmd.extend(["--concurrency", str(args.concurrency)])
    cmd.extend(["--priority", str(args.priority)])
    cmd.extend(["--rate-multiplier", str(args.rate_multiplier)])
    for group_id in args.group_ids:
        cmd.extend(["--group-id", str(group_id)])
    if not args.mixed_scheduling:
        cmd.append("--no-mixed-scheduling")
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
            raise SystemExit(f"Import failed: HTTP {exc.code}: {json.dumps(unwrapped, ensure_ascii=False)}")
        raise SystemExit(f"Import failed: HTTP {exc.code}: {body}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"Import failed: {exc}") from exc

    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Import response is not valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit("Import response is not a JSON object.")
    return unwrap_api_response(parsed)


def count_accounts(payload: dict[str, Any]) -> int:
    accounts = payload.get("accounts")
    return len(accounts) if isinstance(accounts, list) else 0


def print_import_summary(result: dict[str, Any], attempted_accounts: int) -> None:
    proxy_created = int(result.get("proxy_created") or 0)
    proxy_reused = int(result.get("proxy_reused") or 0)
    proxy_failed = int(result.get("proxy_failed") or 0)
    account_created = int(result.get("account_created") or 0)
    account_failed = int(result.get("account_failed") or 0)
    print(
        (
            f"Synced {attempted_accounts} exported account(s): "
            f"account_created={account_created}, account_failed={account_failed}, "
            f"proxy_created={proxy_created}, proxy_reused={proxy_reused}, proxy_failed={proxy_failed}"
        ),
        file=sys.stderr,
    )

    errors = result.get("errors")
    if isinstance(errors, list) and errors:
        print("Import errors:", file=sys.stderr)
        for item in errors:
            if not isinstance(item, dict):
                continue
            kind = str(item.get("kind") or "-")
            name = str(item.get("name") or item.get("proxy_key") or "-")
            message = str(item.get("message") or "Unknown error")
            print(f"  - {kind} {name}: {message}", file=sys.stderr)


def has_failures(result: dict[str, Any]) -> bool:
    return int(result.get("proxy_failed") or 0) > 0 or int(result.get("account_failed") or 0) > 0


def main() -> int:
    args = parse_args()
    ensure_auth(args)
    ensure_base_url(args)

    payload = run_export(args)
    attempted_accounts = count_accounts(payload)
    if attempted_accounts == 0:
        print("No exportable Antigravity accounts were found.", file=sys.stderr)
        return 1

    saved_path = maybe_save_export(payload, args.save_export)
    if saved_path is not None:
        print(f"Saved export snapshot to {saved_path}", file=sys.stderr)

    if args.dry_run:
        print(
            f"Prepared {attempted_accounts} Antigravity account(s) for import (dry run, no upload).",
            file=sys.stderr,
        )
        return 0

    result = post_import(args, payload)
    print_import_summary(result, attempted_accounts)
    if has_failures(result) and not args.allow_partial_success:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
