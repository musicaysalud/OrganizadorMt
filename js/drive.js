// ═══════════════════════════════════════════════════
// drive.js — Google Drive API v3
// OAuth2 PKCE flow (sin backend, 100% client-side)
// ═══════════════════════════════════════════════════

// ⚠️ CONFIGURAR: crear proyecto en console.cloud.google.com
// Habilitar "Google Drive API"
// Crear credencial OAuth2 → tipo "Aplicación web"
// Agregar como origen autorizado: la URL donde hospedarás la app
// Copiar el Client ID aquí:
const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com';

const DRIVE_SCOPE    = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_KEY      = 'mc_drive_token';
const USER_KEY       = 'mc_drive_user';

let _driveToken = null;
let _driveUser  = null;
let _tokenExpiry = 0;

// ── Inicializar: recuperar token guardado ─────────
async function driveInit() {
  const saved = await dbGetSetting(TOKEN_KEY);
  if (saved) {
    _driveToken  = saved.token;
    _tokenExpiry = saved.expiry || 0;
  }
  const user = await dbGetSetting(USER_KEY);
  if (user) _driveUser = user;

  if (_driveToken && Date.now() < _tokenExpiry) {
    driveUpdateUI(true);
  } else {
    _driveToken = null;
    driveUpdateUI(false);
  }
}

// ── Conectar con Google (OAuth2 Implicit / Token flow) ─
function connectGoogle() {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  window.location.origin + window.location.pathname,
    response_type: 'token',
    scope:         DRIVE_SCOPE + ' https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    include_granted_scopes: 'true',
    prompt:        'select_account',
  });
  // Guardar pantalla actual para volver
  sessionStorage.setItem('mc_pre_auth_screen', 'settings');
  window.location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString();
}

// ── Procesar token al volver del redirect ─────────
async function driveHandleRedirect() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return false;

  const params = new URLSearchParams(hash.substring(1));
  const token  = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') || '3600');
  if (!token) return false;

  _driveToken  = token;
  _tokenExpiry = Date.now() + expiresIn * 1000 - 60000; // -1 min margen

  // Limpiar URL
  history.replaceState(null, '', window.location.pathname);

  // Obtener info del usuario
  try {
    const res  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + token }
    });
    _driveUser = await res.json();
    await dbSetSetting(USER_KEY, _driveUser);
  } catch(e) {
    _driveUser = { name: 'Usuario', email: '' };
  }

  await dbSetSetting(TOKEN_KEY, { token: _driveToken, expiry: _tokenExpiry });
  driveUpdateUI(true);
  return true;
}

// ── Desconectar ───────────────────────────────────
async function disconnectGoogle() {
  showModal(
    'Desconectar cuenta',
    '¿Desconectar tu cuenta de Google? Las grabaciones pendientes no se subirán automáticamente.',
    [
      { label: 'Cancelar', action: closeModal, style: 'outline' },
      { label: 'Desconectar', style: 'danger', action: async () => {
        _driveToken = null; _driveUser = null; _tokenExpiry = 0;
        await dbSetSetting(TOKEN_KEY, null);
        await dbSetSetting(USER_KEY, null);
        driveUpdateUI(false);
        closeModal();
        toast('Cuenta desconectada');
      }}
    ]
  );
}

// ── Actualizar UI según estado ────────────────────
function driveUpdateUI(connected) {
  const btnConnect = document.getElementById('btn-google-connect');
  const statusDiv  = document.getElementById('google-status');
  const syncDot    = document.getElementById('sync-dot');
  const syncText   = document.getElementById('sync-text');

  if (connected && _driveUser) {
    btnConnect.style.display = 'none';
    statusDiv.style.display  = 'flex';
    document.getElementById('google-name').textContent  = _driveUser.name  || 'Usuario';
    document.getElementById('google-email').textContent = _driveUser.email || '';
    const avatar = document.getElementById('google-avatar');
    if (_driveUser.picture) {
      avatar.innerHTML = `<img src="${_driveUser.picture}" alt="avatar">`;
    }
    syncDot.style.background  = '#6dc86d';
    syncText.textContent      = 'Drive conectado';
  } else {
    btnConnect.style.display = 'flex';
    statusDiv.style.display  = 'none';
    syncDot.style.background  = 'var(--muted)';
    syncText.textContent      = 'Sin conexión Drive';
  }
}

function driveIsConnected() {
  return !!_driveToken && Date.now() < _tokenExpiry;
}

// ── Buscar o crear carpeta en Drive ───────────────
async function driveFindOrCreateFolder(name, parentId) {
  if (!driveIsConnected()) throw new Error('No conectado a Drive');

  // Buscar carpeta existente
  const q = parentId
    ? `name='${name}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)`,
    { headers: { Authorization: 'Bearer ' + _driveToken } }
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0].id;
  }

  // Crear carpeta
  const meta = { name, mimeType: 'application/vnd.google-apps.folder' };
  if (parentId) meta.parents = [parentId];
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      Authorization:  'Bearer ' + _driveToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meta),
  });
  const created = await createRes.json();
  return created.id;
}

// ── Subir archivo a Drive ─────────────────────────
async function driveUploadFile(blob, filename, folderId, onProgress) {
  if (!driveIsConnected()) throw new Error('No conectado a Drive');

  const meta = {
    name:    filename,
    parents: folderId ? [folderId] : [],
  };

  // Iniciar sesión de upload resumible
  const initRes = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization:   'Bearer ' + _driveToken,
        'Content-Type':  'application/json',
        'X-Upload-Content-Type': blob.type,
        'X-Upload-Content-Length': blob.size,
      },
      body: JSON.stringify(meta),
    }
  );

  if (!initRes.ok) throw new Error('Error iniciando upload: ' + initRes.status);
  const uploadUrl = initRes.headers.get('Location');

  // Subir con XHR para progreso
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error('Upload falló: ' + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red durante upload'));
    xhr.send(blob);
  });
}

// ── Sincronizar pendientes ────────────────────────
async function driveSyncPending() {
  if (!driveIsConnected()) return;
  const wifiOnly = await dbGetSetting('wifi_only', true);
  if (wifiOnly && !navigator.onLine) return;

  const pending = await dbGetPendingRecordings();
  if (!pending.length) return;

  for (const rec of pending) {
    try {
      await dbUpdateRecordingStatus(rec.id, 'uploading');
      renderRecordingsList(); // actualizar UI

      // Obtener el blob del audio
      const blob = rec.audioBlob;
      if (!blob) { await dbUpdateRecordingStatus(rec.id, 'error'); continue; }

      // Subir a Drive
      const driveFile = await driveUploadFile(blob, rec.filename, rec.folderId);
      await dbUpdateRecordingStatus(rec.id, 'uploaded', driveFile.id);
      toast('✓ ' + rec.filename + ' subido a Drive', 'success');
    } catch(e) {
      console.error('Error subiendo', rec.id, e);
      await dbUpdateRecordingStatus(rec.id, 'error');
    }
  }
  renderRecordingsList();
}
