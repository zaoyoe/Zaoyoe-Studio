#!/usr/bin/env python3
"""Export local Gemini CLI OAuth storage into sub2api-data JSON."""

from __future__ import annotations

import argparse
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
DEFAULT_NAME_PREFIX = "gemini"
DEFAULT_NOTES_PREFIX = "Imported from local Gemini CLI OAuth storage"
KEYCHAIN_SERVICE_NAME = "gemini-cli-oauth"
MAIN_ACCOUNT_KEY = "main-account"

GOOGLE_ONE_TIER_IDS = {
    "google_one_free",
    "google_ai_pro",
    "google_ai_ultra",
    "google_one_unknown",
    "legacy",
    "pro",
    "ultra",
}
GCP_TIER_IDS = {
    "gcp_standard",
    "gcp_enterprise",
}
AI_STUDIO_TIER_IDS = {
    "aistudio_free",
    "aistudio_paid",
}
NODE_DECRYPT_SCRIPT = r"""
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');

const filePath = process.argv[1];
const serviceName = process.argv[2];
const accountName = process.argv[3];
const raw = fs.readFileSync(filePath, 'utf8').trim();

if (!raw) {
  process.stdout.write('null');
  process.exit(0);
}

const parts = raw.split(':');
if (parts.length !== 3) {
  throw new Error('Invalid encrypted data format');
}

const salt = `${os.hostname()}-${os.userInfo().username}-gemini-cli`;
const key = crypto.scryptSync('gemini-cli-oauth', salt, 32);
const iv = Buffer.from(parts[0], 'hex');
const authTag = Buffer.from(parts[1], 'hex');
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(authTag);

let decrypted = decipher.update(parts[2], 'hex', 'utf8');
decrypted += decipher.final('utf8');

const data = JSON.parse(decrypted);
const serviceData = data?.[serviceName];
if (!serviceData || typeof serviceData !== 'object') {
  process.stdout.write('null');
  process.exit(0);
}

const credentials = serviceData[accountName] ?? null;
process.stdout.write(JSON.stringify(credentials));
"""


@dataclass
class ExportStats:
    scanned_config_dirs: int = 0
    loaded_credentials: int = 0
    exported: int = 0
    keychain_hits: int = 0
    encrypted_file_hits: int = 0
    skipped_invalid_json: int = 0
    skipped_invalid_shape: int = 0
    skipped_missing_storage: int = 0
    skipped_missing_gemini_oauth: int = 0
    skipped_missing_refresh_token: int = 0
    skipped_duplicates: int = 0


