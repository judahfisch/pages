import asyncio
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import (
    Error as PlaywrightError,
    TimeoutError as PlaywrightTimeoutError,
    async_playwright,
)


ROOT_DIR = Path(__file__).resolve().parent
LINKS_FILE = ROOT_DIR / "links.txt"
PAGES_DIR = ROOT_DIR / "pages"
MANIFEST_FILE = ROOT_DIR / "manifest.json"
HEADLESS = os.getenv("PLAYWRIGHT_HEADLESS", "1").lower() not in {"0", "false", "no"}


def safe_name(text: str) -> str:
    text = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", text)
    text = re.sub(r"\s+", "_", text).strip("._ ")
    return text[:100] or "untitled"


def normalize_url(url: str) -> str:
    url = url.strip()
    if url and not urlparse(url).scheme:
        return f"https://{url}"
    return url


def read_links(path: Path) -> tuple[list[str], list[str]]:
    if not path.is_file():
        raise FileNotFoundError(f"Links file not found: {path}")

    links = []
    invalid_lines = []
    seen = set()

    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(),
        start=1,
    ):
        raw_url = line.split("#", 1)[0].strip()
        if not raw_url:
            continue

        url = normalize_url(raw_url)
        try:
            parsed_url = urlparse(url)
            is_valid = (
                parsed_url.scheme in ("http", "https")
                and bool(parsed_url.hostname)
                and not any(character.isspace() for character in parsed_url.netloc)
            )
        except ValueError:
            is_valid = False

        if is_valid:
            if url not in seen:
                links.append(url)
                seen.add(url)
        else:
            invalid_lines.append(f"line {line_number}: {raw_url}")

    return links, invalid_lines


def filename_for_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path.strip("/") or "homepage"
    page_name = path.rsplit("/", 1)[-1]
    suffix = ""
    if parsed.query or parsed.fragment:
        identifier = f"{parsed.query}#{parsed.fragment}".encode("utf-8")
        suffix = f"-{hashlib.sha1(identifier).hexdigest()[:10]}"
    return f"{safe_name(page_name)}{suffix}.png"


def update_manifest(snapshot_paths: list[str]) -> None:
    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    if MANIFEST_FILE.exists():
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
        files = set(manifest.get("files", []))
    else:
        files = set()

    files.update(snapshot_paths)
    MANIFEST_FILE.write_text(
        json.dumps({"files": sorted(files)}, indent=2) + "\n",
        encoding="utf-8",
    )


async def load_page(page, url: str) -> None:
    await page.goto(
        url,
        wait_until="domcontentloaded",
        timeout=60000,
    )

    try:
        await page.wait_for_load_state("networkidle", timeout=12000)
    except PlaywrightTimeoutError:
        pass

    await page.evaluate("""
        async () => {
            const pause = ms =>
                new Promise(resolve => setTimeout(resolve, ms));

            let previousHeight = 0;
            let unchanged = 0;

            for (let i = 0; i < 80; i++) {
                const height = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight
                );

                window.scrollTo(0, Math.min(
                    window.scrollY + window.innerHeight * 0.8,
                    height
                ));

                await pause(180);

                const newHeight = Math.max(
                    document.body.scrollHeight,
                    document.documentElement.scrollHeight
                );

                if (newHeight === previousHeight) {
                    unchanged++;
                } else {
                    unchanged = 0;
                }

                previousHeight = newHeight;

                if (
                    window.scrollY + window.innerHeight >= newHeight &&
                    unchanged >= 2
                ) {
                    break;
                }
            }

            window.scrollTo(0, 0);
            await pause(500);
        }
    """)

    await page.evaluate("""
        async () => {
            const images = Array.from(document.images);

            await Promise.all(images.map(img => {
                if (img.complete) {
                    return img.decode().catch(() => {});
                }

                return new Promise(resolve => {
                    img.addEventListener("load", resolve, { once: true });
                    img.addEventListener("error", resolve, { once: true });
                    setTimeout(resolve, 5000);
                });
            }));
        }
    """)


async def main():
    print("FULL-PAGE SNAPSHOT TOOL")
    print("-" * 30)

    try:
        links, invalid_lines = read_links(LINKS_FILE)
    except (OSError, UnicodeError) as error:
        print(f"Unable to read links.txt: {error}")
        return

    if invalid_lines:
        print("\nIgnored invalid links:")
        for invalid_line in invalid_lines:
            print(f"  {invalid_line}")

    if not links:
        print(f"No valid HTTP/HTTPS links found in {LINKS_FILE.name}.")
        return

    PAGES_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\nFound {len(links)} links.")
    print(f"Saving snapshots to: {PAGES_DIR}\n")

    successful = 0
    failed = []
    snapshot_paths = []

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=HEADLESS)
        try:
            context = await browser.new_context(
                viewport={"width": 1440, "height": 1000},
                device_scale_factor=1,
            )

            page = await context.new_page()
            await page.emulate_media(reduced_motion="reduce")

            for index, url in enumerate(links, start=1):
                parsed_url = urlparse(url)
                domain = safe_name(parsed_url.netloc or "unknown-site")
                path_parts = [
                    safe_name(part)
                    for part in parsed_url.path.split("/")
                    if part
                ]
                filename = filename_for_url(url)
                destination = PAGES_DIR / domain / Path(*path_parts[:-1]) / filename
                destination.parent.mkdir(parents=True, exist_ok=True)

                print(f"[{index}/{len(links)}] {url}")

                try:
                    await load_page(page, url)

                    await page.screenshot(
                        path=str(destination),
                        full_page=True,
                        animations="disabled",
                        type="png",
                        timeout=60000,
                    )

                    successful += 1
                    snapshot_paths.append(destination.relative_to(PAGES_DIR).as_posix())
                    print(f"    Saved: {filename}")

                except (OSError, PlaywrightError, ValueError) as error:
                    failed.append((url, str(error)))
                    print(f"    FAILED: {error}")
        finally:
            await browser.close()

    try:
        update_manifest(snapshot_paths)
        print(f"Updated manifest: {MANIFEST_FILE}")
    except (OSError, TypeError, ValueError) as error:
        print(f"Unable to update manifest: {error}")

    if failed:
        report = PAGES_DIR / "failed_links.txt"
        report.write_text(
            "\n".join(
                f"{url}\n  Error: {error}\n"
                for url, error in failed
            ),
            encoding="utf-8",
        )
    else:
        (PAGES_DIR / "failed_links.txt").unlink(missing_ok=True)

    print("\n" + "-" * 30)
    print("FINISHED")
    print(f"Successful snapshots: {successful}")
    print(f"Failed snapshots: {len(failed)}")
    print(f"Output folder: {PAGES_DIR}")


if __name__ == "__main__":
    asyncio.run(main())