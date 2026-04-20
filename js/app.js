// ═══════════════════════════════════════════════════
// app.js — Lógica principal MusiCare Mobile
// ═══════════════════════════════════════════════════

// ── Inicialización ────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await dbOpen();
  await driveInit();

  // Manejar redirect OAuth2
  if (window.location.hash.includes('access_token')) {
    const ok = await driveHandleRedirect();
    if (ok) {
      toast('✓ Cuenta de Google conectada', 'success');
      goScreen('settings');
    }
  }

  await loadFolders();
  await loadSettings();
  renderRecordingsList();

  // Nombre automático basado en fecha/hora
  setAutoFilename();

  // Sincronizar pendientes al iniciar si hay conexión
  window.addEventListener('online', () => {
    syncDot('online');
    driveSyncPending();
  });
  window.addEventListener('offline', () => syncDot('offline'));
  if (navigator.onLine && driveIsConnected()) driveSyncPending();

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
  }
});

function syncDot(state) {
  const dot  = document.getElementById('sync-dot');
  const text = document.getElementById('sync-text');
  if (state === 'online' && driveIsConnected()) {
    dot.style.background = '#6dc86d';
    text.textContent     = 'Drive conectado';
  } else {
    dot.style.background = 'var(--muted)';
    text.textContent     = navigator.onLine ? 'Sin Drive' : 'Sin conexión';
  }
}

// ── Navegación entre pantallas ────────────────────
function goScreen(name, btn) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('on'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('on');
  if (btn) btn.classList.add('active');
  else {
    const map = { record: 0, list: 1, settings: 2 };
    const idx = map[name];
    if (idx !== undefined) document.querySelectorAll('.nav-btn')[idx]?.classList.add('active');
  }
  if (name === 'list')     renderRecordingsList();
  if (name === 'settings') renderFoldersSettings();
}

// ── Gestión de carpetas guardadas ─────────────────
var _selectedFolder = null; // { id, name, driveId }

async function loadFolders() {
  // Restaurar carpeta seleccionada previamente
  const saved = await dbGetSetting('last_folder');
  if (saved) {
    _selectedFolder = saved;
    updateFolderDisplay();
  }
}

function updateFolderDisplay() {
  const nameEl = document.getElementById('folder-display-name');
  const icoEl  = document.getElementById('folder-display-ico');
  if (_selectedFolder) {
    nameEl.textContent = _selectedFolder.name;
    nameEl.classList.remove('placeholder');
    icoEl.textContent  = '📂';
  } else {
    nameEl.textContent = 'Tocá para elegir carpeta...';
    nameEl.classList.add('placeholder');
    icoEl.textContent  = '📁';
  }
}

async function deleteFolder(id) {
  await dbDeleteFolder(id);
  if (_selectedFolder && _selectedFolder.id === id) {
    _selectedFolder = null;
    updateFolderDisplay();
  }
  renderFoldersSettings();
  toast('Carpeta eliminada de favoritos');
}

