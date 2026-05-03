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
    // Mostrar diagnóstico detallado para ayudar a resolver el problema
    const fileInfo = _cronSyncFileId
      ? 'Archivo encontrado (ID: ' + _cronSyncFileId.substring(0,12) + '...)'
      : 'Archivo _musicare_sync.json NO encontrado en Drive';
    const dataKeys = _cronSyncData ? Object.keys(_cronSyncData).join(', ') : 'sin datos';
    cont.innerHTML = `<div style="padding:20px;font-size:.8rem;color:var(--muted);line-height:1.8;">
      <div style="font-size:1.5rem;text-align:center;margin-bottom:12px;">📅</div>
      <div style="text-align:center;margin-bottom:16px;">No hay pacientes sincronizados.</div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;
                  padding:12px;font-size:.72rem;margin-bottom:14px;">
        <div><b>Estado del archivo:</b> ${fileInfo}</div>
        <div><b>Campos recibidos:</b> ${dataKeys}</div>
        <div><b>Pacientes en JSON:</b> ${JSON.stringify(_cronSyncData?.pacientes?.length ?? 'ninguno')}</div>
        <div><b>Cronograma keys:</b> ${Object.keys(_cronSyncData?.cronograma || {}).length}</div>
      </div>
      <div style="font-size:.75rem;color:var(--dim);margin-bottom:14px;">
        1. Abrí MusiCare Desktop<br>
        2. Andá al cronograma de cualquier paciente<br>
        3. Presioná el botón ☁ que aparece en el header del mes<br>
        4. Volvé acá y presioná Sincronizar
      </div>
      <button onclick="cronSyncNow()" class="btn-accent" style="width:100%;margin-bottom:8px;">
        ↻ Sincronizar ahora
      </button>
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

  // dias: array de índices 0=Lun..6=Dom que están activos para este paciente
  const dias  = (pat.diasCron && pat.diasCron.length) ? pat.diasCron : [0,1,2,3,4,5];
  const nCols = dias.length;

  // Convertir JS getDay() (0=Dom..6=Sab) al índice interno (0=Lun..6=Dom)
  // JS:  Dom=0, Lun=1, Mar=2, Mié=3, Jue=4, Vie=5, Sáb=6
  // idx: Lun=0, Mar=1, Mié=2, Jue=3, Vie=4, Sáb=5, Dom=6
  function jsToIdx(jsDay) {
    return jsDay === 0 ? 6 : jsDay - 1;
  }

  const daysInMonth = new Date(_cronYear, _cronMonth + 1, 0).getDate();
  const dayNames    = ['LUN','MAR','MIÉ','JUE','VIE','SÁB','DOM'];
  const today       = new Date().toISOString().slice(0, 10);

  // ── Construir lista ordenada de celdas del calendario ────────────
  // Una celda por cada día del mes que cae en un día activo,
  // con celdas vacías al inicio de la primera semana si corresponde.

  // Encontrar el primer día del mes que sea activo
  let firstActiveDay = -1;
  for (let d = 1; d <= daysInMonth; d++) {
    const idx = jsToIdx(new Date(_cronYear, _cronMonth, d).getDay());
    if (dias.includes(idx)) { firstActiveDay = d; break; }
  }
  if (firstActiveDay === -1) {
    body.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center;">Sin días activos este mes</div>';
    return;
  }

  // Calcular cuántas celdas vacías van antes del primer día activo
  const firstActiveIdx   = jsToIdx(new Date(_cronYear, _cronMonth, firstActiveDay).getDay());
  const posInDias        = dias.indexOf(firstActiveIdx); // posición dentro del array dias
  const leadingEmpties   = posInDias; // celdas vacías al inicio

  // Headers
  let html = `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);
    background:var(--surface2);border-bottom:1px solid var(--border);">`;
  dias.forEach(d => {
    html += `<div style="text-align:center;padding:8px 2px;font-size:.65rem;
      color:var(--muted);font-weight:700;letter-spacing:.06em;">${dayNames[d]}</div>`;
  });
  html += '</div>';

  // Grid
  html += `<div style="display:grid;grid-template-columns:repeat(${nCols},1fr);gap:1px;
    background:var(--border);padding:1px;">`;

  // Celdas vacías iniciales
  for (let i = 0; i < leadingEmpties; i++) {
    html += `<div style="background:var(--bg);min-height:64px;"></div>`;
  }

  // Solo días del mes que caen en un día activo
  let cellCount = leadingEmpties;
  for (let d = 1; d <= daysInMonth; d++) {
    const jsDay = new Date(_cronYear, _cronMonth, d).getDay();
    const idx   = jsToIdx(jsDay);
    if (!dias.includes(idx)) continue; // saltar días no activos

    const dateStr  = _cronYear + '-'
                   + String(_cronMonth + 1).padStart(2, '0') + '-'
                   + String(d).padStart(2, '0');
    const sessions = cronDb[dateStr] || [];
    const isToday  = dateStr === today;

    html += `<div onclick="cronOpenDay('${dateStr}','${pat.id}')"
      style="background:var(--surface);min-height:64px;padding:5px 4px;cursor:pointer;
             ${isToday ? 'outline:2px solid var(--accent);outline-offset:-2px;' : ''}">
      <div style="font-size:.75rem;font-weight:700;
                  color:${isToday ? 'var(--accent)' : 'var(--dim)'};
                  margin-bottom:4px;">${d}</div>`;

    sessions.slice(0, 2).forEach(s => {
      const label = s.nombre || s.tipo || 'Sesión';
      const color = s.color  || 'var(--accent)';
      html += `<div style="background:${color};border-radius:3px;
        padding:2px 5px;font-size:.58rem;color:#fff;margin-bottom:2px;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
        text-shadow:0 1px 2px rgba(0,0,0,.5);">${label}</div>`;
    });
    if (sessions.length > 2) {
      html += `<div style="font-size:.55rem;color:var(--muted);">+${sessions.length - 2} más</div>`;
    }

    html += `</div>`;
    cellCount++;
  }

  // Celdas vacías al final para completar la última fila
  const rem = cellCount % nCols;
  if (rem > 0) {
    for (let i = rem; i < nCols; i++) {
      html += `<div style="background:var(--bg);min-height:64px;"></div>`;
    }
  }

  html += '</div>';
  body.innerHTML = html;
}

