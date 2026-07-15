# SPPU Result Watcher (Node.js/TypeScript Version)

A free, automated, serverless system that checks the SPPU online results page every 10 minutes and posts real-time alerts to course-specific Telegram channels.

---

## How It Works

1. **GitHub Actions Scheduler**: A scheduled workflow ([check_result.yml](file:///.github/workflows/check_result.yml)) runs every 10 minutes (or manually on request).
2. **Headless Browser Scraping**: The script uses **Playwright** (Chromium) to load the SPPU results dashboard and extract the text.
3. **Keyword Matching**: It normalizes page text and checks it against keywords defined in [categories.json](file:///categories.json).
4. **Alerts & De-duplication**: 
   - When a match is found, it sends an alert via the Telegram Bot API to the specific channel.
   - It stores the alerted line in [state.json](file:///state.json) and commits it back to the repository so you only receive **one alert per declared result**.

---

## How to Set Up and Customize

### 1. Add/Modify a Result Category
To add a new category or change matching keywords, edit [categories.json](file:///categories.json):
```json
  {
    "id": "engineering",
    "label": "Engineering",
    "telegram_chat_id": "@your_channel_username",
    "match_any_of": ["B.E", "B.TECH", "ENGINEERING"]
  }
```
* **`id`**: Unique string identifier for state tracking.
* **`label`**: The display name included in the Telegram message.
* **`telegram_chat_id`**: The Telegram channel username (e.g., `@sppu_engineering_results`) or channel numeric ID.
* **`match_any_of`**: List of keywords. If any of these appear in a result title on the page (case and punctuation ignored), it triggers an alert.

---

### 2. Set Up Telegram Channels & Get Chat IDs

To create and link Telegram channels to the bot:
1. **Create a Channel**: In Telegram, create a new **Public Channel** (e.g., "SPPU Engineering Results").
2. **Assign a Username**: Give the channel a public link username (e.g. `t.me/sppu_engineering_results`). In this case, your `telegram_chat_id` in `categories.json` is `@sppu_engineering_results`.
3. **Create a Bot**:
   * Message **@BotFather** on Telegram and send `/newbot`.
   * Follow the steps to get your HTTP API bot token (e.g. `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`).
4. **Make Bot Admin**: Add your Telegram Bot as an **Administrator** in each channel you want to post to with "Post Messages" permission.

*(Note: If you want to use Private Channels, you will need to retrieve the numeric chat ID, which usually starts with `-100`. You can find it by forwarding a post from the private channel to a bot like `@ShowJsonBot`.)*

---

### 3. Add Secrets to GitHub

1. In your GitHub Repository, go to **Settings** -> **Secrets and variables** -> **Actions**.
2. Click **New repository secret**.
3. Set the Name to `TELEGRAM_BOT_TOKEN`.
4. Set the Value to the bot token you received from `@BotFather`.
5. Click **Add secret**.

---

### 4. Enable GitHub Actions / Rotate Tokens
* **First Run**: Under your repo's **Actions** tab, find "Check SPPU Result" and click **Run workflow** to verify everything runs properly.
* **Inactivity Pause**: GitHub automatically pauses schedules if the repository has no commits for 60 days. If it pauses, simply visit the repository's Actions tab and click "Enable workflows", or make a push/commit to re-enable it.
* **Rotate Tokens**: If your Telegram token is leaked or needs to be changed, simply update the `TELEGRAM_BOT_TOKEN` secret in GitHub. No changes to the code are required.