async function renderFoldersSettings() {
  const folders = await dbGetFolders();
  const cont    = document.getElementById('folders-settings-list');
  if (!folders.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:8px 0;">Sin carpetas favoritas guardadas.</div>';
    return;
  }
  cont.innerHTML = folders.map(f => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:1rem;">📂</span>
      <div style="flex:1;">
        <div style="font-size:.88rem;">${f.name}</div>
        <div style="font-size:.68rem;color:var(--muted);">${f.path || ''}</div>
      </div>
      <button class="item-btn" onclick="selectSavedFolder('${f.id}')" title="Usar esta">✓</button>
      <button class="item-btn del" onclick="deleteFolder('${f.id}')" title="Eliminar">🗑</button>
    </div>
  `).join('');
}

async function selectSavedFolder(id) {
  const folders = await dbGetFolders();
  const f = folders.find(x => x.id === id);
  if (!f) return;
  _selectedFolder = f;
  await dbSetSetting('last_folder', f);
  updateFolderDisplay();
  toast('Carpeta: ' + f.name);
}

// ══════════════════════════════════════════════════
// SELECTOR DE CARPETAS DE DRIVE (panel desplegable)
// ══════════════════════════════════════════════════
var _fpStack    = []; // historial de navegación [{id, name}]
var _fpCurId    = null;
var _fpCurName  = 'Mi Drive';

async function openFolderPicker() {
  if (!driveIsConnected()) {
    toast('Conectá Drive primero en Ajustes', 'error');
    return;
  }
  _fpStack         = [];
  _fpCurId         = null;
  _fpCurName       = 'Todas las carpetas';
  _allFoldersCache = [];

  const panel = document.getElementById('folder-picker-panel');
  const btn   = document.getElementById('fp-select-here-btn');
  if (!panel) { toast('Error: panel no encontrado', 'error'); return; }
  if (btn) btn.style.display = 'none';
  panel.classList.add('on');

  try {
    await fpLoadList();
  } catch(e) {
    console.error('fpLoadList error:', e);
    const list = document.getElementById('folder-picker-list');
    if (list) list.innerHTML = '<div style="padding:20px;color:var(--red);font-size:.82rem;">Error: ' + e.message + '</div>';
  }
}

function closeFolderPicker() {
  document.getElementById('folder-picker-panel').classList.remove('on');
}

async function fpNavRoot() {
  _fpStack   = [];
  _fpCurId   = null;
  _fpCurName = 'Mi Drive';
  document.getElementById('fp-select-here-btn').style.display = 'none';
  await fpLoadList();
}

async function fpNavInto(id, name) {
  _fpStack.push({ id: _fpCurId, name: _fpCurName });
  _fpCurId   = id;
  _fpCurName = name;
  document.getElementById('fp-select-here-btn').style.display = 'flex';
  await fpLoadList();
}

async function fpNavBack() {
  if (!_fpStack.length) return;
  const prev = _fpStack.pop();
  _fpCurId   = prev.id;
  _fpCurName = prev.name;
  document.getElementById('fp-select-here-btn').style.display =
    _fpStack.length > 0 ? 'flex' : 'none';
  await fpLoadList();
}

// Cache de todas las carpetas para navegación
var _allFoldersCache = [];

async function fpLoadAllFolders() {
  if (_allFoldersCache.length) return _allFoldersCache;
  try {
    // Primer intento: con allDrives (incluye carpetas del ordenador)
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/files' +
      '?q=' + encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false") +
      '&fields=files(id,name,parents)&orderBy=name&pageSize=1000' +
      '&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=allDrives',
      { headers: { Authorization: 'Bearer ' + _driveToken } }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    _allFoldersCache = data.files || [];

    // Si no trajo nada, intentar solo Mi unidad
    if (!_allFoldersCache.length) {
      const res2 = await fetch(
        'https://www.googleapis.com/drive/v3/files' +
        '?q=' + encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false") +
        '&fields=files(id,name,parents)&orderBy=name&pageSize=500',
        { headers: { Authorization: 'Bearer ' + _driveToken } }
      );
      const data2 = await res2.json();
      _allFoldersCache = data2.files || [];
    }
  } catch(e) {
    console.error('fpLoadAllFolders error:', e);
    // Fallback: solo Mi unidad sin opciones extra
    try {
      const res3 = await fetch(
        'https://www.googleapis.com/drive/v3/files' +
        '?q=' + encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false") +
        '&fields=files(id,name,parents)&orderBy=name&pageSize=500',
        { headers: { Authorization: 'Bearer ' + _driveToken } }
      );
      const data3 = await res3.json();
      _allFoldersCache = data3.files || [];
    } catch(e2) {
      _allFoldersCache = [];
      throw e2;
    }
  }
  return _allFoldersCache;
}

async function fpLoadList() {
  // Verificar token antes de cualquier cosa
  if (!_driveToken) {
    const list = document.getElementById('folder-picker-list');
    if (list) list.innerHTML = `
      <div style="padding:24px 18px;text-align:center;color:var(--muted);font-size:.85rem;line-height:1.8;">
        <div style="font-size:1.8rem;margin-bottom:10px;">🔑</div>
        No hay sesión de Drive activa.<br>
        <button onclick="closeFolderPicker();goScreen('settings')" 
          class="btn-accent" style="margin-top:14px;width:100%;">
          Ir a Ajustes → Conectar Drive
        </button>
      </div>`;
    return;
  }

  // Breadcrumb
  const bc = document.getElementById('folder-picker-breadcrumb');
  let bcHtml = '<span class="breadcrumb-item" onclick="fpNavRoot()">Raíz</span>';
  _fpStack.forEach((item, i) => {
    bcHtml += '<span class="breadcrumb-sep">›</span>';
    bcHtml += `<span class="breadcrumb-item" onclick="fpNavToIdx(${i})">${item.name}</span>`;
  });
  if (_fpCurId) {
    bcHtml += '<span class="breadcrumb-sep">›</span>';
    bcHtml += `<span style="color:var(--text);">${_fpCurName}</span>`;
  }
  bc.innerHTML = bcHtml;
  document.getElementById('folder-picker-title').textContent = '📁 ' + _fpCurName;

  const list = document.getElementById('folder-picker-list');
  list.innerHTML = '<div id="folder-picker-loading">⟳ Cargando...</div>';

  const savedFolders = await dbGetFolders();
  const allFolders   = await fpLoadAllFolders();

  // Construir un Set con todos los IDs existentes para detectar raíces
  const allIds = new Set(allFolders.map(f => f.id));

  let folders = [];

  if (_fpCurId === '__ROOT__' || _fpCurId === null) {
    // Mostrar raíces: carpetas cuyos parents no existen en la lista
    // = son raíces de "Mi PC" / carpetas del ordenador
    folders = allFolders.filter(f => {
      if (!f.parents || !f.parents.length) return true; // sin padre = raíz
      return !f.parents.some(p => allIds.has(p)); // padre no conocido = raíz
    });
  } else {
    // Hijos directos de la carpeta actual
    folders = allFolders.filter(f =>
      f.parents && f.parents.includes(_fpCurId)
    );
  }

  folders.sort((a,b) => a.name.localeCompare(b.name, 'es'));

  let html = '';

  // Favoritas al tope solo en raíz
  if ((!_fpCurId || _fpCurId === '__ROOT__') && savedFolders.length) {
    html += '<div style="padding:8px 18px 4px;font-size:.65rem;color:var(--accent);' +
            'text-transform:uppercase;letter-spacing:.1em;">★ Favoritas</div>';
    html += savedFolders.map(f =>
      `<div class="fp-item saved" onclick="fpSelectFavorite('${f.id}')">
        <span class="fp-item-ico">📂</span>
        <span class="fp-item-name">${f.name}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <span class="fp-item-saved-badge">Usar</span>
          <button class="item-btn del" onclick="event.stopPropagation();deleteFolder('${f.id}')" 
            style="font-size:.8rem;padding:2px 6px;">🗑</button>
        </div>
      </div>`
    ).join('');
    if (folders.length) html += '<div style="height:1px;background:var(--border);margin:4px 0;"></div>';
  }

  if (!folders.length && _allFoldersCache.length === 0) {
    html += `<div style="padding:24px 18px;text-align:center;font-size:.82rem;color:var(--muted);line-height:1.8;">
      <div style="font-size:1.8rem;margin-bottom:8px;">📭</div>
      No se pudieron cargar las carpetas.<br>
      <small>Token: ${_driveToken ? '✓ activo' : '✗ sin token'}</small><br>
      <button onclick="_allFoldersCache=[];fpLoadList()" class="btn-accent" style="margin-top:12px;width:100%;">
        🔄 Reintentar
      </button>
      <button onclick="closeFolderPicker();disconnectGoogle()" class="btn-outline" style="margin-top:8px;width:100%;">
        Reconectar cuenta
      </button>
    </div>`;
  } else if (!folders.length) {
    html += '<div style="padding:20px 18px;font-size:.82rem;color:var(--muted);text-align:center;">' +
            'Sin subcarpetas aquí.<br><small>Podés usar esta carpeta.</small></div>';
  } else {
    html += folders.map(f => {
      const isSaved = savedFolders.some(s => s.driveId === f.id);
      const hasChildren = allFolders.some(x => x.parents && x.parents.includes(f.id));
      const safeName = f.name.replace(/'/g,"\\'").replace(/"/g,'&quot;');
      return `<div class="fp-item${isSaved?' saved':''}" 
                onclick="fpNavInto('${f.id}','${safeName}')">
        <span class="fp-item-ico">📁</span>
        <span class="fp-item-name">${f.name}</span>
        ${isSaved ? '<span class="fp-item-saved-badge">★</span>' : ''}
        <span class="fp-item-arrow">${hasChildren ? '›' : '·'}</span>
      </div>`;
    }).join('');
  }

  list.innerHTML = html;
}

async function fpSelectFavorite(id) {
  const folders = await dbGetFolders();
  const f = folders.find(x => x.id === id);
  if (!f) return;
  _selectedFolder = f;
  await dbSetSetting('last_folder', f);
  updateFolderDisplay();
  closeFolderPicker();
  toast('✓ Carpeta: ' + f.name, 'success');
}

async function fpNavToIdx(idx) {
  // Navegar a un punto del historial
  const target = _fpStack[idx];
  _fpStack = _fpStack.slice(0, idx);
  _fpCurId   = target.id;
  _fpCurName = target.name;
  document.getElementById('fp-select-here-btn').style.display =
    _fpCurId ? 'flex' : 'none';
  await fpLoadList();
}

async function fpSelectCurrent() {
  // Seleccionar la carpeta actual como destino
  const folder = {
    id:      'folder_' + Date.now(),
    name:    _fpCurName,
    driveId: _fpCurId,
    path:    [..._fpStack.map(s => s.name), _fpCurName].join(' / '),
  };

  // Guardar en favoritos si no está ya
  const existing = await dbGetFolders();
  const alreadySaved = existing.find(f => f.driveId === _fpCurId);
  if (!alreadySaved) {
    await dbSaveFolder(folder);
  } else {
    folder.id = alreadySaved.id;
  }

  _selectedFolder = folder;
  await dbSetSetting('last_folder', folder);
  updateFolderDisplay();
  closeFolderPicker();
  renderFoldersSettings();
  toast('✓ Carpeta: ' + folder.name, 'success');
}

// ── Nombre automático ─────────────────────────────
function setAutoFilename() {
  const now  = new Date();
  const d    = String(now.getDate()).padStart(2,'0');
  const m    = String(now.getMonth()+1).padStart(2,'0');
  const y    = now.getFullYear();
  const h    = String(now.getHours()).padStart(2,'0');
  const min  = String(now.getMinutes()).padStart(2,'0');
  document.getElementById('rec-filename').value = `${y}-${m}-${d}_${h}-${min}_sesion`;
}

// ── Guardar grabación ─────────────────────────────
async function saveRecording() {
  if (!_currentBlob) { toast('No hay grabación para guardar', 'error'); return; }

  const folder = _selectedFolder;
  const baseFilename = document.getElementById('rec-filename').value.trim() ||
    'sesion_' + new Date().toISOString().slice(0,16).replace(/[T:]/g,'-');
  const ext      = getFileExtension(_currentBlob.type);
  const filename = baseFilename.endsWith('.' + ext) ? baseFilename : baseFilename + '.' + ext;

  const rec = {
    id:         'rec_' + Date.now(),
    filename,
    folderId:   folder?.driveId || null,
    folderName: folder?.name || 'Sin carpeta',
    status:     'pending',
    createdAt:  Date.now(),
    duration:   getDuration(),
    audioBlob:  _currentBlob,
    size:       _currentBlob.size,
  };

  await dbSaveRecording(rec);
  discardRecording();
  setAutoFilename();
  toast('Grabación guardada', 'success');
  goScreen('list');

  // Intentar subir si hay conexión y Drive está conectado
  const autoUpload = await dbGetSetting('auto_upload', true);
  const wifiOnly   = await dbGetSetting('wifi_only', true);
  const canUpload  = driveIsConnected() && navigator.onLine && (!wifiOnly || isWifi());
  if (autoUpload && canUpload) {
    setTimeout(() => uploadRecording(rec.id), 800);
  }
}

function getDuration() {
  const timer = document.getElementById('rec-timer').textContent;
  return timer;
}

function isWifi() {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return true; // asumir wifi si no hay info
  return !['cellular','2g','3g','4g'].includes(conn.type);
}

// ── Subir grabación individual ────────────────────
async function uploadRecording(recId) {
  const rec = await dbGetRecording(recId);
  if (!rec || !rec.audioBlob) { toast('No se encontró el archivo', 'error'); return; }
  if (!driveIsConnected()) { toast('Conectá Drive primero', 'error'); return; }

  await dbUpdateRecordingStatus(recId, 'uploading');
  renderRecordingsList();

  try {
    // Resolver ID de carpeta en Drive
    let driveFolderId = null;
    if (rec.folderName && rec.folderName !== 'Sin carpeta') {
      driveFolderId = await driveFindOrCreateFolder(rec.folderName);
      // Guardar driveId en la carpeta local
      const folders = await dbGetFolders();
      const folder  = folders.find(f => f.id === rec.folderId);
      if (folder && !folder.driveId) {
        folder.driveId = driveFolderId;
        await dbSaveFolder(folder);
      }
    }

    await driveUploadFile(rec.audioBlob, rec.filename, driveFolderId, progress => {
      // Actualizar indicador de progreso en UI
      const item = document.getElementById('ri-' + recId);
      if (item) {
        const badge = item.querySelector('.rec-item-status');
        if (badge) badge.textContent = Math.round(progress * 100) + '%';
      }
    });

    await dbUpdateRecordingStatus(recId, 'uploaded');
    toast('✓ Subido a Drive: ' + rec.filename, 'success');
  } catch(e) {
    await dbUpdateRecordingStatus(recId, 'error');
    toast('Error al subir: ' + e.message, 'error');
  }
  renderRecordingsList();
}

// ── Renderizar lista de grabaciones ──────────────
async function renderRecordingsList() {
  const recs = await dbGetAllRecordings();
  const cont = document.getElementById('recordings-list');

  if (!recs.length) {
    cont.innerHTML = `
      <div class="empty-state">
        <div class="ico">🎙</div>
        Aún no hay grabaciones.<br>
        Usá la pestaña <strong>Grabar</strong> para comenzar.
      </div>`;
    return;
  }

  cont.innerHTML = recs.map(r => {
    const statusMap = {
      pending:   { cls: 'status-pending', txt: 'Pendiente' },
      uploading: { cls: 'status-pending', txt: '⟳ Subiendo' },
      uploaded:  { cls: 'status-ok',      txt: '✓ En Drive' },
      error:     { cls: 'status-error',   txt: '✗ Error' },
    };
    const st  = statusMap[r.status] || statusMap.pending;
    const dt  = new Date(r.createdAt);
    const date = `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()} ${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;
    const sz  = r.size ? (r.size > 1048576 ? (r.size/1048576).toFixed(1)+'MB' : (r.size/1024).toFixed(0)+'KB') : '';

    return `<div class="rec-item" id="ri-${r.id}">
      <span class="rec-item-ico">🎵</span>
      <div class="rec-item-info">
        <div class="rec-item-name">${r.filename}</div>
        <div class="rec-item-meta">📁 ${r.folderName} &nbsp;·&nbsp; ${date} &nbsp;·&nbsp; ${r.duration || ''} ${sz}</div>
      </div>
      <span class="rec-item-status ${st.cls}">${st.txt}</span>
      <div class="rec-item-actions">
        ${r.status !== 'uploaded' ? `<button class="item-btn" onclick="uploadRecording('${r.id}')" title="Subir a Drive">☁</button>` : ''}
        <button class="item-btn" onclick="playLocalRecording('${r.id}')" title="Reproducir">▶</button>
        <button class="item-btn del" onclick="confirmDeleteRec('${r.id}')" title="Eliminar">🗑</button>
      </div>
    </div>`;
  }).join('');
}