// ── Abrir día para agregar/editar sesión ──────────────────────────
function cronOpenDay(dateStr, patId) {
  const pat = (_cronSyncData.pacientes || []).find(p => p.id === patId);
  if (!pat) return;
  const key      = patId + '_' + _cronYear + '_' + _cronMonth;
  const cronDb   = _cronSyncData.cronograma || {};
  if (!cronDb[key]) cronDb[key] = {};
  const sessions = cronDb[key][dateStr] || [];

  const [y, m, d] = dateStr.split('-');
  const dateLabel  = `${d}/${m}/${y}`;

  const prev = document.getElementById('cron-day-dlg');
  if (prev) prev.remove();

  const dlg = document.createElement('div');
  dlg.id = 'cron-day-dlg';
  dlg.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.55);'
    + 'display:flex;align-items:flex-end;justify-content:center;';

  const sessList = sessions.map((s, i) => `
    <div style="display:flex;align-items:flex-start;gap:14px;padding:16px 0;
                border-bottom:1px solid var(--border);">
      <div style="width:16px;height:16px;border-radius:50%;margin-top:4px;flex-shrink:0;
                  background:${s.color || 'var(--accent)'};"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:1.05rem;font-weight:600;line-height:1.4;margin-bottom:5px;">
          ${s.nombre || s.tipo || 'Sesión'}
        </div>
        ${s.objetivo ? `<div style="font-size:.88rem;color:var(--muted);margin-bottom:4px;">${s.objetivo}</div>` : ''}
        ${s.obs      ? `<div style="font-size:.88rem;color:var(--text);opacity:.85;margin-bottom:4px;">${s.obs}</div>` : ''}
        ${s.estado   ? `<span style="font-size:.75rem;padding:3px 10px;border-radius:12px;
                          background:var(--surface2);color:var(--muted);">${s.estado}</span>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;padding-top:2px;">
        <button onclick="cronEditSess('${dateStr}','${patId}',${i})"
          style="background:var(--surface2);border:1px solid var(--border);color:var(--text);
                 padding:10px 14px;border-radius:10px;cursor:pointer;font-size:1rem;">✏️</button>
        <button onclick="cronDeleteSess('${dateStr}','${patId}',${i})"
          style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);
                 padding:10px 14px;border-radius:10px;cursor:pointer;font-size:1rem;">🗑️</button>
      </div>
    </div>`).join('');

  dlg.innerHTML = `
    <div style="background:var(--surface);border-radius:20px 20px 0 0;width:100%;
                height:92vh;display:flex;flex-direction:column;overflow:hidden;
                border-top:2px solid var(--accent);">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:20px 22px 16px;border-bottom:1px solid var(--border);flex-shrink:0;">
        <div>
          <div style="font-size:.78rem;color:var(--muted);text-transform:uppercase;
                      letter-spacing:.1em;margin-bottom:5px;">${pat.nombre}</div>
          <div style="font-size:1.3rem;font-weight:700;color:var(--accent);">${dateLabel}</div>
        </div>
        <button onclick="document.getElementById('cron-day-dlg').remove()"
          style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);
                 font-size:1.2rem;cursor:pointer;border-radius:50%;width:44px;height:44px;
                 display:flex;align-items:center;justify-content:center;">✕</button>
      </div>
      <div style="overflow-y:auto;flex:1;padding:0 22px;">
        ${sessList || '<div style="padding:40px 0;color:var(--muted);font-size:1rem;text-align:center;">Sin sesiones este día</div>'}
      </div>
      <div style="padding:16px 22px 28px;border-top:1px solid var(--border);flex-shrink:0;">
        <button onclick="cronNewSess('${dateStr}','${patId}')" class="btn-accent"
          style="width:100%;font-size:1.05rem;padding:16px;">
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