@dataclass
class SourceRecord:
    config_dir: Path
    credentials: dict[str, Any]
    credentials_source: str
    accounts_metadata: dict[str, Any]
    accounts_path: Path | None
    projects_metadata: dict[str, Any]
    projects_path: Path | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read local Gemini CLI OAuth storage and emit a sub2api-data JSON file "
            "that can be imported from the admin Accounts page."
        )
    )
    parser.add_argument(
        "--config-dir",
        action="append",
        dest="config_dirs",
        help=(
            "Gemini config directory to scan. Repeat this flag to export multiple "
            "Gemini CLI profiles. Defaults to ~/.gemini."
        ),
    )
    parser.add_argument(
        "--config-dir-glob",
        action="append",
        dest="config_dir_globs",
        help=(
            "Glob that expands to multiple Gemini config directories, such as "
            "'~/.gemini-profiles/*'."
        ),
    )
    parser.add_argument(
        "--out",
        help=(
            "Output path for the generated JSON. "
            "Defaults to ./gemini-sub2api-export-<timestamp>.json."
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
        "--project-id",
        default=os.environ.get("SUB2API_GEMINI_PROJECT_ID", ""),
        help=(
            "Optional Google Cloud project ID to write into exported Gemini OAuth credentials. "
            "Defaults to $SUB2API_GEMINI_PROJECT_ID."
        ),
    )
    parser.add_argument(
        "--oauth-type",
        default="auto",
        help=(
            "Gemini OAuth type to write into exported credentials. Use auto, code_assist, "
            "google_one, or ai_studio. Default: auto."
        ),
    )
    parser.add_argument(
        "--tier-id",
        default=os.environ.get("SUB2API_GEMINI_TIER_ID", ""),
        help=(
            "Optional Gemini tier_id to include in exported credentials, such as "
            "google_ai_pro or gcp_standard. Defaults to $SUB2API_GEMINI_TIER_ID."
        ),
    )
    parser.add_argument(
        "--disable-keychain",
        action="store_true",
        help="Skip macOS Keychain lookup and read only the encrypted gemini-credentials.json fallback.",
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


def normalize_path(raw_path: str | Path) -> Path:
    return Path(raw_path).expanduser().resolve(strict=False)


def default_config_dir() -> Path:
    return normalize_path(Path.home() / ".gemini")


def default_output_path() -> Path:
    timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
    return Path.cwd() / f"gemini-sub2api-export-{timestamp}.json"


def expand_config_dirs(
    config_dirs: list[str] | None,
    config_dir_globs: list[str] | None,
) -> list[Path]:
    explicit_dirs = config_dirs or []
    glob_patterns = config_dir_globs or []

    if not explicit_dirs and not glob_patterns:
        return [default_config_dir()]

    paths: list[Path] = []
    seen: set[Path] = set()

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


def load_optional_json(path: Path) -> tuple[dict[str, Any], Path | None]:
    if not path.is_file():
        return {}, None
    try:
        return load_json_object(path), path
    except (json.JSONDecodeError, ValueError):
        return {}, None


def first_non_empty(*values: Any) -> str:
    for value in values:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
    return ""


def normalize_scope(raw_value: Any) -> str | None:
    if isinstance(raw_value, str):
        stripped = raw_value.strip()
        return stripped or None
    if isinstance(raw_value, list):
        scopes = [str(item).strip() for item in raw_value if str(item).strip()]
        if scopes:
            return " ".join(scopes)
    return None


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


def read_keychain_credentials() -> tuple[dict[str, Any], str] | None:
    if sys.platform != "darwin":
        return None

    try:
        proc = subprocess.run(
            [
                "security",
                "find-generic-password",
                "-w",
                "-s",
                KEYCHAIN_SERVICE_NAME,
                "-a",
                MAIN_ACCOUNT_KEY,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    if proc.returncode != 0 or not proc.stdout.strip():
        return None

    payload = json.loads(proc.stdout)
    if not isinstance(payload, dict):
        raise ValueError("Gemini Keychain payload must be a JSON object")
    return payload, f"keychain:{KEYCHAIN_SERVICE_NAME}/{MAIN_ACCOUNT_KEY}"


def decrypt_encrypted_credentials_file(path: Path) -> Any:
    try:
        proc = subprocess.run(
            [
                "node",
                "-e",
                NODE_DECRYPT_SCRIPT,
                str(path),
                KEYCHAIN_SERVICE_NAME,
                MAIN_ACCOUNT_KEY,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )
    except OSError as exc:
        raise RuntimeError("node is required to decrypt Gemini CLI fallback storage") from exc

    if proc.returncode != 0:
        message = proc.stderr.strip() or "Failed to decrypt gemini-credentials.json"
        raise RuntimeError(message)

    return json.loads(proc.stdout or "null")


def read_encrypted_file_credentials(config_dir: Path) -> tuple[dict[str, Any] | None, str]:
    path = config_dir / "gemini-credentials.json"
    if not path.is_file():
        return None, "missing"

    decrypted = decrypt_encrypted_credentials_file(path)
    if decrypted is None:
        return None, "missing_gemini_oauth"

    if isinstance(decrypted, str):
        decrypted = json.loads(decrypted)

    if not isinstance(decrypted, dict):
        raise ValueError("Gemini encrypted fallback payload must decode to a JSON object")

    return decrypted, f"encrypted_file:{path}"


def load_source_record(config_dir: Path, args: argparse.Namespace) -> tuple[SourceRecord | None, str]:
    accounts_metadata, accounts_path = load_optional_json(config_dir / "google_accounts.json")
    projects_metadata, projects_path = load_optional_json(config_dir / "projects.json")

    if not args.disable_keychain:
        keychain_result = read_keychain_credentials()
        if keychain_result is not None:
            credentials, source = keychain_result
            return (
                SourceRecord(
                    config_dir=config_dir,
                    credentials=credentials,
                    credentials_source=source,
                    accounts_metadata=accounts_metadata,
                    accounts_path=accounts_path,
                    projects_metadata=projects_metadata,
                    projects_path=projects_path,
                ),
                "keychain",
            )

    encrypted_credentials, status = read_encrypted_file_credentials(config_dir)
    if encrypted_credentials is not None:
        return (
            SourceRecord(
                config_dir=config_dir,
                credentials=encrypted_credentials,
                credentials_source=f"encrypted_file:{config_dir / 'gemini-credentials.json'}",
                accounts_metadata=accounts_metadata,
                accounts_path=accounts_path,
                projects_metadata=projects_metadata,
                projects_path=projects_path,
            ),
            "encrypted_file",
        )

    return None, status


def credentials_token(record: SourceRecord) -> dict[str, Any]:
    token = record.credentials.get("token")
    return token if isinstance(token, dict) else {}


def canonical_tier_id(raw_value: str) -> str:
    return raw_value.strip().lower().replace(" ", "_")


def resolve_project_id(args: argparse.Namespace) -> str:
    return first_non_empty(
        args.project_id,
        os.environ.get("GOOGLE_CLOUD_PROJECT"),
        os.environ.get("GOOGLE_CLOUD_PROJECT_ID"),
        os.environ.get("GCLOUD_PROJECT"),
    )


def resolve_tier_id(record: SourceRecord, args: argparse.Namespace) -> str:
    token = credentials_token(record)
    return canonical_tier_id(
        first_non_empty(
            args.tier_id,
            record.credentials.get("tier_id"),
            record.credentials.get("tierId"),
            token.get("tierId"),
            token.get("tier_id"),
        )
    )


def resolve_oauth_type(args: argparse.Namespace, project_id: str, tier_id: str) -> str:
    raw = args.oauth_type.strip().lower()
    if raw and raw != "auto":
        return raw

    if tier_id in AI_STUDIO_TIER_IDS:
        return "ai_studio"
    if tier_id in GCP_TIER_IDS or project_id:
        return "code_assist"
    return "google_one"


def extract_google_account_email(metadata: dict[str, Any]) -> str:
    active = metadata.get("active")
    candidates: list[str] = []

    def collect(value: Any) -> None:
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                candidates.append(stripped)
            return
        if isinstance(value, dict):
            candidates.extend(
                [
                    first_non_empty(
                        value.get("email"),
                        value.get("emailAddress"),
                        value.get("account"),
                        value.get("name"),
                    )
                ]
            )
            return
        if isinstance(value, list):
            for item in value:
                collect(item)

    collect(active)
    collect(metadata.get("old"))
    collect(metadata.get("accounts"))

    for candidate in candidates:
        if "@" in candidate:
            return candidate

    for candidate in candidates:
        if candidate:
            return candidate

    return ""


def build_credentials(record: SourceRecord, args: argparse.Namespace) -> dict[str, Any]:
    token = credentials_token(record)
    credentials: dict[str, Any] = {}

    access_token = first_non_empty(
        token.get("accessToken"),
        record.credentials.get("access_token"),
        record.credentials.get("accessToken"),
    )
    if access_token:
        credentials["access_token"] = access_token

    refresh_token = first_non_empty(
        token.get("refreshToken"),
        record.credentials.get("refresh_token"),
        record.credentials.get("refreshToken"),
    )
    if refresh_token:
        credentials["refresh_token"] = refresh_token

    token_type = first_non_empty(
        token.get("tokenType"),
        record.credentials.get("token_type"),
        record.credentials.get("tokenType"),
    )
    if token_type:
        credentials["token_type"] = token_type
    elif access_token:
        credentials["token_type"] = "Bearer"

    scope = normalize_scope(
        token.get("scope")
        or token.get("scopes")
        or record.credentials.get("scope")
        or record.credentials.get("scopes")
    )
    if scope:
        credentials["scope"] = scope

    expires_at = normalize_expires_at(
        token.get("expiresAt")
        or record.credentials.get("expires_at")
        or record.credentials.get("expiry_date")
        or record.credentials.get("expiresAt")
    )
    if expires_at:
        credentials["expires_at"] = expires_at

    project_id = resolve_project_id(args)
    if project_id:
        credentials["project_id"] = project_id

    tier_id = resolve_tier_id(record, args)
    if tier_id:
        credentials["tier_id"] = tier_id

    oauth_type = resolve_oauth_type(args, project_id, tier_id)
    if oauth_type:
        credentials["oauth_type"] = oauth_type

    return credentials


def build_extra(record: SourceRecord) -> dict[str, Any]:
    extra: dict[str, Any] = {}

    email = extract_google_account_email(record.accounts_metadata)
    if email:
        extra["email_address"] = email

    return extra


def build_account_name(name_prefix: str, record: SourceRecord, index: int) -> str:
    label = extract_google_account_email(record.accounts_metadata)
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
    if record.accounts_path is not None:
        parts.append(f"google_accounts={record.accounts_path}")
    if record.projects_path is not None:
        parts.append(f"projects={record.projects_path}")
    return "; ".join(parts)


def dedupe_key(record: SourceRecord, credentials: dict[str, Any], extra: dict[str, Any]) -> str:
    refresh_token = str(credentials.get("refresh_token") or "").strip()
    if refresh_token:
        digest = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        return f"refresh:{digest}"

    email = str(extra.get("email_address") or "").strip().lower()
    if email:
        return f"email:{email}"

    return f"config:{record.config_dir}"


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
            if source_kind == "missing_gemini_oauth":
                stats.skipped_missing_gemini_oauth += 1
            else:
                stats.skipped_missing_storage += 1
            continue

        stats.loaded_credentials += 1
        if source_kind == "keychain":
            stats.keychain_hits += 1
        elif source_kind == "encrypted_file":
            stats.encrypted_file_hits += 1

        credentials = build_credentials(record, args)
        if "refresh_token" not in credentials:
            stats.skipped_missing_refresh_token += 1
            continue

        extra = build_extra(record)
        dedupe = dedupe_key(record, credentials, extra)
        if dedupe in seen_keys:
            stats.skipped_duplicates += 1
            continue
        seen_keys.add(dedupe)

        account = {
            "name": build_account_name(args.name_prefix, record, index),
            "notes": build_note(args.notes_prefix, record),
            "platform": "gemini",
            "type": "oauth",
            "credentials": credentials,
            "extra": extra,
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
            f"Exported {stats.exported} Gemini account(s) "
            f"from {stats.loaded_credentials} readable credential source(s) -> {destination}"
        ),
        file=sys.stderr,
    )
    if stats.keychain_hits:
        print(f"Keychain hits: {stats.keychain_hits}", file=sys.stderr)
    if stats.encrypted_file_hits:
        print(f"Encrypted file hits: {stats.encrypted_file_hits}", file=sys.stderr)
    if stats.skipped_missing_storage:
        print(f"Skipped missing storage: {stats.skipped_missing_storage}", file=sys.stderr)
    if stats.skipped_missing_gemini_oauth:
        print(
            f"Skipped storage without Gemini OAuth credentials: {stats.skipped_missing_gemini_oauth}",
            file=sys.stderr,
        )
    if stats.skipped_missing_refresh_token:
        print(
            f"Skipped missing refresh_token: {stats.skipped_missing_refresh_token}",
            file=sys.stderr,
        )
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
        print("No Gemini config directories matched the provided inputs.", file=sys.stderr)
        return 1

    payload, stats = build_payload(args, config_dirs)
    if stats.exported == 0:
        print("No exportable Gemini CLI OAuth accounts were found.", file=sys.stderr)
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