async function playLocalRecording(id) {
  const rec = await dbGetRecording(id);
  if (!rec || !rec.audioBlob) { toast('Archivo no disponible', 'error'); return; }
  const url  = URL.createObjectURL(rec.audioBlob);
  const audio = new Audio(url);
  audio.play();
  toast('▶ Reproduciendo: ' + rec.filename);
}

async function confirmDeleteRec(id) {
  const rec = await dbGetRecording(id);
  if (!rec) return;
  showModal(
    'Eliminar grabación',
    `¿Eliminár "${rec.filename}" del dispositivo? ${rec.status === 'uploaded' ? 'Ya está en Drive.' : 'No está en Drive todavía.'}`,
    [
      { label: 'Cancelar', action: closeModal, style: 'outline' },
      { label: 'Eliminar', style: 'danger', action: async () => {
        await dbDeleteRecording(id);
        closeModal();
        renderRecordingsList();
        toast('Grabación eliminada');
      }}
    ]
  );
}

// ── Ajustes ───────────────────────────────────────
async function loadSettings() {
  const wifiOnly  = await dbGetSetting('wifi_only', true);
  const autoUp    = await dbGetSetting('auto_upload', true);
  const quality   = await dbGetSetting('quality', '192000');

  setToggle('toggle-wifi', wifiOnly);
  setToggle('toggle-auto', autoUp);
  document.getElementById('quality-select').value = quality;
}

