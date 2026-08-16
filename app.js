/* ===================================================================
   Ledger — a personal notebook SPA that uses a GitHub repo as its
   "database". Every save is a real git commit via the Contents API.
   Everything runs client-side; nothing is sent anywhere except to
   api.github.com using the token the user supplies.
=================================================================== */

const DATA_PATH = 'data/notes.json';
const CONFIG_KEY = 'ledger_config_v1';

const state = {
  cfg: null,       // {owner, repo, branch, token}
  notes: [],        // array of note objects
  sha: null,        // current sha of data/notes.json (null if file doesn't exist yet)
  activeCategory: 'all',
  searchQuery: '',
  editingId: null,  // note id currently open in editor, or null for a new note
  previewOn: false,
};

// ---------- element refs ----------
const el = (id) => document.getElementById(id);
const setupScreen = el('setup-screen');
const app = el('app');
const statusBar = el('status-bar');

// ===================================================================
// Base64 <-> UTF8 helpers (GitHub content API is base64)
// ===================================================================
function b64EncodeUnicode(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function b64DecodeUnicode(b64) {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}
function shortId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===================================================================
// GitHub API
// ===================================================================
function ghHeaders() {
  return {
    'Authorization': `Bearer ${state.cfg.token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function ghGetFile(path) {
  const { owner, repo, branch } = state.cfg;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return { exists: false, sha: null, data: null };
  if (!res.ok) throw new Error(`GitHub GET ${res.status}: ${(await safeJson(res))?.message || res.statusText}`);
  const json = await res.json();
  const text = b64DecodeUnicode(json.content);
  return { exists: true, sha: json.sha, data: JSON.parse(text) };
}

async function ghPutFile(path, dataObj, message, sha) {
  const { owner, repo, branch } = state.cfg;
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message,
    content: b64EncodeUnicode(JSON.stringify(dataObj, null, 2)),
    branch,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`GitHub PUT ${res.status}: ${(await safeJson(res))?.message || res.statusText}`);
  const json = await res.json();
  return json.content.sha;
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

// ===================================================================
// Status bar
// ===================================================================
function setStatus(msg, isError = false) {
  statusBar.textContent = msg;
  statusBar.classList.toggle('error', isError);
}

// ===================================================================
// Config / boot
// ===================================================================
function loadConfig() {
  const raw = localStorage.getItem(CONFIG_KEY);
  return raw ? JSON.parse(raw) : null;
}
function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

async function boot() {
  const cfg = loadConfig();
  if (!cfg) {
    setupScreen.classList.remove('hidden');
    app.classList.add('hidden');
    return;
  }
  state.cfg = cfg;
  setupScreen.classList.add('hidden');
  app.classList.remove('hidden');
  el('repo-label').textContent = `${cfg.owner}/${cfg.repo}`;
  await loadNotesFromGitHub();
}

el('setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    owner: el('cfg-owner').value.trim(),
    repo: el('cfg-repo').value.trim(),
    branch: el('cfg-branch').value.trim() || 'main',
    token: el('cfg-token').value.trim(),
  };
  const errEl = el('setup-error');
  errEl.textContent = '';
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Connecting...';
  try {
    state.cfg = cfg;
    // test connection by trying to read (or create) the data file
    const result = await ghGetFile(DATA_PATH);
    if (!result.exists) {
      // create the data folder/file with an empty array
      state.sha = await ghPutFile(DATA_PATH, [], 'Ledger: initialize notes store', null);
      state.notes = [];
    } else {
      state.sha = result.sha;
      state.notes = result.data;
    }
    saveConfig(cfg);
    setupScreen.classList.add('hidden');
    app.classList.remove('hidden');
    el('repo-label').textContent = `${cfg.owner}/${cfg.repo}`;
    renderCategories();
    renderList();
    setStatus(`Connected to ${cfg.owner}/${cfg.repo}`);
  } catch (err) {
    errEl.textContent = err.message.includes('401') || err.message.includes('403')
      ? 'Token বা permission ঠিক নেই। Fine-grained token, Contents: Read & Write দিয়ে আবার চেষ্টা করো।'
      : err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Connect & Open Notebook →';
  }
});

el('logout-btn').addEventListener('click', () => {
  if (!confirm('Disconnect করলে এই ব্রাউজার থেকে token মুছে যাবে (notes মুছবে না, ওগুলো GitHub-এই থাকবে). এগিয়ে যাবে?')) return;
  localStorage.removeItem(CONFIG_KEY);
  location.reload();
});

async function loadNotesFromGitHub() {
  setStatus('Loading from GitHub...');
  try {
    const result = await ghGetFile(DATA_PATH);
    state.sha = result.sha;
    state.notes = result.exists ? result.data : [];
    renderCategories();
    renderList();
    setStatus(`Synced — ${state.notes.length} entries`);
  } catch (err) {
    setStatus(err.message, true);
  }
}
el('sync-btn').addEventListener('click', loadNotesFromGitHub);

// ===================================================================
// Rendering: category sidebar
// ===================================================================
function renderCategories() {
  const counts = {};
  state.notes.forEach(n => (n.categories || []).forEach(c => { counts[c] = (counts[c] || 0) + 1; }));
  const cats = Object.keys(counts).sort();

  const list = el('category-list');
  list.innerHTML = '';

  const allLi = document.createElement('li');
  allLi.innerHTML = `<span>সব</span><span class="count">${state.notes.length}</span>`;
  allLi.className = state.activeCategory === 'all' ? 'active' : '';
  allLi.addEventListener('click', () => { state.activeCategory = 'all'; renderCategories(); renderList(); });
  list.appendChild(allLi);

  cats.forEach(c => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(c)}</span><span class="count">${counts[c]}</span>`;
    li.className = state.activeCategory === c ? 'active' : '';
    li.addEventListener('click', () => { state.activeCategory = c; renderCategories(); renderList(); });
    list.appendChild(li);
  });
}

