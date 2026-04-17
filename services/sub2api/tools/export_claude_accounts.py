#!/usr/bin/env python3
"""Export local Claude Code OAuth storage into sub2api-data JSON."""

from __future__ import annotations

import argparse
import getpass
import glob
import hashlib
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DATA_TYPE = "sub2api-data"
DATA_VERSION = 1
DEFAULT_NAME_PREFIX = "claude"
DEFAULT_NOTES_PREFIX = "Imported from local Claude Code OAuth storage"


@dataclass
class ExportStats:
    scanned_config_dirs: int = 0
    loaded_credentials: int = 0
    exported: int = 0
    keychain_hits: int = 0
    plaintext_hits: int = 0
    skipped_invalid_json: int = 0
    skipped_invalid_shape: int = 0
    skipped_missing_storage: int = 0
    skipped_missing_claude_oauth: int = 0
    skipped_missing_refresh_token: int = 0
    skipped_duplicates: int = 0


@dataclass
class SourceRecord:
    config_dir: Path
    credentials: dict[str, Any]
    credentials_source: str
    metadata: dict[str, Any]
    metadata_path: Path | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read local Claude Code OAuth storage and emit a sub2api-data JSON file "
            "that can be imported from the admin Accounts page."
        )
    )
    parser.add_argument(
        "--config-dir",
        action="append",
        dest="config_dirs",
        help=(
            "Claude config directory to scan. Repeat this flag to export multiple "
            "Claude Code profiles. Defaults to $CLAUDE_CONFIG_DIR or ~/.claude."
        ),
    )
    parser.add_argument(
        "--config-dir-glob",
        action="append",
        dest="config_dir_globs",
        help=(
            "Glob that expands to multiple Claude config directories, such as "
            "'~/.claude-profiles/*'."
        ),
    )
    parser.add_argument(
        "--out",
        help=(
            "Output path for the generated JSON. "
            "Defaults to ./claude-sub2api-export-<timestamp>.json."
        ),
    )
    parser.add_argument(
        "--name-prefix",
        default=DEFAULT_NAME_PREFIX,
        help="Prefix for generated account names. Use an empty string to keep only the detected label.",
    )
    parser.add_argument(
        "--notes-prefix",
        default=DEFAULT_NOTES_PREFIX,
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
        "--oauth-suffix",
        default=default_oauth_suffix(),
        help=(
            "OAuth file suffix used by Claude Code storage. Defaults to '' and "
            "auto-switches to '-custom-oauth' when CLAUDE_CODE_OAUTH_CLIENT_ID is set."
        ),
    )
    parser.add_argument(
        "--disable-keychain",
        action="store_true",
        help="Skip macOS Keychain lookup and read only plaintext credential files.",
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


def default_oauth_suffix() -> str:
    return "-custom-oauth" if os.environ.get("CLAUDE_CODE_OAUTH_CLIENT_ID") else ""


def default_config_dir() -> Path:
    raw = os.environ.get("CLAUDE_CONFIG_DIR") or str(Path.home() / ".claude")
    return normalize_path(raw)


def normalize_path(raw_path: str | Path) -> Path:
    return Path(raw_path).expanduser().resolve(strict=False)


def default_output_path() -> Path:
    timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
    return Path.cwd() / f"claude-sub2api-export-{timestamp}.json"


def expand_config_dirs(
    config_dirs: list[str] | None,
    config_dir_globs: list[str] | None,
) -> list[Path]:
    explicit_dirs = config_dirs or []
    glob_patterns = config_dir_globs or []

    paths: list[Path] = []
    seen: set[Path] = set()

    if not explicit_dirs and not glob_patterns:
        path = default_config_dir()
        return [path]

    for raw in explicit_dirs:
        path = normalize_path(raw)
        if path in seen:
            continue
        seen.add(path)
        paths.append(path)

    for pattern in glob_patterns:
        for match in sorted(glob.glob(str(Path(pattern).expanduser()))):
            path = normalize_path(match)
            if path in seen:
                continue
            seen.add(path)
            paths.append(path)

    return paths


def load_json_object(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError("top-level JSON must be an object")
    return data


def keychain_account_name() -> str:
    try:
        user = os.environ.get("USER") or getpass.getuser()
    except Exception:
        user = ""
    return user or "claude-code-user"


def keychain_service_names(config_dir: Path, oauth_suffix: str) -> list[str]:
    base = f"Claude Code{oauth_suffix}-credentials"
    names = [base]

    if config_dir != normalize_path(Path.home() / ".claude"):
        digest = hashlib.sha256(str(config_dir).encode("utf-8")).hexdigest()[:8]
        names.insert(0, f"{base}-{digest}")

    return names


def decode_keychain_payload(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        raise ValueError("empty keychain payload")

    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError("top-level JSON must be an object")
        return data
    except json.JSONDecodeError:
        pass

    if len(text) % 2 != 0:
        raise ValueError("keychain payload is not valid JSON or hex JSON")

    try:
        decoded = bytes.fromhex(text).decode("utf-8")
    except ValueError as exc:
        raise ValueError("keychain payload is not valid hex") from exc

    data = json.loads(decoded)
    if not isinstance(data, dict):
        raise ValueError("top-level JSON must be an object")
    return data


def read_keychain_credentials(config_dir: Path, oauth_suffix: str) -> tuple[dict[str, Any], str] | None:
    if sys.platform != "darwin":
        return None

    account = keychain_account_name()
    for service in keychain_service_names(config_dir, oauth_suffix):
        try:
            proc = subprocess.run(
                [
                    "security",
                    "find-generic-password",
                    "-a",
                    account,
                    "-w",
                    "-s",
                    service,
                ],
                capture_output=True,
                text=True,
                check=False,
                timeout=5,
            )
        except (OSError, subprocess.SubprocessError):
            return None

        if proc.returncode != 0 or not proc.stdout.strip():
            continue

        payload = decode_keychain_payload(proc.stdout)
        return payload, f"keychain:{service}"

    return None


def read_plaintext_credentials(config_dir: Path) -> tuple[dict[str, Any], str] | None:
    path = config_dir / ".credentials.json"
    if not path.is_file():
        return None
    return load_json_object(path), f"plaintext:{path}"


def metadata_candidates(config_dir: Path, oauth_suffix: str) -> list[Path]:
    candidates: list[Path] = []
    local_config = config_dir / ".config.json"
    candidates.append(local_config)

    default_dir = normalize_path(Path.home() / ".claude")
    metadata_name = f".claude{oauth_suffix}.json"
    if config_dir == default_dir:
        candidates.append(Path.home() / metadata_name)
        candidates.append(config_dir / metadata_name)
    else:
        candidates.append(config_dir / metadata_name)

    deduped: list[Path] = []
    seen: set[Path] = set()
    for candidate in candidates:
        normalized = normalize_path(candidate)
        if normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def load_metadata(config_dir: Path, oauth_suffix: str) -> tuple[dict[str, Any], Path | None]:
    for path in metadata_candidates(config_dir, oauth_suffix):
        if not path.is_file():
            continue
        try:
            return load_json_object(path), path
        except (json.JSONDecodeError, ValueError):
            return {}, None
    return {}, None


def load_source_record(config_dir: Path, args: argparse.Namespace) -> tuple[SourceRecord | None, str]:
    if not args.disable_keychain:
        result = read_keychain_credentials(config_dir, args.oauth_suffix)
        if result is not None:
            credentials, source = result
            metadata, metadata_path = load_metadata(config_dir, args.oauth_suffix)
            return SourceRecord(config_dir, credentials, source, metadata, metadata_path), "keychain"

    result = read_plaintext_credentials(config_dir)
    if result is not None:
        credentials, source = result
        metadata, metadata_path = load_metadata(config_dir, args.oauth_suffix)
        return SourceRecord(config_dir, credentials, source, metadata, metadata_path), "plaintext"

    return None, "missing"


def normalize_expires_at(raw_value: Any) -> str | None:
    if raw_value is None:
        return None

    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        if not stripped:
            return None
        if stripped.isdigit():
            value = int(stripped)
            if value > 1_000_000_000_000:
                value //= 1000
            return str(value)
        normalized = stripped.replace("Z", "+00:00")
        try:
            return str(int(datetime.fromisoformat(normalized).timestamp()))
        except ValueError:
            return None

    if isinstance(raw_value, (int, float)):
        value = int(raw_value)
        if value > 1_000_000_000_000:
            value //= 1000
        return str(value)

    return None


def normalize_scope(raw_value: Any) -> str | None:
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        return stripped or None
    if isinstance(raw_value, list):
        scopes = [str(item).strip() for item in raw_value if str(item).strip()]
        if scopes:
            return " ".join(scopes)
    return None


def get_oauth_account(metadata: dict[str, Any]) -> dict[str, Any]:
    oauth_account = metadata.get("oauthAccount")
    return oauth_account if isinstance(oauth_account, dict) else {}


def first_non_empty(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
    return ""


def build_credentials(record: SourceRecord) -> dict[str, Any]:
    data = record.credentials
    oauth = data.get("claudeAiOauth")
    if not isinstance(oauth, dict):
        return {}

    oauth_account = get_oauth_account(record.metadata)
    credentials: dict[str, Any] = {}

    access_token = first_non_empty(oauth.get("accessToken"))
    if access_token:
        credentials["access_token"] = access_token

    refresh_token = first_non_empty(oauth.get("refreshToken"))
    if refresh_token:
        credentials["refresh_token"] = refresh_token

    token_type = first_non_empty(oauth.get("tokenType"))
    if token_type:
        credentials["token_type"] = token_type
    elif access_token:
        credentials["token_type"] = "Bearer"

    expires_at = normalize_expires_at(oauth.get("expiresAt"))
    if expires_at:
        credentials["expires_at"] = expires_at

    scope = normalize_scope(oauth.get("scopes") or oauth.get("scope"))
    if scope:
        credentials["scope"] = scope

    org_uuid = first_non_empty(oauth_account.get("organizationUuid"))
    if org_uuid:
        credentials["org_uuid"] = org_uuid

    account_uuid = first_non_empty(oauth_account.get("accountUuid"))
    if account_uuid:
        credentials["account_uuid"] = account_uuid

    email_address = first_non_empty(oauth_account.get("emailAddress"))
    if email_address:
        credentials["email_address"] = email_address

    claude_user_id = first_non_empty(
        oauth_account.get("userUuid"),
        oauth_account.get("userUUID"),
        oauth_account.get("userId"),
        oauth_account.get("userID"),
        oauth_account.get("claudeUserId"),
        oauth_account.get("anthropicUserId"),
    )
    if claude_user_id:
        credentials["claude_user_id"] = claude_user_id

    return credentials


def build_extra(record: SourceRecord) -> dict[str, Any]:
    oauth_account = get_oauth_account(record.metadata)
    extra: dict[str, Any] = {}

    org_uuid = first_non_empty(oauth_account.get("organizationUuid"))
    if org_uuid:
        extra["org_uuid"] = org_uuid

    account_uuid = first_non_empty(oauth_account.get("accountUuid"))
    if account_uuid:
        extra["account_uuid"] = account_uuid

    email_address = first_non_empty(oauth_account.get("emailAddress"))
    if email_address:
        extra["email_address"] = email_address

    claude_user_id = first_non_empty(
        oauth_account.get("userUuid"),
        oauth_account.get("userUUID"),
        oauth_account.get("userId"),
        oauth_account.get("userID"),
        oauth_account.get("claudeUserId"),
        oauth_account.get("anthropicUserId"),
    )
    if claude_user_id:
        extra["claude_user_id"] = claude_user_id

    return extra


def build_account_name(name_prefix: str, record: SourceRecord, index: int) -> str:
    oauth_account = get_oauth_account(record.metadata)
    label = first_non_empty(
        oauth_account.get("emailAddress"),
        oauth_account.get("displayName"),
        oauth_account.get("accountLabel"),
    )
    if not label:
        label = record.config_dir.name or f"account-{index}"

    prefix = name_prefix.strip()
    return f"{prefix} {label}".strip() if prefix else label


def build_note(notes_prefix: str, record: SourceRecord) -> str:
    parts: list[str] = []
    prefix = notes_prefix.strip()
    if prefix:
        parts.append(prefix)

    parts.append(f"config_dir={record.config_dir}")
    parts.append(f"credentials={record.credentials_source}")
    if record.metadata_path is not None:
        parts.append(f"metadata={record.metadata_path}")
    return "; ".join(parts)


def dedupe_key(credentials: dict[str, Any], extra: dict[str, Any], config_dir: Path) -> str:
    refresh_token = str(credentials.get("refresh_token") or "").strip()
    if refresh_token:
        digest = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        return f"refresh:{digest}"

    account_uuid = str(extra.get("account_uuid") or credentials.get("account_uuid") or "").strip()
    if account_uuid:
        return f"account:{account_uuid}"

    email = str(extra.get("email_address") or credentials.get("email_address") or "").strip().lower()
    if email:
        return f"email:{email}"

    return f"config:{config_dir}"


def build_payload(args: argparse.Namespace, config_dirs: list[Path]) -> tuple[dict[str, Any], ExportStats]:
    stats = ExportStats()
    accounts: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for index, config_dir in enumerate(config_dirs, start=1):
        stats.scanned_config_dirs += 1

        try:
            record, source_kind = load_source_record(config_dir, args)
        except json.JSONDecodeError:
            stats.skipped_invalid_json += 1
            continue
        except ValueError:
            stats.skipped_invalid_shape += 1
            continue

        if record is None:
            stats.skipped_missing_storage += 1
            continue

        stats.loaded_credentials += 1
        if source_kind == "keychain":
            stats.keychain_hits += 1
        elif source_kind == "plaintext":
            stats.plaintext_hits += 1

        if not isinstance(record.credentials.get("claudeAiOauth"), dict):
            stats.skipped_missing_claude_oauth += 1
            continue

        credentials = build_credentials(record)
        if "refresh_token" not in credentials:
            stats.skipped_missing_refresh_token += 1
            continue

        extra = build_extra(record)
        unique_key = dedupe_key(credentials, extra, record.config_dir)
        if unique_key in seen_keys:
            stats.skipped_duplicates += 1
            continue
        seen_keys.add(unique_key)

        account = {
            "name": build_account_name(args.name_prefix, record, index),
            "notes": build_note(args.notes_prefix, record),
            "platform": "anthropic",
            "type": "oauth",
            "credentials": credentials,
            "extra": extra,
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
            f"from {stats.loaded_credentials} readable credential store(s) "
            f"across {stats.scanned_config_dirs} config dir(s) -> {destination}"
        ),
        file=sys.stderr,
    )
    if stats.keychain_hits:
        print(f"Read from macOS Keychain: {stats.keychain_hits}", file=sys.stderr)
    if stats.plaintext_hits:
        print(f"Read from plaintext fallback: {stats.plaintext_hits}", file=sys.stderr)
    if stats.skipped_missing_storage:
        print(f"Skipped missing storage: {stats.skipped_missing_storage}", file=sys.stderr)
    if stats.skipped_missing_claude_oauth:
        print(f"Skipped missing claudeAiOauth: {stats.skipped_missing_claude_oauth}", file=sys.stderr)
    if stats.skipped_missing_refresh_token:
        print(f"Skipped missing refresh_token: {stats.skipped_missing_refresh_token}", file=sys.stderr)
    if stats.skipped_duplicates:
        print(f"Skipped duplicates: {stats.skipped_duplicates}", file=sys.stderr)
    if stats.skipped_invalid_json:
        print(f"Skipped invalid JSON files: {stats.skipped_invalid_json}", file=sys.stderr)
    if stats.skipped_invalid_shape:
        print(f"Skipped invalid object files: {stats.skipped_invalid_shape}", file=sys.stderr)


def main() -> int:
    args = parse_args()
    config_dirs = expand_config_dirs(args.config_dirs, args.config_dir_globs)
    if not config_dirs:
        print("No Claude config directories matched the provided inputs.", file=sys.stderr)
        return 1

    payload, stats = build_payload(args, config_dirs)
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
