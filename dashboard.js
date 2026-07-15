// GitHub API Client & UI Controller
let GITHUB_REPO = '';
let GITHUB_TOKEN = '';
let categoriesData = [];
let categoriesSha = '';
let stateData = { alerted_lines: {} };
let stateSha = '';

// DOM Elements
const repoInput = document.getElementById('repo-input');
const tokenInput = document.getElementById('token-input');
const connectBtn = document.getElementById('connect-btn');
const indicator = document.getElementById('connection-indicator');

const controlCard = document.getElementById('control-card');
const triggerWorkflowBtn = document.getElementById('trigger-workflow-btn');
const historyList = document.getElementById('history-list');
const historyLoading = document.getElementById('history-loading');

const configCard = document.getElementById('config-card');
const categoriesContainer = document.getElementById('categories-container');
const addCategoryBtn = document.getElementById('add-category-btn');
const saveConfigBtn = document.getElementById('save-config-btn');

const stateCard = document.getElementById('state-card');
const ledgerContainer = document.getElementById('ledger-container');
const saveStateBtn = document.getElementById('save-state-btn');

// Modal Elements
const categoryModal = document.getElementById('category-modal');
const modalTitle = document.getElementById('modal-title');
const modalCategoryIndex = document.getElementById('modal-category-index');
const modalCategoryId = document.getElementById('modal-category-id');
const modalCategoryLabel = document.getElementById('modal-category-label');
const modalCategoryChat = document.getElementById('modal-category-chat');
const modalCategoryKeywords = document.getElementById('modal-category-keywords');
const modalCancelBtn = document.getElementById('modal-cancel-btn');
const modalSaveBtn = document.getElementById('modal-save-btn');

// Initial Setup
document.addEventListener('DOMContentLoaded', () => {
  const savedRepo = localStorage.getItem('sppu_gh_repo');
  const savedToken = localStorage.getItem('sppu_gh_token');
  
  if (savedRepo) repoInput.value = savedRepo;
  if (savedToken) tokenInput.value = savedToken;

  if (savedRepo && savedToken) {
    connectAndLoad();
  }
});

// Toast Helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${message}</span>
    <button class="clear-btn" style="margin-left: 1rem; color: inherit;" onclick="this.parentElement.remove()">✕</button>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '1';
  }, 10);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// GitHub API Headers Helper
function getHeaders() {
  return {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json'
  };
}

// Base64 Helpers with UTF-8 support
function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function decodeBase64(str) {
  return decodeURIComponent(escape(atob(str.replace(/\s/g, ''))));
}

// Connect Handler
connectBtn.addEventListener('click', connectAndLoad);

async function connectAndLoad() {
  GITHUB_REPO = repoInput.value.trim();
  GITHUB_TOKEN = tokenInput.value.trim();

  if (!GITHUB_REPO || !GITHUB_TOKEN) {
    showToast('Please enter both Repository and Token.', 'error');
    return;
  }

  // Update UI State
  connectBtn.disabled = true;
  connectBtn.innerText = 'Connecting...';
  indicator.className = 'indicator loading';
  indicator.innerText = 'Connecting';

  try {
    // 1. Verify credentials by fetching repo details
    const repoRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}`, {
      headers: getHeaders()
    });

    if (!repoRes.ok) {
      throw new Error('Failed to access repository. Please check your repo string and token.');
    }

    localStorage.setItem('sppu_gh_repo', GITHUB_REPO);
    localStorage.setItem('sppu_gh_token', GITHUB_TOKEN);

    showToast('Successfully connected to GitHub!');
    indicator.className = 'indicator connected';
    indicator.innerText = 'Connected';

    // 2. Enable cards
    controlCard.classList.remove('disabled-card');
    configCard.classList.remove('disabled-card');
    stateCard.classList.remove('disabled-card');
    triggerWorkflowBtn.disabled = false;
    addCategoryBtn.disabled = false;
    saveConfigBtn.disabled = false;
    saveStateBtn.disabled = false;

    // 3. Load files and history
    await Promise.all([
      loadCategoriesFile(),
      loadStateFile(),
      loadWorkflowHistory()
    ]);

  } catch (error) {
    console.error(error);
    showToast(error.message, 'error');
    indicator.className = 'indicator disconnected';
    indicator.innerText = 'Disconnected';
    
    // Disable cards
    controlCard.classList.add('disabled-card');
    configCard.classList.add('disabled-card');
    stateCard.classList.add('disabled-card');
    triggerWorkflowBtn.disabled = true;
    addCategoryBtn.disabled = true;
    saveConfigBtn.disabled = true;
    saveStateBtn.disabled = true;
  } finally {
    connectBtn.disabled = false;
    connectBtn.innerText = 'Connect & Load Platform';
  }
}

// --- Scraper / Workflow Actions ---
async function loadWorkflowHistory() {
  historyLoading.style.display = 'flex';
  historyList.innerHTML = '';
  
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/check_result.yml/runs?per_page=6`, {
      headers: getHeaders()
    });
    
    if (!res.ok) throw new Error('Could not fetch actions history.');
    
    const data = await res.json();
    historyLoading.style.display = 'none';

    if (!data.workflow_runs || data.workflow_runs.length === 0) {
      historyList.innerHTML = '<li class="no-alerts">No workflow execution history found.</li>';
      return;
    }

    data.workflow_runs.forEach(run => {
      const durationStr = run.run_started_at 
        ? Math.round((new Date(run.updated_at) - new Date(run.run_started_at)) / 1000) + 's' 
        : 'N/A';
      
      const startedTime = new Date(run.run_started_at).toLocaleString('en-IN', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata'
      });

      let statusClass = 'running';
      let statusLabel = run.status;
      if (run.status === 'completed') {
        statusClass = run.conclusion === 'success' ? 'success' : 'failed';
        statusLabel = run.conclusion || 'completed';
      }

      const li = document.createElement('li');
      li.className = 'history-item';
      li.innerHTML = `
        <div class="history-header">
          <span class="run-num">#${run.run_number}</span>
          <span class="run-status ${statusClass}">${statusLabel}</span>
        </div>
        <div class="history-meta">
          <span>Started: ${startedTime}</span>
          <span>Duration: ${durationStr}</span>
        </div>
      `;
      historyList.appendChild(li);
    });

  } catch (error) {
    historyLoading.style.display = 'none';
    historyList.innerHTML = `<li class="no-alerts" style="color: var(--color-danger);">${error.message}</li>`;
  }
}

