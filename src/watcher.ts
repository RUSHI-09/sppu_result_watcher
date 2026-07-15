import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';

const DASHBOARD_URL = 'https://onlineresults.unipune.ac.in/result/dashboard/default';
const STATE_FILE = path.join(process.cwd(), 'state.json');
const CATEGORIES_FILE = path.join(process.cwd(), 'categories.json');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

interface Category {
  id: string;
  label: string;
  telegram_chat_id: string;
  match_any_of: string[];
}

interface State {
  alerted_lines: { [categoryId: string]: string[] };
}

function normalize(text: string): string {
  return text
    .toUpperCase()
    // First remove dots (so B.E. becomes BE, M.C.A. becomes MCA)
    .replace(/\./g, '')
    // Replace non-alphanumeric with spaces to separate words
    .replace(/[^A-Z0-9\s]/g, ' ')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isWordMatch(normLine: string, normKeyword: string): boolean {
  if (!normKeyword) return false;
  const regex = new RegExp(`\\b${escapeRegExp(normKeyword)}\\b`);
  return regex.test(normLine);
}

function loadCategories(): Category[] {
  try {
    if (fs.existsSync(CATEGORIES_FILE)) {
      const data = fs.readFileSync(CATEGORIES_FILE, 'utf8');
      return JSON.parse(data) as Category[];
    }
  } catch (error) {
    console.error('Failed to load categories.json:', error);
  }
  return [];
}

function loadState(): State {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(data) as State;
    }
  } catch (error) {
    console.error('Failed to load state.json:', error);
  }
  return { alerted_lines: {} };
}

function saveState(state: State) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (error) {
    console.error('Failed to save state.json:', error);
  }
}

async function sendTelegram(chatId: string, message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.log(`[Telegram] Skipped alert (TELEGRAM_BOT_TOKEN not set) for ${chatId}: ${message.replace(/\n/g, ' ')}`);
    return false;
  }
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });
    const result = await response.json() as any;
    if (response.ok && result.ok) {
      console.log(`[Telegram] Successfully alerted ${chatId}`);
      return true;
    } else {
      console.error(`[Telegram] API error for ${chatId}:`, result);
      return false;
    }
  } catch (error) {
    console.error(`[Telegram] Network error alerting ${chatId}:`, error);
    return false;
  }
}

async function fetchDashboardText(): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });
    const page = await context.newPage();
    
    console.log(`Navigating to ${DASHBOARD_URL}...`);
    // domcontentloaded wait since networkidle hangs on unipune site due to background requests
    await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    
    // Give 4 seconds for JS SPA to render result tables
    await page.waitForTimeout(4000);
    
    const bodyText = await page.innerText('body');
    return bodyText;
  } finally {
    await browser.close();
  }
}

async function main() {
  const categories = loadCategories();
  if (categories.length === 0) {
    console.error('No categories loaded. Exiting.');
    return;
  }

  const state = loadState();
  if (!state.alerted_lines) {
    state.alerted_lines = {};
  }

  let bodyText = '';
  try {
    bodyText = await fetchDashboardText();
  } catch (error) {
    console.warn(`[Scraper] Error fetching dashboard this cycle (site might be offline/slow):`, error);
    // Graceful exit, let Github Actions retry next cron
    return;
  }

  const lines = bodyText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  let stateChanged = false;

  for (const rawLine of lines) {
    const normLine = normalize(rawLine);
    if (!normLine) continue;

    for (const category of categories) {
      const isMatch = category.match_any_of.some(keyword => {
        const normKeyword = normalize(keyword);
        return isWordMatch(normLine, normKeyword);
      });

      if (isMatch) {
        if (!state.alerted_lines[category.id]) {
          state.alerted_lines[category.id] = [];
        }

        // Check if we've already alerted on this line for this category
        const alreadyAlerted = state.alerted_lines[category.id].includes(rawLine);
        if (!alreadyAlerted) {
          console.log(`[MATCH] Category: ${category.label} | Line: "${rawLine}"`);
          
          const timestamp = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
          });

          const message = `🔔 SPPU Result Declared!\n\n` +
                          `Faculty/Category: ${category.label}\n` +
                          `Result: ${rawLine}\n` +
                          `Declared On: ${timestamp} (IST)\n\n` +
                          `Check result here:\n${DASHBOARD_URL}`;

          const success = await sendTelegram(category.telegram_chat_id, message);
          if (success) {
            state.alerted_lines[category.id].push(rawLine);
            stateChanged = true;
          }
        }
      }
    }
  }

  if (stateChanged) {
    saveState(state);
    console.log('state.json updated.');
  } else {
    console.log('No new results found or matched.');
  }
}

main().catch(error => {
  console.error('Fatal execution error:', error);
});
