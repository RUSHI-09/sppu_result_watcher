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
  enabled?: boolean;
  alert_existing?: boolean;
}

interface State {
  alerted_lines: { [categoryId: string]: string[] };
  alerted_results?: { [categoryId: string]: AlertRecord[] };
  seeded_categories?: { [categoryId: string]: string };
}

interface AlertRecord {
  key: string;
  line: string;
  first_alerted_at: string;
  last_seen_at: string;
}

interface ResultEntry {
  line: string;
  title: string;
  declaredDate?: string;
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

function cleanResultLine(rawLine: string): string {
  return rawLine.replace(/\s+/g, ' ').trim();
}

function resultKeyFromLine(line: string): string {
  return normalize(line)
    // SPPU table row numbers can change between runs; they are not part of
    // the result identity and caused repeated alerts for old declarations.
    .replace(/^\d+\s+/, '')
    .trim();
}

function parseResultRows(bodyText: string): ResultEntry[] {
  return bodyText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const columns = line
        .split('\t')
        .map(column => column.trim())
        .filter(Boolean);

      if (columns.length >= 2) {
        const maybeDate = columns[columns.length - 1];
        const titleColumns = columns.slice(0, -1);
        if (/^\d+$/.test(titleColumns[0])) {
          titleColumns.shift();
        }

        const title = cleanResultLine(titleColumns.join(' '));
        return {
          title,
          declaredDate: maybeDate,
          line: cleanResultLine(`${title} ${maybeDate}`),
        };
      }

      const cleanLine = cleanResultLine(line);
      return {
        title: cleanLine.replace(/^\d+\s+/, '').trim(),
        line: cleanLine,
      };
    })
    .filter(entry => entry.title);
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
      return (JSON.parse(data) as Category[]).filter(category => category.enabled !== false);
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

function ensureStateShape(state: State): boolean {
  let changed = false;

  if (!state.alerted_lines) {
    state.alerted_lines = {};
    changed = true;
  }

  if (!state.alerted_results) {
    state.alerted_results = {};
    changed = true;
  }

  if (!state.seeded_categories) {
    state.seeded_categories = {};
    changed = true;
  }

  const now = new Date().toISOString();
  for (const [categoryId, lines] of Object.entries(state.alerted_lines)) {
    if (!state.alerted_results[categoryId]) {
      state.alerted_results[categoryId] = [];
      changed = true;
    }

    const knownKeys = new Set(state.alerted_results[categoryId].map(record => record.key));
    const dedupedLines: string[] = [];
    const legacyKeys = new Set<string>();

    for (const line of lines) {
      const cleanLine = cleanResultLine(line);
      const key = resultKeyFromLine(cleanLine);
      if (!key) continue;

      if (!legacyKeys.has(key)) {
        dedupedLines.push(cleanLine);
        legacyKeys.add(key);
      }

      if (knownKeys.has(key)) continue;

      state.alerted_results[categoryId].push({
        key,
        line: cleanLine,
        first_alerted_at: now,
        last_seen_at: now,
      });
      knownKeys.add(key);
      changed = true;
    }

    if (dedupedLines.length !== lines.length || dedupedLines.some((line, index) => line !== lines[index])) {
      state.alerted_lines[categoryId] = dedupedLines;
      changed = true;
    }
  }

  return changed;
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
  const stateShapeChanged = ensureStateShape(state);
  const categoryHadHistoryAtStart = new Map<string, boolean>();
  const categorySeededAtStart = new Map<string, boolean>();
  for (const category of categories) {
    const records = state.alerted_results?.[category.id] || [];
    const lines = state.alerted_lines[category.id] || [];
    categoryHadHistoryAtStart.set(category.id, records.length > 0 || lines.length > 0);
    categorySeededAtStart.set(category.id, Boolean(state.seeded_categories?.[category.id]));
  }

  let bodyText = '';
  try {
    bodyText = await fetchDashboardText();
  } catch (error) {
    console.warn(`[Scraper] Error fetching dashboard this cycle (site might be offline/slow):`, error);
    // Graceful exit, let Github Actions retry next cron
    return;
  }

  const resultEntries = parseResultRows(bodyText);

  let stateChanged = stateShapeChanged;

  for (const resultEntry of resultEntries) {
    const normLine = normalize(resultEntry.title);
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
        if (!state.alerted_results![category.id]) {
          state.alerted_results![category.id] = [];
        }

        const cleanLine = resultEntry.line;
        const resultKey = resultKeyFromLine(cleanLine);
        if (!resultKey) continue;

        const categoryRecords = state.alerted_results![category.id];
        const shouldSeedExisting = category.alert_existing === false &&
          !categoryHadHistoryAtStart.get(category.id) &&
          !categorySeededAtStart.get(category.id);

        const existingRecord = categoryRecords.find(
          record => record.key === resultKey
        );
        const alreadyAlertedLegacy = state.alerted_lines[category.id].some(
          alertedLine => resultKeyFromLine(alertedLine) === resultKey
        );
        const alreadyAlerted = Boolean(existingRecord) || alreadyAlertedLegacy;

        if (!alreadyAlerted && shouldSeedExisting) {
          console.log(`[SEED] Category: ${category.label} | Line: "${cleanLine}"`);
          state.alerted_lines[category.id].push(cleanLine);
          categoryRecords.push({
            key: resultKey,
            line: cleanLine,
            first_alerted_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          });
          stateChanged = true;
        } else if (!alreadyAlerted) {
          console.log(`[MATCH] Category: ${category.label} | Line: "${cleanLine}"`);
          
          const timestamp = new Date().toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
          });

          const message = `SPPU Result Declared!\n\n` +
                          `Faculty/Category: ${category.label}\n` +
                          `Result: ${resultEntry.title}\n` +
                          (resultEntry.declaredDate ? `SPPU Declared Date: ${resultEntry.declaredDate}\n` : '') +
                          `Detected On: ${timestamp} (IST)\n\n` +
                          `Check result here:\n${DASHBOARD_URL}`;

          const success = await sendTelegram(category.telegram_chat_id, message);
          if (success) {
            state.alerted_lines[category.id].push(cleanLine);
            categoryRecords.push({
              key: resultKey,
              line: cleanLine,
              first_alerted_at: new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
            });
            stateChanged = true;
          }
        }
      }
    }
  }

  for (const category of categories) {
    if (category.alert_existing === false && !categorySeededAtStart.get(category.id)) {
      state.seeded_categories![category.id] = new Date().toISOString();
      stateChanged = true;
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
