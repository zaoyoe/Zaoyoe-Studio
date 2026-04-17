#!/usr/bin/env python3
"""Export local Antigravity account cache files into sub2api-data JSON."""

from __future__ import annotations

import argparse
import glob
import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DATA_TYPE = "sub2api-data"
DATA_VERSION = 1
DEFAULT_INPUT_GLOB = "~/.cli-proxy-api/antigravity-*.json"


@dataclass
class ExportStats:
    loaded: int = 0
    exported: int = 0
    skipped_disabled: int = 0
    skipped_missing_refresh_token: int = 0
    skipped_invalid_json: int = 0
    skipped_invalid_shape: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read local Antigravity cache files and emit a sub2api-data JSON file "
            "that can be imported from the admin Accounts page."
        )
    )
    parser.add_argument(
        "--input-glob",
        action="append",
        dest="input_globs",
        help=(
            "Glob for local Antigravity cache files. "
            f"Defaults to {DEFAULT_INPUT_GLOB!r}."
        ),
    )
    parser.add_argument(
        "--out",
        help=(
            "Output path for the generated JSON. "
            "Defaults to ./antigravity-sub2api-export-<timestamp>.json."
        ),
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
        help="Account concurrency to write into the export file. Default: 10.",
    )
    parser.add_argument(
        "--priority",
        type=int,
        default=1,
        help="Account priority to write into the export file. Default: 1.",
    )
    parser.add_argument(
        "--rate-multiplier",
        type=float,
        default=1.0,
        help="Account rate_multiplier to write into the export file. Default: 1.0.",
    )
    parser.add_argument(
        "--group-id",
        dest="group_ids",
        type=int,
        action="append",
        default=[],
        help=(
            "Optional group ID to bind exported/imported accounts to. Repeat this flag to "
            "attach multiple groups."
        ),
    )
    parser.add_argument(
        "--mixed-scheduling",
        dest="mixed_scheduling",
        action="store_true",
        default=True,
        help=(
            "Enable mixed_scheduling=true in exported account extra data so imported "
            "Antigravity accounts can join Gemini/Anthropic group scheduling. "
            "This is the default behavior."
        ),
    )
    parser.add_argument(
        "--no-mixed-scheduling",
        dest="mixed_scheduling",
        action="store_false",
        help="Do not write mixed_scheduling into exported account extra data.",
    )
    parser.add_argument(
        "--include-disabled",
        action="store_true",
        help="Include cache files marked as disabled.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Write the JSON payload to stdout instead of creating a file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and summarize what would be exported without writing JSON content.",
    )
    return parser.parse_args()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def default_output_path() -> Path:
    timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
    return Path.cwd() / f"antigravity-sub2api-export-{timestamp}.json"


def expand_inputs(input_globs: list[str] | None) -> list[Path]:
    patterns = input_globs or [DEFAULT_INPUT_GLOB]
    seen: set[Path] = set()
    files: list[Path] = []
    for pattern in patterns:
        for raw_path in sorted(glob.glob(str(Path(pattern).expanduser()))):
            path = Path(raw_path).expanduser().resolve()
            if path in seen or not path.is_file():
                continue
            seen.add(path)
            files.append(path)
    return files


def parse_expires_at(data: dict[str, Any]) -> str | None:
    raw_expired = data.get("expired")
    if isinstance(raw_expired, str) and raw_expired.strip():
        normalized = raw_expired.strip().replace("Z", "+00:00")
        try:
            return str(int(datetime.fromisoformat(normalized).timestamp()))
        except ValueError:
            pass

    raw_timestamp = data.get("timestamp")
    raw_expires_in = data.get("expires_in")
    if raw_timestamp is None or raw_expires_in is None:
        return None

    try:
        timestamp = float(raw_timestamp)
        expires_in = float(raw_expires_in)
    except (TypeError, ValueError):
        return None

    if timestamp > 1_000_000_000_000:
        timestamp /= 1000.0
    return str(int(timestamp + expires_in))