// ===================================================================
// Rendering: notes list
// ===================================================================
function getFilteredNotes() {
  let list = [...state.notes];
  if (state.activeCategory !== 'all') {
    list = list.filter(n => (n.categories || []).includes(state.activeCategory));
  }
  if (state.searchQuery.trim()) {
    const q = state.searchQuery.trim().toLowerCase();
    list = list.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q)
    );
  }
  return list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

function renderList() {
  const listEl = el('notes-list');
  const notes = getFilteredNotes();
  el('list-title').textContent = state.activeCategory === 'all' ? 'সব এন্ট্রি' : state.activeCategory;
  el('list-count').textContent = `${notes.length} entries`;

  listEl.innerHTML = '';
  el('empty-state').classList.toggle('hidden', notes.length !== 0);

  notes.forEach(n => {
    const card = document.createElement('div');
    card.className = 'note-card';
    const excerpt = (n.content || '').replace(/[#*`>_-]/g, '').slice(0, 140);
    card.innerHTML = `
      <div class="note-card-top">
        <span class="note-card-title">${escapeHtml(n.title || 'Untitled')}</span>
        <span class="note-id">#${n.id}</span>
      </div>
      <div class="note-card-excerpt">${escapeHtml(excerpt)}${excerpt.length === 140 ? '…' : ''}</div>
      <div class="note-card-meta">
        <span class="note-date">${n.date || ''}</span>
        ${(n.categories || []).map(c => `<span class="note-tag">${escapeHtml(c)}</span>`).join('')}
      </div>`;
    card.addEventListener('click', () => openEditor(n.id));
    listEl.appendChild(card);
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

el('search-input').addEventListener('input', (e) => {
  state.searchQuery = e.target.value;
  renderList();
});

// ===================================================================
// Editor
// ===================================================================
function openEditor(id) {
  state.editingId = id || null;
  state.previewOn = false;
  el('preview-pane').classList.add('hidden');
  el('edit-content').classList.remove('hidden');
  el('preview-toggle').textContent = 'Preview';

  const note = id ? state.notes.find(n => n.id === id) : null;
  el('edit-title').value = note ? note.title : '';
  el('edit-date').value = note ? note.date : new Date().toISOString().slice(0, 10);
  el('edit-categories').value = note ? (note.categories || []).join(', ') : '';
  el('edit-content').value = note ? note.content : '';
  el('delete-btn').classList.toggle('hidden', !note);

  el('list-view').classList.add('hidden');
  el('editor-view').classList.remove('hidden');
  el('edit-title').focus();
}

el('new-note-btn').addEventListener('click', () => openEditor(null));
el('back-btn').addEventListener('click', () => {
  el('editor-view').classList.add('hidden');
  el('list-view').classList.remove('hidden');
});

el('preview-toggle').addEventListener('click', () => {
  state.previewOn = !state.previewOn;
  el('edit-content').classList.toggle('hidden', state.previewOn);
  el('preview-pane').classList.toggle('hidden', !state.previewOn);
  el('preview-toggle').textContent = state.previewOn ? 'Edit' : 'Preview';
  if (state.previewOn) {
    el('preview-pane').innerHTML = marked.parse(el('edit-content').value || '*কিছু লেখা নেই*');
  }
});

el('save-btn').addEventListener('click', async () => {
  const title = el('edit-title').value.trim();
  if (!title) { alert('Title দাও।'); return; }
  const categories = el('edit-categories').value.split(',').map(s => s.trim()).filter(Boolean);
  const date = el('edit-date').value || new Date().toISOString().slice(0, 10);
  const content = el('edit-content').value;
  const now = new Date().toISOString();

  let note;
  if (state.editingId) {
    note = state.notes.find(n => n.id === state.editingId);
    note.title = title; note.categories = categories; note.date = date; note.content = content; note.updatedAt = now;
  } else {
    note = { id: shortId(), title, categories, date, content, createdAt: now, updatedAt: now };
    state.notes.push(note);
  }

  await commitNotes(state.editingId ? `Update: ${title}` : `Add: ${title}`);
  el('editor-view').classList.add('hidden');
  el('list-view').classList.remove('hidden');
  renderCategories();
  renderList();
});

el('delete-btn').addEventListener('click', async () => {
  if (!confirm('এই এন্ট্রি ডিলিট করবে? এটা GitHub-এও মুছে যাবে (git history-তে থেকে যাবে)।')) return;
  const title = state.notes.find(n => n.id === state.editingId)?.title || '';
  state.notes = state.notes.filter(n => n.id !== state.editingId);
  await commitNotes(`Delete: ${title}`);
  el('editor-view').classList.add('hidden');
  el('list-view').classList.remove('hidden');
  renderCategories();
  renderList();
});

async function commitNotes(message) {
  setStatus('Saving — committing to GitHub...');
  try {
    state.sha = await ghPutFile(DATA_PATH, state.notes, message, state.sha);
    setStatus(`Saved ✓ (${message})`);
  } catch (err) {
    setStatus(err.message, true);
    alert(`Save করা যায়নি: ${err.message}`);
  }
}

// ===================================================================
// Export
// ===================================================================
el('export-btn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.notes, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'notes-backup.json';
  a.click();
  URL.revokeObjectURL(url);
});

// ===================================================================
boot();
