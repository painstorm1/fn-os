#!/usr/bin/env python
"""Deterministic FNOS direct-import product → Obsidian product-card processor."""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

VAULT = Path(os.environ.get("OBSIDIAN_VAULT_PATH", "D:/Obs_FN_Cool")).resolve()
CARDS_ROOT = (VAULT / "50_BUSINESS_KNOWLEDGE/Products/Cards").resolve()
IMAGE_ROOT = (VAULT / "90_RESOURCES/Product_Images").resolve()
INDEX_PATH = VAULT / "50_BUSINESS_KNOWLEDGE/Products/Product_Index.md"
AUTO_START = "<!-- AUTO_PRODUCT_CARD_START -->"
AUTO_END = "<!-- AUTO_PRODUCT_CARD_END -->"
INDEX_START = "<!-- AUTO_PRODUCT_CARDS_START -->"
INDEX_END = "<!-- AUTO_PRODUCT_CARDS_END -->"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"}


def file_state(path: Path) -> tuple[int, int, str] | None:
    if not path.is_file():
        return None
    stat = path.stat()
    return stat.st_mtime_ns, stat.st_size, hashlib.sha256(path.read_bytes()).hexdigest()


@contextmanager
def exclusive_lock(target: Path):
    target.parent.mkdir(parents=True, exist_ok=True)
    lock_path = target.with_name(target.name + ".lock")
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError as exc:
        raise RuntimeError(f"target is locked: {target.name}") from exc
    try:
        with os.fdopen(descriptor, "w", encoding="ascii") as handle:
            handle.write(str(os.getpid()))
        yield
    finally:
        lock_path.unlink(missing_ok=True)


