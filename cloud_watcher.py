"""
SPPU Result Watcher - Cloud version (for GitHub Actions)
----------------------------------------------------------
Runs as a single check (no infinite loop) - GitHub Actions calls this
on a schedule (e.g. every 10 min). Sends a Telegram alert the moment
your exam/session appears on the dashboard. Remembers that it already
alerted (via state.json, committed back to the repo) so it won't spam
you every cycle after the first hit.

TO REUSE FOR YOUR NEXT RESULT (e.g. T.E.):
    1. Update MANDATORY_TOKENS / ANY_OF_TOKENS below to match the new
       exam/session name.
    2. Delete state.json from the repo (or set "alerted": false in it).
    3. Commit. The scheduled workflow will pick it up on the next run.

Needs two GitHub repo secrets set (Settings -> Secrets and variables -> Actions):
    TELEGRAM_BOT_TOKEN
    TELEGRAM_CHAT_ID
"""

import os
import re
import json
import requests
from playwright.sync_api import sync_playwright

DASHBOARD_URL = "https://onlineresults.unipune.ac.in/result/dashboard/default"

# ---- UPDATE THESE PER EXAM ----
MANDATORY_TOKENS = ["2019", "CREDIT", "2026"]
ANY_OF_TOKENS = ["APR", "MAY"]
# --------------------------------

STATE_FILE = "state.json"

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")


def normalize(text: str) -> str:
    text = text.upper()
    text = re.sub(r"[^A-Z0-9\s]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


MANDATORY_NORM = [normalize(t) for t in MANDATORY_TOKENS]
ANY_OF_NORM = [normalize(t) for t in ANY_OF_TOKENS]


def line_matches(norm_line: str) -> bool:
    if not all(t in norm_line for t in MANDATORY_NORM):
        return False
    if ANY_OF_NORM and not any(t in norm_line for t in ANY_OF_NORM):
        return False
    return True


def load_state() -> dict:
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE) as f:
            return json.load(f)
    return {"alerted": False}


def save_state(state: dict):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)


def send_telegram(message: str):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("Telegram secrets not set - skipping alert.")
        return
    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    r = requests.post(url, data={"chat_id": TELEGRAM_CHAT_ID, "text": message}, timeout=15)
    print("Telegram response:", r.status_code, r.text[:200])


def fetch_dashboard_text() -> str:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1366, "height": 768},
        ).new_page()
        page.goto(DASHBOARD_URL, wait_until="domcontentloaded", timeout=25000)
        page.wait_for_timeout(4000)
        text = page.inner_text("body")
        browser.close()
        return text


def main():
    state = load_state()
    if state.get("alerted"):
        print("Already alerted previously - skipping. Delete state.json to re-arm.")
        return

    try:
        text = fetch_dashboard_text()
    except Exception as e:
        print(f"Page load failed this cycle (site likely busy): {e}")
        return

    for raw_line in (l for l in text.splitlines() if l.strip()):
        if line_matches(normalize(raw_line)):
            print(f"MATCH: {raw_line.strip()}")
            send_telegram(f"Result is LIVE!\n{raw_line.strip()}\n{DASHBOARD_URL}")
            state["alerted"] = True
            save_state(state)
            return

    print("No match yet.")


if __name__ == "__main__":
    main()
