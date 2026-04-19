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

// ── Gestión de carpetas ───────────────────────────
async function loadFolders() {
  const folders = await dbGetFolders();
  const sel     = document.getElementById('folder-select');
  // Mantener selección actual
  const prev    = sel.value;
  sel.innerHTML = '<option value="">-- Elegí una carpeta --</option>';
  folders.sort((a,b) => a.name.localeCompare(b.name, 'es'))
         .forEach(f => {
    const opt = document.createElement('option');
    opt.value       = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if (prev) sel.value = prev;
}

async function addFolder() {
  const inp  = document.getElementById('folder-name-inp');
  const name = inp.value.trim();
  if (!name) { toast('Ingresá un nombre de carpeta', 'error'); return; }

  const folder = {
    id:      'folder_' + Date.now(),
    name,
    driveId: null, // se resuelve al subir
  };
  await dbSaveFolder(folder);
  inp.value = '';
  await loadFolders();
  // Seleccionar la carpeta recién creada
  document.getElementById('folder-select').value = folder.id;
  toast('Carpeta "' + name + '" agregada');
  renderFoldersSettings();
}

async function deleteFolder(id) {
  await dbDeleteFolder(id);
  await loadFolders();
  renderFoldersSettings();
  toast('Carpeta eliminada');
}

async function renderFoldersSettings() {
  const folders = await dbGetFolders();
  const cont    = document.getElementById('folders-settings-list');
  if (!folders.length) {
    cont.innerHTML = '<div style="color:var(--muted);font-size:.8rem;padding:8px 0;">Sin carpetas configuradas.</div>';
    return;
  }
  cont.innerHTML = folders.map(f => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);">
      <span style="font-size:1rem;">📁</span>
      <span style="flex:1;font-size:.88rem;">${f.name}</span>
      ${f.driveId ? '<span style="font-size:.65rem;color:#6dc86d;">✓ En Drive</span>' : '<span style="font-size:.65rem;color:var(--muted);">Local</span>'}
      <button class="item-btn del" onclick="deleteFolder('${f.id}')">🗑</button>
    </div>
  `).join('');
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

  const folderId  = document.getElementById('folder-select').value;
  const folders   = await dbGetFolders();
  const folder    = folders.find(f => f.id === folderId);
  const baseFilename = document.getElementById('rec-filename').value.trim() ||
    'sesion_' + new Date().toISOString().slice(0,16).replace(/[T:]/g,'-');
  const ext      = getFileExtension(_currentBlob.type);
  const filename = baseFilename.endsWith('.' + ext) ? baseFilename : baseFilename + '.' + ext;

  const rec = {
    id:         'rec_' + Date.now(),
    filename,
    folderId:   folder?.id || null,
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