async function saveSettings() {
  const quality = document.getElementById('quality-select').value;
  await dbSetSetting('quality', quality);
}

function setToggle(id, on) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('on', on);
}

async function toggleWifi(el) {
  el.classList.toggle('on');
  await dbSetSetting('wifi_only', el.classList.contains('on'));
}

async function toggleAuto(el) {
  el.classList.toggle('on');
  await dbSetSetting('auto_upload', el.classList.contains('on'));
}

// ── Toast ─────────────────────────────────────────
let _toastTimeout = null;
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className   = 'show' + (type ? ' ' + type : '');
  clearTimeout(_toastTimeout);
  _toastTimeout = setTimeout(() => { el.className = ''; }, 3000);
}

// ── Modal ─────────────────────────────────────────
function showModal(title, body, actions) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').textContent  = body;
  const actDiv = document.getElementById('modal-actions');
  actDiv.innerHTML = '';
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    btn.className   = a.style === 'outline' ? 'btn-outline' : 'btn-accent';
    if (a.style === 'danger') { btn.style.background = 'none'; btn.style.border = '1px solid var(--red)'; btn.style.color = 'var(--red)'; }
    btn.onclick = a.action;
    actDiv.appendChild(btn);
  });
  document.getElementById('modal-overlay').classList.add('on');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('on');
}

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});
