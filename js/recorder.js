// ═══════════════════════════════════════════════════
// recorder.js — Grabación de audio con MediaRecorder
// Compatible con Android Chrome (WebM/Opus o MP4/AAC)
// ═══════════════════════════════════════════════════

let _mediaRecorder = null;
let _audioChunks   = [];
let _stream        = null;
let _recStartTime  = 0;
let _recPauseMs    = 0;
let _pauseStart    = 0;
let _timerInterval = null;
let _isPaused      = false;
let _isRecording   = false;
let _analyser      = null;
let _animFrame     = null;
let _currentBlob   = null;

// ── Detectar mejor formato soportado ─────────────
function getBestMimeType() {
  const types = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/aac',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const t of types) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function getFileExtension(mimeType) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('aac')) return 'aac';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

// ── Iniciar/detener grabación ─────────────────────
async function toggleRecord() {
  if (_isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    _stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation:    true,
        noiseSuppression:    true,
        sampleRate:          44100,
        channelCount:        1,
      }
    });
  } catch(e) {
    toast('No se pudo acceder al micrófono: ' + e.message, 'error');
    return;
  }

  const quality  = parseInt(document.getElementById('quality-select').value) || 192000;
  const mimeType = getBestMimeType();
  _audioChunks   = [];
  _currentBlob   = null;

  const options = { audioBitsPerSecond: quality };
  if (mimeType) options.mimeType = mimeType;

  _mediaRecorder = new MediaRecorder(_stream, options);
  _mediaRecorder.ondataavailable = e => {
    if (e.data && e.data.size > 0) _audioChunks.push(e.data);
  };
  _mediaRecorder.onstop = () => {
    const mime = _mediaRecorder.mimeType || mimeType || 'audio/webm';
    _currentBlob = new Blob(_audioChunks, { type: mime });
    showPreview(_currentBlob);
  };

  _mediaRecorder.start(500); // chunk cada 500ms
  _isRecording   = true;
  _isPaused      = false;
  _recStartTime  = Date.now();
  _recPauseMs    = 0;

  // UI
  document.getElementById('btn-record').classList.add('recording');
  document.getElementById('btn-record').textContent = '⏺';
  document.getElementById('btn-pause').style.display  = 'flex';
  document.getElementById('btn-stop').style.display   = 'flex';
  document.getElementById('rec-preview').classList.remove('on');
  document.getElementById('rec-timer').classList.add('recording');
  document.getElementById('rec-status').textContent = '⏺ Grabando...';
  document.getElementById('rec-status').classList.add('active');

  startTimer();
  startWaveform();
}

async function togglePause() {
  if (!_isRecording || !_mediaRecorder) return;

  if (_isPaused) {
    // Reanudar
    _mediaRecorder.resume();
    _recPauseMs += Date.now() - _pauseStart;
    _isPaused   = false;
    document.getElementById('btn-pause').textContent = '⏸';
    document.getElementById('btn-pause').classList.remove('active');
    document.getElementById('rec-status').textContent = '⏺ Grabando...';
    document.getElementById('rec-timer').classList.add('recording');
    startWaveform();
  } else {
    // Pausar
    _mediaRecorder.pause();
    _pauseStart = Date.now();
    _isPaused   = true;
    document.getElementById('btn-pause').textContent = '▶';
    document.getElementById('btn-pause').classList.add('active');
    document.getElementById('rec-status').textContent = '⏸ En pausa';
    document.getElementById('rec-timer').classList.remove('recording');
    stopWaveform();
  }
}

function stopRecording() {
  if (!_mediaRecorder || !_isRecording) return;
  _mediaRecorder.stop();
  _stream.getTracks().forEach(t => t.stop());
  _isRecording = false;
  _isPaused    = false;

  stopTimer();
  stopWaveform();

  document.getElementById('btn-record').classList.remove('recording');
  document.getElementById('btn-record').textContent = '⏺';
  document.getElementById('btn-pause').style.display = 'none';
  document.getElementById('btn-stop').style.display  = 'none';
  document.getElementById('rec-timer').classList.remove('recording');
  document.getElementById('rec-status').textContent = 'Procesando...';
  document.getElementById('rec-status').classList.remove('active');
}

// ── Timer ─────────────────────────────────────────
function startTimer() {
  clearInterval(_timerInterval);
  _timerInterval = setInterval(updateTimer, 500);
}
function stopTimer() {
  clearInterval(_timerInterval);
}
function updateTimer() {
  if (_isPaused) return;
  const elapsed = Date.now() - _recStartTime - _recPauseMs;
  const secs    = Math.floor(elapsed / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  document.getElementById('rec-timer').textContent =
    String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

// ── Waveform visual ───────────────────────────────
function startWaveform() {
  if (!_stream) return;
  const ctx     = new (window.AudioContext || window.webkitAudioContext)();
  const source  = ctx.createMediaStreamSource(_stream);
  _analyser     = ctx.createAnalyser();
  _analyser.fftSize = 128;
  source.connect(_analyser);

  const canvas   = document.getElementById('rec-canvas');
  const canvasCtx = canvas.getContext('2d');
  const bufLen   = _analyser.frequencyBinCount;
  const dataArr  = new Uint8Array(bufLen);

  function draw() {
    _animFrame = requestAnimationFrame(draw);
    _analyser.getByteFrequencyData(dataArr);
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height;
    canvasCtx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface3');
    canvasCtx.fillRect(0, 0, W, H);

    const barW  = W / bufLen * 2;
    let   barX  = 0;
    for (let i = 0; i < bufLen; i++) {
      const barH = (dataArr[i] / 255) * H * .85;
      const alpha = 0.5 + (dataArr[i] / 255) * 0.5;
      canvasCtx.fillStyle = `rgba(200,169,110,${alpha})`;
      canvasCtx.beginPath();
      canvasCtx.roundRect(barX, H - barH, Math.max(1, barW - 1), barH, 2);
      canvasCtx.fill();
      barX += barW + 1;
    }
  }
  draw();
}

function stopWaveform() {
  if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
  const canvas = document.getElementById('rec-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// ── Preview post-grabación ────────────────────────
function showPreview(blob) {
  const url  = URL.createObjectURL(blob);
  const audio = document.getElementById('preview-audio');
  audio.src  = url;

  document.getElementById('rec-preview').classList.add('on');
  document.getElementById('rec-status').textContent = 'Revisá la grabación antes de guardar';

  // Waveform estático del blob
  const canvas = document.getElementById('rec-canvas');
  const ctx    = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(200,169,110,.15)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function discardRecording() {
  _currentBlob = null;
  document.getElementById('preview-audio').src = '';
  document.getElementById('rec-preview').classList.remove('on');
  document.getElementById('rec-timer').textContent = '00:00';
  document.getElementById('rec-status').textContent = 'Listo para grabar';
  const canvas = document.getElementById('rec-canvas');
  canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  toast('Grabación descartada');
}