def load_cache_file(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("top-level JSON must be an object")
    return data


def build_account_name(name_prefix: str, email: str, index: int) -> str:
    base = email or f"account-{index}"
    prefix = name_prefix.strip()
    return f"{prefix} {base}".strip() if prefix else base


def build_note(notes_prefix: str, source_file: Path) -> str:
    prefix = notes_prefix.strip()
    suffix = f"source={source_file.name}"
    return f"{prefix}; {suffix}" if prefix else suffix


def build_credentials(data: dict[str, Any]) -> dict[str, Any]:
    credentials: dict[str, Any] = {}

    access_token = data.get("access_token")
    if isinstance(access_token, str) and access_token.strip():
        credentials["access_token"] = access_token.strip()

    refresh_token = data.get("refresh_token")
    if isinstance(refresh_token, str) and refresh_token.strip():
        credentials["refresh_token"] = refresh_token.strip()

    project_id = data.get("project_id")
    if isinstance(project_id, str) and project_id.strip():
        credentials["project_id"] = project_id.strip()

    email = data.get("email")
    if isinstance(email, str) and email.strip():
        credentials["email"] = email.strip()

    expires_at = parse_expires_at(data)
    if expires_at:
        credentials["expires_at"] = expires_at

    token_type = data.get("token_type")
    if isinstance(token_type, str) and token_type.strip():
        credentials["token_type"] = token_type.strip()
    elif "access_token" in credentials:
        credentials["token_type"] = "Bearer"

    return credentials


def build_payload(args: argparse.Namespace, files: list[Path]) -> tuple[dict[str, Any], ExportStats]:
    stats = ExportStats()
    accounts: list[dict[str, Any]] = []

    for index, path in enumerate(files, start=1):
        try:
            raw = load_cache_file(path)
        except json.JSONDecodeError:
            stats.skipped_invalid_json += 1
            continue
        except ValueError:
            stats.skipped_invalid_shape += 1
            continue

        stats.loaded += 1

        if bool(raw.get("disabled")) and not args.include_disabled:
            stats.skipped_disabled += 1
            continue

        credentials = build_credentials(raw)
        if "refresh_token" not in credentials:
            stats.skipped_missing_refresh_token += 1
            continue

        email = str(raw.get("email") or "").strip()
        account = {
            "name": build_account_name(args.name_prefix, email, index),
            "notes": build_note(args.notes_prefix, path),
            "platform": "antigravity",
            "type": "oauth",
            "credentials": credentials,
            "extra": {"mixed_scheduling": True} if args.mixed_scheduling else {},
            "group_ids": list(args.group_ids),
            "concurrency": args.concurrency,
            "priority": args.priority,
            "rate_multiplier": args.rate_multiplier,
        }
        accounts.append(account)
        stats.exported += 1

    payload = {
        "type": DATA_TYPE,
        "version": DATA_VERSION,
        "exported_at": utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "proxies": [],
        "accounts": accounts,
    }
    return payload, stats


def print_summary(stats: ExportStats, output_path: Path | None) -> None:
    destination = "stdout" if output_path is None else str(output_path)
    print(
        (
            f"Exported {stats.exported} account(s) "
            f"from {stats.loaded} readable cache file(s) -> {destination}"
        ),
        file=sys.stderr,
    )
    if stats.skipped_disabled:
        print(
            f"Skipped disabled accounts: {stats.skipped_disabled}",
            file=sys.stderr,
        )
    if stats.skipped_missing_refresh_token:
        print(
            f"Skipped missing refresh_token: {stats.skipped_missing_refresh_token}",
            file=sys.stderr,
        )
    if stats.skipped_invalid_json:
        print(
            f"Skipped invalid JSON files: {stats.skipped_invalid_json}",
            file=sys.stderr,
        )
    if stats.skipped_invalid_shape:
        print(
            f"Skipped invalid object files: {stats.skipped_invalid_shape}",
            file=sys.stderr,
        )


def main() -> int:
    args = parse_args()
    files = expand_inputs(args.input_globs)
    if not files:
        print("No Antigravity cache files matched the provided input globs.", file=sys.stderr)
        return 1

    payload, stats = build_payload(args, files)
    if stats.exported == 0:
        print("No exportable accounts were found.", file=sys.stderr)
        print_summary(stats, None if args.stdout else Path(args.out) if args.out else None)
        return 1

    if args.dry_run:
        print_summary(stats, None)
        return 0

    content = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    if args.stdout:
        sys.stdout.write(content)
        print_summary(stats, None)
        return 0

    output_path = Path(args.out).expanduser().resolve() if args.out else default_output_path()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(content, encoding="utf-8")
    print_summary(stats, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