def atomic_write(path: Path, content: str, expected_state: tuple[int, int, str] | None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", delete=False, dir=path.parent, suffix=".tmp") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
            temp_path = Path(handle.name)
        if file_state(path) != expected_state:
            raise RuntimeError(f"target changed during update: {path.name}")
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def text(value: object) -> str:
    return str(value or "").strip()


def number(value: object) -> str:
    raw = text(value)
    if not raw:
        return ""
    try:
        parsed = float(raw.replace(",", ""))
        return f"{parsed:,.0f}" if parsed.is_integer() else f"{parsed:,.2f}"
    except ValueError:
        return raw


def yaml_string(value: object) -> str:
    return json.dumps(text(value), ensure_ascii=False)


def safe_segment(value: object, fallback: str = "product") -> str:
    value_text = re.sub(r"[^0-9A-Za-z가-힣._-]+", "-", text(value)).strip("-.")[:100]
    return value_text or fallback


def markdown(value: object) -> str:
    return text(value).replace("|", "\\|").replace("\r", " ").replace("\n", " ")


def list_value(value: object) -> list[dict]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def ensure_target(target_value: object) -> tuple[Path, str]:
    relative = text(target_value).replace("\\", "/")
    if "\0" in relative or not relative.startswith("50_BUSINESS_KNOWLEDGE/Products/Cards/") or ":" in relative or not relative.lower().endswith(".md"):
        raise ValueError("target_path must be below 50_BUSINESS_KNOWLEDGE/Products/Cards")
    if any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("invalid target_path")
    target = (VAULT / relative).resolve()
    if CARDS_ROOT not in target.parents:
        raise ValueError("target_path escaped the product cards folder")
    return target, relative


def allowed_image_roots() -> list[Path]:
    roots = [Path("D:/FN_images"), IMAGE_ROOT]
    configured = text(os.environ.get("FNOS_ALLOWED_PRODUCT_IMAGE_ROOTS"))
    if configured:
        roots.extend(Path(root) for root in configured.split(os.pathsep) if text(root))
    return [root.resolve() for root in roots]


def copy_image(image_source: str, product_code: str, dry_run: bool) -> tuple[str, str]:
    if not image_source:
        return "", ""
    if image_source.lower().startswith(("https://", "http://")):
        return image_source, "remote"
    if "\0" in image_source:
        raise ValueError("product image path contains NUL")
    source = Path(image_source).resolve()
    if source.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError("product image must be a supported image file")
    if not source.is_file():
        raise FileNotFoundError(f"product image not found: {source}")
    if not any(root == source or root in source.parents for root in allowed_image_roots()):
        raise ValueError("product image is outside the allowed roots")
    folder = IMAGE_ROOT / safe_segment(product_code)
    destination = folder / safe_segment(source.name, "product-image" + source.suffix.lower())
    if not dry_run:
        folder.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    relative = destination.relative_to(VAULT).as_posix()
    return relative, "vault"


def first(*values: object) -> str:
    return next((text(value) for value in values if text(value)), "")


def card_markdown(payload: dict, image_ref: str, image_kind: str) -> str:
    product = payload.get("product") if isinstance(payload.get("product"), dict) else {}
    import_links = list_value(payload.get("import_links"))
    import_products = list_value(payload.get("import_products"))
    sales_mappings = list_value(payload.get("sales_mappings"))
    product_id = text(product.get("id"))
    code = first(product.get("product_code"), product.get("prod_cd"), product.get("sku"))
    name = first(product.get("product_name"), product.get("prod_name"), code)
    source_urls = [text(item.get("product_url")) for item in import_products if text(item.get("product_url"))]
    import_ids = [text(item.get("id")) for item in import_products if text(item.get("id"))]
    now_date = datetime.now().astimezone().date().isoformat()
    image_frontmatter = image_ref if image_kind == "vault" else text(payload.get("image_source"))
    frontmatter = [
        "---",
        "type: product-knowledge",
        "status: confirmed",
        "scope: company",
        "category: direct-import-product",
        f"fnos_product_id: {yaml_string(product_id)}",
        f"product_code: {yaml_string(code)}",
        f"product_name: {yaml_string(name)}",
        f"import_product_ids: {json.dumps(import_ids, ensure_ascii=False)}",
        f"image: {yaml_string(image_frontmatter)}",
        f"source: {json.dumps(source_urls, ensure_ascii=False)}",
        "tags: [product-knowledge, direct-import, fnos]",
        f"updated: {now_date}",
        "---",
    ]
    lines = frontmatter + ["", AUTO_START, f"# {name}", "", "## 한눈에 보기"]
    lines += [f"- FNOS 제품코드: `{markdown(code)}`", f"- FNOS 제품 ID: `{markdown(product_id)}`"]
    lines += [f"- 직수입 연결: {len(import_links)}건 / 판매채널 연결: {len(sales_mappings)}건"]
    if text(payload.get("extra_context")):
        lines += [f"- 현재 맥락: {markdown(payload.get('extra_context'))}"]
    lines += ["", "## 제품 이미지"]
    if image_ref:
        lines += [f"![[{image_ref}]]" if image_kind == "vault" else f"![제품 이미지]({image_ref})"]
    else:
        fallback_image = first(product.get("image_url"), *(item.get("image_url") for item in import_products))
        lines += [f"![FNOS 제품 이미지]({fallback_image})" if fallback_image else "- 등록 이미지 없음"]
    if text(payload.get("image_notes")):
        lines += ["", f"- 이미지 판독 메모: {markdown(payload.get('image_notes'))}"]

    lines += ["", "## FNOS 기준 정보", "", "| 항목 | 값 |", "|---|---|"]
    for label, value in [
        ("제품코드", code),
        ("제품명", name),
        ("매입/원가", number(first(product.get("cost_price")))),
        ("기준 판매가", number(first(product.get("standard_price")))),
        ("통화", product.get("currency")),
        ("FNOS 메모", product.get("note")),
    ]:
        lines.append(f"| {label} | {markdown(value) or '-'} |")

    lines += ["", "## 직수입·스펙 연결", ""]
    if import_products:
        lines += ["| 수입 ID | 수입품명 | 옵션/스펙 | HS Code | MOQ | 소싱가 | 공급/판매 원문 |", "|---|---|---|---|---:|---:|---|"]
        for item in import_products:
            price = " ".join(part for part in [number(first(item.get("std_price"), item.get("standard_price"), item.get("price"))), text(item.get("currency"))] if part)
            url = text(item.get("product_url"))
            url_cell = f"[열기]({url})" if url else "-"
            lines.append("| " + " | ".join([
                markdown(item.get("id")) or "-",
                markdown(first(item.get("name"), item.get("product_name"), item.get("sku"))) or "-",
                markdown(item.get("options")) or "-",
                markdown(item.get("hs_code")) or "-",
                markdown(number(item.get("moq"))) or "-",
                markdown(price) or "-",
                url_cell,
            ]) + " |")
    else:
        lines += ["- FNOS import_erp_products 상세 데이터 없음"]
    if import_links:
        lines += ["", "### SKU 연결", "", "| 수입 ID | 수입 옵션 | 기본 수량/비율 |", "|---|---|---|"]
        for item in import_links:
            option = first(item.get("import_option_name"), item.get("import_option_key"), item.get("match_group_label"), item.get("variant_label"))
            qty_ratio = f"{number(item.get('default_qty')) or '-'} / {number(item.get('default_ratio')) or '-'}"
            lines.append(f"| {markdown(item.get('import_product_id')) or '-'} | {markdown(option) or '-'} | {markdown(qty_ratio)} |")

    lines += ["", "## 판매채널 확인", ""]
    if sales_mappings:
        lines += ["| 채널 | 판매상품명 | 채널 상품코드/key | 확인 링크 |", "|---|---|---|---|"]
        for item in sales_mappings:
            channel = first(item.get("channel_name"), item.get("channel_code"))
            mall_name = first(item.get("mall_product_name"), name)
            mall_key = first(item.get("mall_product_code"), item.get("mall_product_key"))
            search_url = "https://search.shopping.naver.com/search/all?query=" + quote(mall_name or name)
            lines.append(f"| {markdown(channel) or '-'} | {markdown(mall_name) or '-'} | {markdown(mall_key) or '-'} | [판매페이지 검색]({search_url}) |")
    else:
        lines += ["- sales_channel_product_mappings 연결 없음 — 판매채널 코드연결 확인 필요"]

    lines += ["", "## 질문할 때 항상 사용할 제품 맥락"]
    lines += [
        f"- 이 카드는 `{code}` / `{name}`의 직수입 제품 정본이다.",
        "- 답변할 때 FNOS 제품 ID·수입 연결·옵션/스펙·판매채널 연결과 아래 원문을 함께 확인한다.",
        "- 이미지에서만 읽힌 정보는 이미지 판독 메모로 구분하고, FNOS DB 값으로 임의 보정하지 않는다.",
        "- 가격·재고·판매상태처럼 변할 수 있는 값은 답변 시 FNOS live readback을 우선한다.",
    ]
    lines += ["", "## 관련 자료"]
    if source_urls:
        lines += [f"- [수입/제품 원문 {index + 1}]({url})" for index, url in enumerate(source_urls)]
    else:
        lines += ["- 등록된 원문 URL 없음"]
    lines += ["", "## 확인 필요 / 리스크"]
    notes = [text(item.get("note")) for item in import_products if text(item.get("note"))]
    lines += [f"- {markdown(note)}" for note in notes] or ["- 없음 또는 추가 확인 대기"]
    lines += ["", AUTO_END, ""]
    return "\n".join(lines)


def preserve_manual_tail(existing: str) -> str:
    if AUTO_END not in existing:
        return "\n## 사용자 메모\n\n- 직접 추가한 판단·상세페이지·광고·CS 맥락을 여기에 기록합니다.\n"
    tail = existing.split(AUTO_END, 1)[1].lstrip("\r\n")
    return "\n" + tail if tail else "\n## 사용자 메모\n\n- 직접 추가한 판단·상세페이지·광고·CS 맥락을 여기에 기록합니다.\n"


def index_content() -> str:
    cards = []
    if CARDS_ROOT.is_dir():
        for path in sorted(CARDS_ROOT.glob("*.md")):
            content = path.read_text(encoding="utf-8-sig")
            heading = next((line[2:].strip() for line in content.splitlines() if line.startswith("# ")), path.stem)
            code_match = re.search(r'^product_code:\s*"?(.*?)"?$', content, re.MULTILINE)
            code = code_match.group(1) if code_match else ""
            cards.append((heading, code, path.relative_to(VAULT).as_posix()))
    block = [INDEX_START, "## 직수입 제품 카드", "", "| 제품 | FNOS 코드 | 카드 |", "|---|---|---|"]
    block += [f"| {markdown(title)} | `{markdown(code)}` | [[{relative.removesuffix('.md')}|열기]] |" for title, code, relative in cards]
    if not cards:
        block.append("| 등록 대기 | - | - |")
    block.append(INDEX_END)
    current = INDEX_PATH.read_text(encoding="utf-8-sig") if INDEX_PATH.exists() else "# Product Index\n"
    replacement = "\n".join(block)
    if INDEX_START in current and INDEX_END in current:
        return re.sub(re.escape(INDEX_START) + r".*?" + re.escape(INDEX_END), replacement, current, flags=re.S)
    return current.rstrip() + "\n\n" + replacement + "\n"


def regenerate_index(dry_run: bool) -> None:
    if dry_run:
        index_content()
        return
    with exclusive_lock(INDEX_PATH):
        expected_state = file_state(INDEX_PATH)
        atomic_write(INDEX_PATH, index_content(), expected_state)


def process(payload: dict, dry_run: bool) -> dict:
    target, relative = ensure_target(payload.get("target_path"))
    product = payload.get("product") if isinstance(payload.get("product"), dict) else {}
    product_code = first(product.get("product_code"), product.get("prod_cd"), product.get("sku"))
    image_ref, image_kind = copy_image(text(payload.get("image_source")), product_code, dry_run)
    generated = card_markdown(payload, image_ref, image_kind)
    if dry_run:
        existing = target.read_text(encoding="utf-8-sig") if target.exists() else ""
        content = generated + preserve_manual_tail(existing)
        verified = True
    else:
        with exclusive_lock(target):
            expected_state = file_state(target)
            existing = target.read_text(encoding="utf-8-sig") if target.exists() else ""
            content = generated + preserve_manual_tail(existing)
            atomic_write(target, content, expected_state)
            readback = target.read_text(encoding="utf-8")
            verified = AUTO_START in readback and AUTO_END in readback and product_code in readback
            if not verified:
                raise RuntimeError("product card readback verification failed")
        regenerate_index(False)
    return {
        "target_path": relative,
        "image_path": image_ref if image_kind == "vault" else "",
        "readback_verified": verified,
        "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
        "dry_run": dry_run,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-json", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    try:
        payload = json.loads(args.job_json)
        if not isinstance(payload, dict):
            raise ValueError("job payload must be an object")
        print(json.dumps(process(payload, args.dry_run or payload.get("dry_run") is True), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(f"product card worker failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