triggerWorkflowBtn.addEventListener('click', async () => {
  triggerWorkflowBtn.disabled = true;
  triggerWorkflowBtn.innerText = 'Triggering...';

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/check_result.yml/dispatches`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ref: 'main' })
    });

    if (!res.ok) throw new Error('Failed to trigger workflow. Ensure the bot script exists on the main branch.');
    
    showToast('Workflow triggered! It will start running in a few seconds.', 'success');
    
    // Refresh history after 5 seconds
    setTimeout(loadWorkflowHistory, 5000);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    triggerWorkflowBtn.disabled = false;
    triggerWorkflowBtn.innerText = 'Run Scraper Now';
  }
});

// --- Categories Configuration Editor ---
async function loadCategoriesFile() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/categories.json`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Could not find categories.json in repository.');
    
    const data = await res.json();
    categoriesSha = data.sha;
    categoriesData = JSON.parse(decodeBase64(data.content));
    renderCategories();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderCategories() {
  categoriesContainer.innerHTML = '';
  if (categoriesData.length === 0) {
    categoriesContainer.innerHTML = '<p class="no-alerts">No categories set. Click add to create one.</p>';
    return;
  }

  categoriesData.forEach((cat, index) => {
    const row = document.createElement('div');
    row.className = 'category-row';
    row.innerHTML = `
      <div class="category-title-bar">
        <span class="category-label">${cat.label}</span>
        <span class="category-id-badge">${cat.id}</span>
      </div>
      <div class="category-chat">Telegram Chat ID: <code>${cat.telegram_chat_id}</code></div>
      <div class="category-keywords">
        ${cat.match_any_of.map(kw => `<span class="keyword-tag">${kw}</span>`).join('')}
      </div>
      <div class="category-actions">
        <button class="btn secondary" onclick="editCategory(${index})">Edit</button>
        <button class="btn danger" onclick="deleteCategory(${index})">Delete</button>
      </div>
    `;
    categoriesContainer.appendChild(row);
  });
}

window.editCategory = function(index) {
  const cat = categoriesData[index];
  modalTitle.innerText = 'Edit Category';
  modalCategoryIndex.value = index;
  modalCategoryId.value = cat.id;
  modalCategoryId.disabled = true; // Avoid renaming ID which would break state mappings
  modalCategoryLabel.value = cat.label;
  modalCategoryChat.value = cat.telegram_chat_id;
  modalCategoryKeywords.value = cat.match_any_of.join(', ');
  
  categoryModal.classList.add('open');
};

window.deleteCategory = function(index) {
  if (confirm(`Are you sure you want to delete the "${categoriesData[index].label}" category?`)) {
    categoriesData.splice(index, 1);
    renderCategories();
    renderLedger(); // Keep state ledger in sync
  }
};

addCategoryBtn.addEventListener('click', () => {
  modalTitle.innerText = 'Add Category';
  modalCategoryIndex.value = '-1';
  modalCategoryId.value = '';
  modalCategoryId.disabled = false;
  modalCategoryLabel.value = '';
  modalCategoryChat.value = '';
  modalCategoryKeywords.value = '';
  
  categoryModal.classList.add('open');
});

modalCancelBtn.addEventListener('click', () => {
  categoryModal.classList.remove('open');
});

modalSaveBtn.addEventListener('click', () => {
  const index = parseInt(modalCategoryIndex.value, 10);
  const id = modalCategoryId.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  const label = modalCategoryLabel.value.trim();
  const chat = modalCategoryChat.value.trim();
  const keywords = modalCategoryKeywords.value
    .split(',')
    .map(kw => kw.trim())
    .filter(Boolean);

  if (!id || !label || !chat || keywords.length === 0) {
    alert('Please fill out all fields and provide at least one keyword.');
    return;
  }

  // Check unique ID on addition
  if (index === -1 && categoriesData.some(c => c.id === id)) {
    alert('A category with this ID already exists. Please choose a unique ID.');
    return;
  }

  const categoryObject = {
    id,
    label,
    telegram_chat_id: chat,
    match_any_of: keywords
  };

  if (index === -1) {
    categoriesData.push(categoryObject);
  } else {
    categoriesData[index] = categoryObject;
  }

  categoryModal.classList.remove('open');
  renderCategories();
  renderLedger();
});

saveConfigBtn.addEventListener('click', async () => {
  saveConfigBtn.disabled = true;
  saveConfigBtn.innerText = 'Saving...';

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/categories.json`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        message: 'Update categories config from Web Dashboard',
        content: encodeBase64(JSON.stringify(categoriesData, null, 2)),
        sha: categoriesSha
      })
    });

    if (!res.ok) throw new Error('Failed to save categories.json.');
    const result = await res.json();
    categoriesSha = result.content.sha; // Update local SHA
    showToast('Categories configuration saved and committed successfully!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    saveConfigBtn.disabled = false;
    saveConfigBtn.innerText = 'Save & Commit Config';
  }
});

// --- State/Alerted Ledger Editor ---
async function loadStateFile() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/state.json`, {
      headers: getHeaders()
    });
    if (!res.ok) throw new Error('Could not find state.json in repository.');
    
    const data = await res.json();
    stateSha = data.sha;
    stateData = JSON.parse(decodeBase64(data.content));
    renderLedger();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderLedger() {
  ledgerContainer.innerHTML = '';
  
  if (!stateData.alerted_lines) {
    stateData.alerted_lines = {};
  }

  // Build blocks for all categories currently defined
  if (categoriesData.length === 0) {
    ledgerContainer.innerHTML = '<p class="no-alerts">Configure categories to view state alerts.</p>';
    return;
  }

  categoriesData.forEach(cat => {
    const block = document.createElement('div');
    block.className = 'ledger-category-block';
    
    const alertedLines = stateData.alerted_lines[cat.id] || [];
    
    block.innerHTML = `
      <div class="ledger-category-title">
        <span>${cat.label}</span>
        <span class="ledger-count">${alertedLines.length} alerted</span>
      </div>
      <div class="ledger-list" id="ledger-list-${cat.id}">
        <!-- List entries -->
      </div>
    `;
    
    ledgerContainer.appendChild(block);
    
    const listEl = document.getElementById(`ledger-list-${cat.id}`);
    if (alertedLines.length === 0) {
      listEl.innerHTML = '<div class="no-alerts">No alerts triggered yet.</div>';
    } else {
      alertedLines.forEach((line, idx) => {
        const item = document.createElement('div');
        item.className = 'ledger-item';
        item.innerHTML = `
          <span class="ledger-text">${line}</span>
          <button class="clear-btn" onclick="clearLedgerItem('${cat.id}', ${idx})" title="Clear this alert">✕</button>
        `;
        listEl.appendChild(item);
      });
    }
  });
}

window.clearLedgerItem = function(catId, index) {
  if (stateData.alerted_lines[catId]) {
    stateData.alerted_lines[catId].splice(index, 1);
    renderLedger();
  }
};

saveStateBtn.addEventListener('click', async () => {
  saveStateBtn.disabled = true;
  saveStateBtn.innerText = 'Saving...';

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/state.json`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        message: 'Reset/Update alerted state from Web Dashboard',
        content: encodeBase64(JSON.stringify(stateData, null, 2)),
        sha: stateSha
      })
    });

    if (!res.ok) throw new Error('Failed to save state.json.');
    const result = await res.json();
    stateSha = result.content.sha; // Update local SHA
    showToast('Alerted results ledger saved and committed successfully!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    saveStateBtn.disabled = false;
    saveStateBtn.innerText = 'Save & Commit Ledger';
  }
});
