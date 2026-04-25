// ══════════════════════════════════════════════════════════════════
// CRONOGRAMA — MusiCare Mobile
// Lee y escribe _musicare_sync.json en Google Drive
// ══════════════════════════════════════════════════════════════════

var _cronSyncData  = null;  // datos descargados de Drive
var _cronSyncFileId = null;
var _cronPatIdx    = 0;     // índice del paciente seleccionado
var _cronYear      = new Date().getFullYear();
var _cronMonth     = new Date().getMonth();

const MESES_MC = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const DIAS_MC  = ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'];

// ── Cargar datos al entrar a la pestaña ───────────────────────────
async function cronScreenLoad() {
  const cont = document.getElementById('cron-content');
  if (!cont) return;

  if (!driveIsConnected()) {
    cont.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);">
      <div style="font-size:2rem;margin-bottom:12px;">☁</div>
      Conectá Google Drive en Ajustes para ver el cronograma.
      <br><br>
      <button onclick="goScreen('settings')" class="btn-accent" style="width:100%">
        Ir a Ajustes
      </button>
    </div>`;
    return;
  }

  cont.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);">⟳ Cargando cronograma...</div>';

  try {
    await cronDownloadSync();
    cronRenderScreen();
  } catch(e) {
    cont.innerHTML = `<div style="padding:20px;color:var(--red);font-size:.82rem;">
      Error al cargar: ${e.message}<br><br>
      <button onclick="cronScreenLoad()" class="btn-accent" style="width:100%">🔄 Reintentar</button>
    </div>`;
  }
}

// ── Descargar _musicare_sync.json de Drive ────────────────────────
async function cronDownloadSync() {
  // Buscar el archivo
  if (!_cronSyncFileId) {
    const q   = "name='_musicare_sync.json' and trashed=false";
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)` +
      `&includeItemsFromAllDrives=true&supportsAllDrives=true`,
      { headers: { Authorization: 'Bearer ' + _driveToken } }
    );
    const data = await res.json();
    if (data.files && data.files.length > 0) {
      _cronSyncFileId = data.files[0].id;
    }
  }

  if (!_cronSyncFileId) {
    _cronSyncData = { pacientes: [], cronograma: {}, version: 2 };
    return;
  }

  const res2 = await fetch(
    `https://www.googleapis.com/drive/v3/files/${_cronSyncFileId}?alt=media`,
    { headers: { Authorization: 'Bearer ' + _driveToken } }
  );
  if (!res2.ok) throw new Error('Error descargando sync: ' + res2.status);
  _cronSyncData = await res2.json();
}

// ── Subir _musicare_sync.json a Drive ─────────────────────────────
async function cronUploadSync() {
  if (!_cronSyncData) return;
  _cronSyncData.lastModified   = new Date().toISOString();
  _cronSyncData.lastModifiedBy = 'mobile';

  const json = JSON.stringify(_cronSyncData);
  const blob = new Blob([json], { type: 'application/json' });

  if (_cronSyncFileId) {
    const res = await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${_cronSyncFileId}?uploadType=media`,
      {
        method:  'PATCH',
        headers: { Authorization: 'Bearer ' + _driveToken, 'Content-Type': 'application/json' },
        body:    blob,
      }
    );
    if (!res.ok) throw new Error('Upload falló: ' + res.status);
  } else {
    // Crear archivo nuevo
    const meta     = { name: '_musicare_sync.json' };
    const boundary = 'mc_cron_boundary';
    const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(meta)}\r\n`
              + `--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n`
              + `--${boundary}--`;
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          Authorization:  'Bearer ' + _driveToken,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      }
    );
    if (!res.ok) throw new Error('Crear archivo falló: ' + res.status);
    const d = await res.json();
    _cronSyncFileId = d.id;
  }
}

