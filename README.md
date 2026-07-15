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

### 4. Enable GitHub Actions / Setup Consistent Cron
* **First Run**: Under your repo's **Actions** tab, find "Check SPPU Result" and click **Run workflow** to verify everything runs properly.
* **Consistent Scheduling (Recommended)**: GitHub's built-in scheduler (`on.schedule`) is inconsistent and can be delayed by 30+ minutes. For highly consistent runs (exactly every 10 minutes), set up a free account on **[cron-job.org](https://cron-job.org)**:
  1. Create a **GitHub Personal Access Token (Classic)** under Settings -> Developer Settings -> Personal Access Tokens. Give it the `repo` and `actions: write` scopes.
  2. Create a new cron job on cron-job.org:
     * **URL**: `https://api.github.com/repos/RUSHI-09/sppu_result_watcher/actions/workflows/check_result.yml/dispatches`
     * **Method**: `POST`
     * **Schedule**: Every 10 minutes
     * **Request Body (Raw JSON)**: `{"ref": "main"}`
     * **Headers**:
       * `Authorization`: `Bearer YOUR_GITHUB_PAT`
       * `Accept`: `application/vnd.github.v3+json`
       * `User-Agent`: `cron-job-org`
* **Rotate Tokens**: If your Telegram token is leaked or needs to be changed, simply update the `TELEGRAM_BOT_TOKEN` secret in GitHub. No changes to the code are required.

---

### 5. Web Management Dashboard
A built-in single-page web dashboard is available to manage categories, reset alerted lines, and trigger the scraper from your browser.

#### How to use it:
1. Open [index.html](file:///index.html) directly in any modern web browser.
2. Enter your GitHub Repository path (e.g., `rushi76/sppu_result_watcher`).
3. Enter a **GitHub Personal Access Token (PAT)**.
   - **To generate a PAT**: Go to GitHub -> **Settings** -> **Developer Settings** -> **Personal Access Tokens (Tokens classic or Fine-grained)** -> **Generate New Token**.
   - **Required Permissions**: `contents: write` (to update config/state JSON) and `actions: write` (to trigger manual scraper runs).
4. Click **Connect & Load Platform**.
5. The dashboard allows you to:
   - **Trigger runs**: Click **Run Scraper Now** to immediately trigger a new results check and monitor recent runs.
   - **Edit Categories**: Add, edit, or delete degree classifications and their matching keywords, then commit changes directly back to your repository.
   - **Edit Ledger**: View the list of already-alerted results and clear specific lines if you want to re-enable alerts for those degree titles.

