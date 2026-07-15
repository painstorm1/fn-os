#!/usr/bin/env python
"""Write one queued FNOS daily capture to its fixed Obsidian inbox path."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

DEFAULT_VAULT = Path("D:/Obs_FN_Cool")
DAILY_ROOT = PurePosixPath("03_INBOX/Daily_Inbox")


def text(value: Any) -> str:
    return str(value or "").strip()


def expected_relative_path(payload: dict[str, Any]) -> PurePosixPath:
    daily_id = text(payload.get("daily_id"))
    entry_date = text(payload.get("entry_date"))
    if not re.fullmatch(r"[0-9A-Za-z-]+", daily_id):
        raise ValueError("invalid daily_id")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry_date):
        raise ValueError("invalid entry_date")
    relative = PurePosixPath(DAILY_ROOT, entry_date, f"FNOS-{daily_id}.md")
    supplied = text(payload.get("target_path")).replace("\\", "/")
    if "\0" in supplied or supplied != relative.as_posix():
        raise ValueError("target_path does not match the fixed daily inbox path")
    return relative


def resolve_inside(vault: Path, relative: PurePosixPath) -> Path:
    root = vault.resolve()
    target = (root / Path(*relative.parts)).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise ValueError("daily target escaped the Obsidian vault") from exc
    return target


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False, dir=path.parent, suffix=".tmp") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def render(payload: dict[str, Any]) -> str:
    title = " ".join(text(payload.get("title")).split())
    original = text(payload.get("entry_preview"))
    if not title or not original:
        raise ValueError("daily title and original entry are required")
    return f"# {title}\n\n{original}\n"


def process(payload: dict[str, Any], vault: Path, *, dry_run: bool) -> dict[str, Any]:
    relative = expected_relative_path(payload)
    target = resolve_inside(vault, relative)
    content = render(payload)
    if not dry_run:
        atomic_write(target, content)
        readback = target.read_text(encoding="utf-8")
        verified = readback == content
        if not verified:
            raise RuntimeError("daily capture readback verification failed")
    else:
        verified = True
    return {
        "ok": True,
        "daily_id": text(payload.get("daily_id")),
        "target_path": relative.as_posix(),
        "readback_verified": verified,
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "dry_run": dry_run,
        "readback_at": datetime.now(timezone.utc).isoformat(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-json", required=True)
    parser.add_argument("--vault", default=os.environ.get("FNOS_OBSIDIAN_VAULT", str(DEFAULT_VAULT)))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        payload = json.loads(args.job_json)
        if not isinstance(payload, dict):
            raise ValueError("job JSON must be an object")
        print(json.dumps(process(payload, Path(args.vault), dry_run=args.dry_run or payload.get("dry_run") is True), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"daily capture worker failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