// ── Renderizar pantalla principal del cronograma ───────────────────
function cronRenderScreen() {
  const cont = document.getElementById('cron-content');
  if (!cont || !_cronSyncData) return;

  const pats = _cronSyncData.pacientes || [];
  if (!pats.length) {
    cont.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted);font-size:.85rem;">
      <div style="font-size:2rem;margin-bottom:12px;">📅</div>
      No hay pacientes sincronizados.<br>
      <small>Abrí MusiCare Desktop, andá al cronograma<br>y presioná ☁ para sincronizar.</small>
    </div>`;
    return;
  }

  const curPat = pats[_cronPatIdx] || pats[0];

  // Selector de paciente
  const patOpts = pats.map((p, i) =>
    `<option value="${i}" ${i === _cronPatIdx ? 'selected' : ''}>${p.nombre}</option>`
  ).join('');

  cont.innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      <!-- Selector de paciente -->
      <div style="padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border);flex-shrink:0;">
        <select id="cron-pat-sel" onchange="cronSelectPat(this.value)"
          style="width:100%;background:var(--surface3);border:1px solid var(--border);
                 color:var(--text);border-radius:8px;padding:9px 12px;font-size:.88rem;outline:none;">
          ${patOpts}
        </select>
      </div>
      <!-- Nav mes -->
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;
                  background:var(--surface);">
        <button onclick="cronNavMes(-1)" style="background:none;border:none;color:var(--accent);
          font-size:1.4rem;cursor:pointer;padding:4px 10px;">◀</button>
        <div style="font-size:.92rem;font-weight:600;color:var(--accent);">
          ${MESES_MC[_cronMonth]} ${_cronYear}
        </div>
        <button onclick="cronNavMes(1)" style="background:none;border:none;color:var(--accent);
          font-size:1.4rem;cursor:pointer;padding:4px 10px;">▶</button>
      </div>
      <!-- Calendario -->
      <div style="flex:1;overflow-y:auto;">
        <div id="cron-cal-body"></div>
      </div>
      <!-- Botón sync -->
      <div style="padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0;">
        <button onclick="cronSyncNow()" class="btn-outline" style="width:100%;font-size:.8rem;">
          ↻ Sincronizar con Desktop
        </button>
      </div>
    </div>`;

  cronRenderCal(curPat);
}

function cronSelectPat(idx) {
  _cronPatIdx = parseInt(idx);
  const pats  = _cronSyncData.pacientes || [];
  cronRenderCal(pats[_cronPatIdx]);
}

function cronNavMes(dir) {
  _cronMonth += dir;
  if (_cronMonth > 11) { _cronMonth = 0; _cronYear++; }
  if (_cronMonth <  0) { _cronMonth = 11; _cronYear--; }
  const pats = _cronSyncData.pacientes || [];
  const pat  = pats[_cronPatIdx];
  // Actualizar título
  const title = document.querySelector('#cron-content .cron-month-title');
  document.querySelectorAll('[data-cron-month-title]').forEach(el => {
    el.textContent = MESES_MC[_cronMonth] + ' ' + _cronYear;
  });
  // Re-render solo el header del mes
  cronRenderScreen();
}

// ── Renderizar calendario del mes ─────────────────────────────────
function cronRenderCal(pat) {
  const body = document.getElementById('cron-cal-body');
  if (!body || !pat) return;

  const key    = pat.id + '_' + _cronYear + '_' + _cronMonth;
  const cronDb = (_cronSyncData.cronograma || {})[key] || {};
  const dias   = pat.diasCron || [0,1,2,3,4,5]; // días activos
  const nCols  = dias.length;

  // Días del mes
  const daysInMonth = new Date(_cronYear, _cronMonth + 1, 0).getDate();
  const firstDayJS  = new Date(_cronYear, _cronMonth, 1).getDay(); // 0=Dom
  const jsToCol     = [6,0,1,2,3,4,5]; // Dom→6, Lun→0...
  const firstActive = jsToCol[firstDayJS];
  const emptyCount  = dias.filter(d => d < firstActive).length;

  // Headers
  const dayNames = ['L','M','X','J','V','S','D'];
  let html = `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);
    background:var(--surface2);border-bottom:1px solid var(--border);">`;
  dias.forEach(d => {
    html += `<div style="text-align:center;padding:6px 2px;font-size:.65rem;
      color:var(--muted);font-weight:600;letter-spacing:.08em;">${dayNames[d]}</div>`;
  });
  html += '</div>';

  // Celdas
  html += `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:1px;
    background:var(--border);padding:1px;">`;

  // Vacías al inicio
  for (let i = 0; i < emptyCount; i++) {
    html += `<div style="background:var(--bg);min-height:60px;"></div>`;
  }

  // Días del mes
  let col = emptyCount;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr  = _cronYear + '-' + String(_cronMonth+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    const sessions = cronDb[dateStr] || [];
    const isToday  = dateStr === new Date().toISOString().slice(0,10);

    html += `<div onclick="cronOpenDay('${dateStr}','${pat.id}')"
      style="background:var(--surface);min-height:60px;padding:4px;cursor:pointer;
             ${isToday ? 'background:rgba(200,169,110,.08);' : ''}
             position:relative;">
      <div style="font-size:.7rem;font-weight:600;color:${isToday ? 'var(--accent)' : 'var(--dim)'};
                  margin-bottom:3px;">${d}</div>`;

    sessions.slice(0,2).forEach(s => {
      html += `<div style="background:${s.color||'var(--surface2)'};border-radius:3px;
        padding:2px 4px;font-size:.58rem;color:#fff;margin-bottom:2px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        text-shadow:0 1px 2px rgba(0,0,0,.5);">${s.nombre||'Sesión'}</div>`;
    });
    if (sessions.length > 2) {
      html += `<div style="font-size:.55rem;color:var(--muted);">+${sessions.length-2} más</div>`;
    }

    html += `</div>`;
    col++;
    // Completar fila si llegamos al fin del mes
    if (d === daysInMonth) {
      const rem = (col % nCols);
      if (rem > 0) {
        for (let r = rem; r < nCols; r++) {
          html += `<div style="background:var(--bg);min-height:60px;"></div>`;
        }
      }
    }
  }

  html += '</div>';
  body.innerHTML = html;
}

// ── Abrir día para agregar/editar sesión ──────────────────────────
function cronOpenDay(dateStr, patId) {
  const pat     = (_cronSyncData.pacientes || []).find(p => p.id === patId);
  if (!pat) return;
  const key     = patId + '_' + _cronYear + '_' + _cronMonth;
  const cronDb  = _cronSyncData.cronograma || {};
  if (!cronDb[key]) cronDb[key] = {};
  const sessions = cronDb[key][dateStr] || [];

  const [y,m,d] = dateStr.split('-');
  const dateLabel = `${d}/${m}/${y}`;

  const prev = document.getElementById('cron-day-dlg');
  if (prev) prev.remove();

  const dlg = document.createElement('div');
  dlg.id = 'cron-day-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.6);'
    + 'display:flex;align-items:flex-end;justify-content:center;';

  const sessList = sessions.map((s, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 0;
                border-bottom:1px solid var(--border);">
      <div style="width:8px;height:8px;border-radius:50%;background:${s.color||'var(--muted)'};flex-shrink:0;"></div>
      <div style="flex:1;">
        <div style="font-size:.82rem;font-weight:500;">${s.nombre||'Sin nombre'}</div>
        ${s.objetivo ? `<div style="font-size:.7rem;color:var(--muted);">${s.objetivo}</div>` : ''}
      </div>
      <button onclick="cronEditSess('${dateStr}','${patId}',${i})"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px;">✏</button>
      <button onclick="cronDeleteSess('${dateStr}','${patId}',${i})"
        style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:.8rem;padding:4px;">🗑</button>
    </div>`).join('');

  dlg.innerHTML = `
    <div style="background:var(--surface);border-radius:16px 16px 0 0;width:100%;
                max-height:85vh;display:flex;flex-direction:column;overflow:hidden;
                border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 18px 12px;border-bottom:1px solid var(--border);">
        <div>
          <div style="font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.1em;">
            ${pat.nombre}
          </div>
          <div style="font-size:.95rem;font-weight:600;color:var(--accent);">${dateLabel}</div>
        </div>
        <button onclick="document.getElementById('cron-day-dlg').remove()"
          style="background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:0 18px;">
        ${sessList || '<div style="padding:16px 0;color:var(--muted);font-size:.82rem;text-align:center;">Sin sesiones este día</div>'}
      </div>
      <div style="padding:14px 18px;border-top:1px solid var(--border);">
        <button onclick="cronNewSess('${dateStr}','${patId}')" class="btn-accent" style="width:100%;">
          + Nueva sesión
        </button>
      </div>
    </div>`;

  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.remove(); });
  document.body.appendChild(dlg);
}

// ── Formulario nueva/editar sesión ────────────────────────────────
function cronNewSess(dateStr, patId) {
  cronSessForm(dateStr, patId, null, null);
}

function cronEditSess(dateStr, patId, idx) {
  const key  = patId + '_' + _cronYear + '_' + _cronMonth;
  const sess = ((_cronSyncData.cronograma||{})[key]||{})[dateStr]?.[idx];
  cronSessForm(dateStr, patId, idx, sess);
}

function cronSessForm(dateStr, patId, idx, sess) {
  const prev = document.getElementById('cron-form-dlg');
  if (prev) prev.remove();
  document.getElementById('cron-day-dlg')?.remove();

  const dlg = document.createElement('div');
  dlg.id = 'cron-form-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,.6);'
    + 'display:flex;align-items:flex-end;';

  const [y,m,d] = dateStr.split('-');
  dlg.innerHTML = `
    <div style="background:var(--surface);border-radius:16px 16px 0 0;width:100%;
                max-height:90vh;overflow-y:auto;border-top:1px solid var(--border);">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:16px 18px 12px;border-bottom:1px solid var(--border);position:sticky;top:0;
                  background:var(--surface);">
        <div style="font-size:.92rem;font-weight:600;color:var(--accent);">
          ${idx !== null ? 'Editar' : 'Nueva'} sesión — ${d}/${m}/${y}
        </div>
        <button onclick="document.getElementById('cron-form-dlg').remove()"
          style="background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;">✕</button>
      </div>
      <div style="padding:16px 18px;display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:.65rem;color:var(--muted);text-transform:uppercase;
                        letter-spacing:.1em;display:block;margin-bottom:6px;">Actividad</label>
          <input id="csf-nombre" type="text" spellcheck="false"
            value="${sess?.nombre||''}" placeholder="Nombre de la actividad..."
            style="width:100%;background:var(--surface2);border:1px solid var(--border);
                   color:var(--text);border-radius:8px;padding:10px 12px;font-size:.88rem;outline:none;">
        </div>
        <div>
          <label style="font-size:.65rem;color:var(--muted);text-transform:uppercase;
                        letter-spacing:.1em;display:block;margin-bottom:6px;">Objetivo</label>
          <input id="csf-objetivo" type="text" spellcheck="false"
            value="${sess?.objetivo||''}" placeholder="Objetivo de la sesión..."
            style="width:100%;background:var(--surface2);border:1px solid var(--border);
                   color:var(--text);border-radius:8px;padding:10px 12px;font-size:.88rem;outline:none;">
        </div>
        <div>
          <label style="font-size:.65rem;color:var(--muted);text-transform:uppercase;
                        letter-spacing:.1em;display:block;margin-bottom:6px;">Observaciones</label>
          <textarea id="csf-obs" spellcheck="false" rows="3"
            placeholder="Notas de la sesión..."
            style="width:100%;background:var(--surface2);border:1px solid var(--border);
                   color:var(--text);border-radius:8px;padding:10px 12px;font-size:.88rem;
                   outline:none;resize:none;">${sess?.obs||''}</textarea>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <label style="font-size:.65rem;color:var(--muted);text-transform:uppercase;
                        letter-spacing:.1em;">Color</label>
          <input type="color" id="csf-color" value="${sess?.color||'#c8a96e'}"
            style="width:36px;height:36px;border:1px solid var(--border);
                   border-radius:8px;cursor:pointer;padding:2px;">
        </div>
        <div style="display:flex;gap:8px;padding-bottom:8px;">
          <button onclick="cronSaveSess('${dateStr}','${patId}',${idx})"
            class="btn-accent" style="flex:1;">
            💾 Guardar
          </button>
          <button onclick="document.getElementById('cron-form-dlg').remove()"
            class="btn-outline" style="flex:1;">
            Cancelar
          </button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(dlg);
}

async function cronSaveSess(dateStr, patId, idx) {
  const nombre   = document.getElementById('csf-nombre').value.trim();
  const objetivo = document.getElementById('csf-objetivo').value.trim();
  const obs      = document.getElementById('csf-obs').value.trim();
  const color    = document.getElementById('csf-color').value;

  const key = patId + '_' + _cronYear + '_' + _cronMonth;
  if (!_cronSyncData.cronograma)          _cronSyncData.cronograma = {};
  if (!_cronSyncData.cronograma[key])     _cronSyncData.cronograma[key] = {};
  if (!_cronSyncData.cronograma[key][dateStr]) _cronSyncData.cronograma[key][dateStr] = [];

  const sess = { nombre, objetivo, obs, color, estado: 'realizada' };
  if (idx !== null && idx !== undefined && idx !== 'null') {
    _cronSyncData.cronograma[key][dateStr][parseInt(idx)] = sess;
  } else {
    _cronSyncData.cronograma[key][dateStr].push(sess);
  }

  document.getElementById('cron-form-dlg')?.remove();
  toast('Guardando...', '');

  try {
    await cronUploadSync();
    toast('✓ Sesión guardada y sincronizada', 'success');
  } catch(e) {
    toast('Guardado local (sin sync: ' + e.message + ')', '');
  }

  cronRenderCal((_cronSyncData.pacientes||[])[_cronPatIdx]);
}

async function cronDeleteSess(dateStr, patId, idx) {
  const key = patId + '_' + _cronYear + '_' + _cronMonth;
  if (_cronSyncData.cronograma?.[key]?.[dateStr]) {
    _cronSyncData.cronograma[key][dateStr].splice(idx, 1);
    if (!_cronSyncData.cronograma[key][dateStr].length) {
      delete _cronSyncData.cronograma[key][dateStr];
    }
  }
  document.getElementById('cron-day-dlg')?.remove();
  toast('Eliminando...', '');
  try { await cronUploadSync(); toast('✓ Eliminado', 'success'); } catch(e) {}
  cronRenderCal((_cronSyncData.pacientes||[])[_cronPatIdx]);
}

async function cronSyncNow() {
  toast('Sincronizando...', '');
  _cronSyncFileId = null;
  try {
    await cronDownloadSync();
    cronRenderScreen();
    toast('✓ Sincronizado', 'success');
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  }
}
