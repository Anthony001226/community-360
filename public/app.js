const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const nf = new Intl.NumberFormat('es-MX');
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const ESTATUS_COLOR = { activo: '--emerald', en_riesgo: '--amber', inactivo: '--slate' };
const ESTATUS_LABEL = { activo: 'Activos', en_riesgo: 'En riesgo', inactivo: 'Inactivos' };
const TEMA_LABEL = {
  reglas_moderacion: 'Reglas y moderación',
  memes_humor: 'Memes y humor',
  videojuegos: 'Videojuegos',
  arte_comisiones: 'Arte y comisiones',
  eventos_convenciones: 'Eventos',
  musica: 'Música',
  fursuits: 'Fursuits',
  seguridad_privacidad: 'Privacidad',
  general: 'General',
};
const TIPO_LABEL = {
  comentario: 'Comentarios',
  mensaje: 'Mensajes',
  reaccion: 'Reacciones',
  respuesta_encuesta: 'Encuestas',
};

let state = null;
let charts = {};
let socket = null;
let currentView = 'vista-vivo';
let currentDirTab = 'miembros';

// =========================================================
// TEMA CLARO / OSCURO
// =========================================================
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('c360_theme', theme);
  const label = document.getElementById('themeLabel');
  if (label) label.textContent = theme === 'light' ? 'Oscuro' : 'Claro';
  if (state) {
    Chart.defaults.color = css('--muted');
    renderActiveCharts();
  }
}

document.getElementById('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
});

// =========================================================
// AUTENTICACIÓN
// =========================================================
async function checkSession() {
  const savedTheme = localStorage.getItem('c360_theme') || 'dark';
  applyTheme(savedTheme);

  const token = localStorage.getItem('c360_token');
  if (!token) return;
  try {
    const r = await fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('expired');
    const data = await r.json();
    enterApp(data.user);
  } catch {
    localStorage.removeItem('c360_token');
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const identifier = document.getElementById('identifier').value.trim();
  const password = document.getElementById('password').value;

  try {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      errEl.textContent = data.error || 'Credenciales incorrectas.';
      return;
    }
    localStorage.setItem('c360_token', data.token);
    enterApp(data.user);
  } catch {
    errEl.textContent = 'No se pudo conectar con el servidor.';
  }
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('c360_token');
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  document.getElementById('appShell').hidden = true;
  document.getElementById('loginView').hidden = false;
});

function enterApp(user) {
  document.getElementById('loginView').hidden = true;
  document.getElementById('appShell').hidden = false;
  document.getElementById('userLabel').textContent = user.username;
  loadDashboard();
}

// =========================================================
// NAVEGACIÓN ENTRE PANTALLAS
// =========================================================
document.querySelectorAll('.nav-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.getAttribute('data-view');
    currentView = target;
    document.querySelectorAll('.nav-pill').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view-section').forEach((sec) => {
      sec.classList.toggle('active', sec.id === target);
    });
    if (state) renderActiveCharts();
    if (target === 'vista-directorio') loadDirectory();
  });
});

document.querySelectorAll('.subtab').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentDirTab = btn.getAttribute('data-dir');
    document.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b === btn));
    document.getElementById('panelDirMiembros').hidden = currentDirTab !== 'miembros';
    document.getElementById('panelDirInteracciones').hidden = currentDirTab !== 'interacciones';
  });
});

// =========================================================
// CARGA DE DATOS Y SOCKET.IO
// =========================================================
async function loadDashboard() {
  try {
    const r = await fetch('/api/dashboard');
    if (!r.ok) throw new Error('dashboard error');
    state = await r.json();
    renderAllViews();
    renderInitialFeed(state.recientes || []);
    setLiveStatus(false, 'Conectando...');
    connectSocket();
    loadDirectory();
  } catch {
    setLiveStatus(false, 'Sin conexión');
  }
}

function setLiveStatus(online, text) {
  const badge = document.getElementById('liveBadge');
  badge.classList.toggle('online', online);
  document.getElementById('liveText').textContent = text;
}

function connectSocket() {
  if (typeof io === 'undefined' || socket) return;
  socket = io();
  socket.on('connect', () => setLiveStatus(true, 'En vivo'));
  socket.on('disconnect', () => setLiveStatus(false, 'Reconectando...'));
  socket.on('dashboard_actualizado', (payload) => {
    state = {
      kpis: payload.kpis,
      canales: payload.canales,
      temas: payload.temas,
      tipos: payload.tipos,
      polaridad: payload.polaridad,
      estatus: payload.estatus,
      intereses: payload.intereses,
      edades: payload.edades,
      especies: payload.especies,
      paises: payload.paises,
      ciudades: payload.ciudades,
      heat: payload.heat,
      recientes: payload.recientes,
    };
    renderAllViews(true);
    if (payload.detail) {
      pushFeed(payload.detail, payload.eventType || 'actualizada', true);
      updateTicker(payload.eventType, payload.detail);
    }
  });
}

function updateTicker(eventType, item) {
  const ticker = document.getElementById('liveTicker');
  const txt = document.getElementById('tickerText');
  const tm = document.getElementById('tickerTime');
  const verb =
    eventType === 'creada'
      ? 'Nueva publicación registrada'
      : eventType === 'actualizada'
      ? 'Publicación modificada'
      : 'Publicación eliminada';
  txt.textContent = `${verb}: ${item.id_interaccion} (${item.canal} · sentimiento ${item.sentimiento})`;
  tm.textContent = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ticker.classList.remove('flash');
  void ticker.offsetWidth;
  ticker.classList.add('flash');
}

// =========================================================
// RENDERIZADO DE TODAS LAS VISTAS
// =========================================================
function renderAllViews(pulseLive = false) {
  renderLiveKpis(pulseLive);
  renderComunidadKpis();
  renderTerritorioKpis();
  renderHeat();
  renderRegionalGrid();
  renderInteractionsTable();
  renderActiveCharts();
}

function renderActiveCharts() {
  if (!state) return;
  if (currentView === 'vista-vivo') {
    renderCanalesChart();
    renderTemasChart();
    renderPolaridadDonut();
    renderTiposChart();
  } else if (currentView === 'vista-comunidad') {
    renderEstatusDonut();
    renderInteresesChart();
    renderEdadesChart();
    renderEspeciesChart();
  } else if (currentView === 'vista-territorio') {
    renderCiudadesChart();
    renderPaisesDonut();
  }
}

const valueLabelsPlugin = {
  id: 'valueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const isHorizontal = chart.options.indexAxis === 'y';
    ctx.save();
    ctx.fillStyle = css('--ink');
    ctx.font = `600 12px ${css('--mono')}`;
    chart.getDatasetMeta(0).data.forEach((bar, i) => {
      const val = chart.data.datasets[0].data[i];
      if (isHorizontal) {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(nf.format(val), bar.x + 8, bar.y);
      } else {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(nf.format(val), bar.x, bar.y - 5);
      }
    });
    ctx.restore();
  },
};

function destroyChart(key) {
  if (charts[key]) {
    charts[key].destroy();
    charts[key] = null;
  }
}

// ---------- VISTA 1: EN VIVO ----------
function renderLiveKpis(pulse) {
  const k = state.kpis;
  const sent = Number(k.sentimiento_prom || 0);
  const items = [
    {
      label: 'Publicaciones activas',
      val: nf.format(k.total_interacciones),
      sub: `${nf.format(k.cuarentena_total)} aisladas en revisión`,
      cls: '',
      icon: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    },
    {
      label: 'Sentimiento promedio',
      val: (sent > 0 ? '+' : '') + sent.toFixed(3),
      sub: 'Escala de -1.0 a +1.0',
      cls: 'indigo',
      icon: '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>',
    },
    {
      label: 'Ambiente favorable',
      val: `${k.tasa_positiva_pct.toFixed(1)} %`,
      sub: 'Mensajes con tono positivo',
      cls: 'emerald',
      icon: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    },
    {
      label: 'Alertas de moderación',
      val: `${k.tasa_alerta_pct.toFixed(1)} %`,
      sub: 'Mensajes con tono crítico',
      cls: 'rose',
      icon: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    },
    {
      label: 'Reacciones recibidas',
      val: nf.format(k.reacciones_totales),
      sub: `Promedio ${k.reacciones_prom} por publicación`,
      cls: 'amber',
      icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    },
  ];

  const container = document.getElementById('liveKpis');
  container.innerHTML = items
    .map(
      (x) => `
    <article class="kpi-card ${pulse ? 'pulse-update' : ''}">
      <div class="kpi-top">
        <span class="kpi-label">${x.label}</span>
        <span class="kpi-icon ${x.cls}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${x.icon}</svg>
        </span>
      </div>
      <div class="kpi-val">${x.val}</div>
      <div class="kpi-sub">${x.sub}</div>
    </article>`
    )
    .join('');
}

function renderCanalesChart() {
  const d = [...(state.canales || [])].sort((a, b) => b.total - a.total);
  destroyChart('canales');
  charts.canales = new Chart(document.getElementById('chartCanales'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => x.canal),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--accent'), borderRadius: 6, barThickness: 22 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 38 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 13, weight: 600 } } },
      },
    },
  });
}

function renderTemasChart() {
  const d = (state.temas || []).slice(0, 8);
  destroyChart('temas');
  charts.temas = new Chart(document.getElementById('chartTemas'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => TEMA_LABEL[x.tema] || x.tema),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--indigo'), borderRadius: 6, maxBarThickness: 34 }],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--muted'), font: { size: 11 } } },
        y: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
      },
    },
  });
}

function renderPolaridadDonut() {
  const d = state.polaridad || [];
  const total = d.reduce((a, x) => a + x.total, 0);
  const colors = [css('--emerald'), css('--slate'), css('--rose')];
  document.getElementById('polaridadTotal').textContent = nf.format(total);
  document.getElementById('polaridadLegend').innerHTML = d
    .map((x, i) => `<li><i style="background:${colors[i]}"></i><span>${x.label}</span><b>${nf.format(x.total)}</b></li>`)
    .join('');

  destroyChart('polaridad');
  charts.polaridad = new Chart(document.getElementById('chartPolaridad'), {
    type: 'doughnut',
    data: {
      labels: d.map((x) => x.label),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: colors, borderColor: css('--surface'), borderWidth: 3 }],
    },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } },
  });
}

function renderTiposChart() {
  const d = state.tipos || [];
  destroyChart('tipos');
  charts.tipos = new Chart(document.getElementById('chartTipos'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => TIPO_LABEL[x.tipo] || x.tipo),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--amber'), borderRadius: 6, barThickness: 24 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 38 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 13, weight: 600 } } },
      },
    },
  });
}

function renderHeat() {
  const heat = state.heat || [];
  const max = Math.max(...heat.flat(), 1);
  document.getElementById('heatDays').innerHTML = DIAS.map((d) => `<span>${d}</span>`).join('');
  document.getElementById('heatHours').innerHTML = Array.from({ length: 24 }, (_, h) => `<span>${h % 3 === 0 ? h : ''}</span>`).join('');
  document.getElementById('heatGrid').innerHTML = heat
    .map((row, d) =>
      row
        .map(
          (v, h) =>
            `<div class="heat-cell" style="opacity:${(0.08 + (0.92 * v) / max).toFixed(2)}" title="${DIAS[d]} ${String(h).padStart(2, '0')}:00 UTC — ${v} publicaciones"></div>`
        )
        .join('')
    )
    .join('');
}

const feedEl = document.getElementById('feedList');
function renderInitialFeed(items) {
  feedEl.innerHTML = '';
  // Invertimos para que al usar prepend() quede la más reciente arriba
  [...items.slice(0, 6)].reverse().forEach((ev) => pushFeed(ev, 'histórica', false));
}

function pushFeed(ev, accion, highlight) {
  const li = document.createElement('li');
  li.className = 'feed-item' + (highlight ? ' new' : '');
  const hora = new Date(ev.timestamp || Date.now()).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
  const badgeCls =
    accion === 'creada' ? 'ok' : accion === 'actualizada' ? 'info' : accion === 'eliminada' ? 'danger' : 'muted';
  const accionTxt =
    accion === 'creada' ? 'Nueva' : accion === 'actualizada' ? 'Editada' : accion === 'eliminada' ? 'Eliminada' : 'Reciente';
  li.innerHTML = `
    <div class="feed-top">
      <span class="feed-id">${ev.id_interaccion} · ${ev.id_usuario}</span>
      <span class="badge ${badgeCls}">${accionTxt}</span>
    </div>
    <div>${TIPO_LABEL[ev.tipo] || ev.tipo} en <strong>${ev.canal}</strong> · Ánimo ${ev.sentimiento}</div>
    <div class="feed-meta">${TEMA_LABEL[ev.tema] || ev.tema || 'General'} · ${hora}</div>
  `;
  feedEl.prepend(li);
  while (feedEl.children.length > 6) feedEl.lastChild.remove();
}

// ---------- VISTA 2: COMUNIDAD ----------
function renderComunidadKpis() {
  const k = state.kpis;
  const items = [
    { label: 'Miembros en el padrón', val: nf.format(k.total_usuarios), sub: `${nf.format(k.total_artistas)} artistas registrados`, cls: '' },
    { label: 'Miembros activos', val: `${k.activos_pct.toFixed(1)} %`, sub: `${nf.format(k.activos)} con participación constante`, cls: 'emerald' },
    { label: 'En riesgo de abandono', val: `${k.riesgo_pct.toFixed(1)} %`, sub: `${nf.format(k.en_riesgo)} requieren seguimiento`, cls: 'amber' },
    { label: 'Actividad y comisiones', val: `${k.engagement.toFixed(1)}`, sub: `Mensajes/reac. 30d · ${k.comisiones_por_artista.toFixed(1)} com./artista`, cls: 'indigo' },
  ];
  document.getElementById('comunidadKpis').innerHTML = items
    .map(
      (x) => `
    <article class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">${x.label}</span><span class="kpi-icon ${x.cls}">●</span></div>
      <div class="kpi-val">${x.val}</div>
      <div class="kpi-sub">${x.sub}</div>
    </article>`
    )
    .join('');
}

function renderEstatusDonut() {
  const d = state.estatus || [];
  const total = d.reduce((a, x) => a + x.total, 0);
  document.getElementById('estatusTotal').textContent = nf.format(total);
  document.getElementById('estatusLegend').innerHTML = d
    .map((x) => `<li><i style="background:${css(ESTATUS_COLOR[x.estatus] || '--slate')}"></i><span>${ESTATUS_LABEL[x.estatus] || x.estatus}</span><b>${nf.format(x.total)}</b></li>`)
    .join('');

  destroyChart('estatus');
  charts.estatus = new Chart(document.getElementById('chartEstatus'), {
    type: 'doughnut',
    data: {
      labels: d.map((x) => ESTATUS_LABEL[x.estatus] || x.estatus),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: d.map((x) => css(ESTATUS_COLOR[x.estatus] || '--slate')), borderColor: css('--surface'), borderWidth: 3 }],
    },
    options: { maintainAspectRatio: false, cutout: '68%', plugins: { legend: { display: false } } },
  });
}

function renderInteresesChart() {
  const d = (state.intereses || []).slice(0, 8);
  destroyChart('intereses');
  charts.intereses = new Chart(document.getElementById('chartIntereses'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => x.interes),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--accent'), borderRadius: 6, barThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 38 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 12.5 } } },
      },
    },
  });
}

function renderEdadesChart() {
  const d = state.edades || [];
  destroyChart('edades');
  charts.edades = new Chart(document.getElementById('chartEdades'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => x.rango_edad),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--indigo'), borderRadius: 8, maxBarThickness: 48 }],
    },
    options: {
      maintainAspectRatio: false,
      layout: { padding: { top: 20 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 13, weight: 600 } } },
        y: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
      },
    },
  });
}

function renderEspeciesChart() {
  const d = state.especies || [];
  destroyChart('especies');
  charts.especies = new Chart(document.getElementById('chartEspecies'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => x.especie),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: css('--amber'), borderRadius: 6, barThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 38 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 12.5 } } },
      },
    },
  });
}

// ---------- VISTA 3: TERRITORIO ----------
function renderTerritorioKpis() {
  const k = state.kpis;
  const items = [
    { label: 'Ubicación autorizada', val: nf.format(k.con_consentimiento), sub: `${k.consentimiento_pct.toFixed(1)} % del padrón`, cls: 'emerald' },
    { label: 'Ubicación privada', val: nf.format(k.sin_consentimiento), sub: `${k.violaciones_privacidad} registros expuestos`, cls: '' },
    { label: 'Países representados', val: nf.format(k.total_paises), sub: 'Presencia internacional', cls: 'indigo' },
    { label: 'Ciudades principales', val: nf.format(k.total_ciudades), sub: 'Sedes potenciales para eventos', cls: 'amber' },
  ];
  document.getElementById('territorioKpis').innerHTML = items
    .map(
      (x) => `
    <article class="kpi-card">
      <div class="kpi-top"><span class="kpi-label">${x.label}</span><span class="kpi-icon ${x.cls}">●</span></div>
      <div class="kpi-val">${x.val}</div>
      <div class="kpi-sub">${x.sub}</div>
    </article>`
    )
    .join('');
}

function renderCiudadesChart() {
  const d = (state.ciudades || []).slice(0, 10);
  destroyChart('ciudades');
  charts.ciudades = new Chart(document.getElementById('chartCiudades'), {
    type: 'bar',
    plugins: [valueLabelsPlugin],
    data: {
      labels: d.map((x) => `${x.ciudad}, ${x.estado}`),
      datasets: [{ data: d.map((x) => x.total_miembros), backgroundColor: css('--accent'), borderRadius: 6, barThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      layout: { padding: { right: 38 } },
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: css('--line') }, border: { display: false }, ticks: { color: css('--muted') } },
        y: { grid: { display: false }, border: { display: false }, ticks: { color: css('--ink'), font: { size: 12 } } },
      },
    },
  });
}

function renderPaisesDonut() {
  const d = state.paises || [];
  const total = d.reduce((a, x) => a + x.total, 0);
  const palette = [css('--accent'), css('--indigo'), css('--amber'), css('--emerald'), css('--rose'), css('--slate')];
  document.getElementById('paisesTotal').textContent = nf.format(total);
  document.getElementById('paisesLegend').innerHTML = d
    .map((x, i) => `<li><i style="background:${palette[i % palette.length]}"></i><span>${x.pais}</span><b>${nf.format(x.total)}</b></li>`)
    .join('');

  destroyChart('paises');
  charts.paises = new Chart(document.getElementById('chartPaises'), {
    type: 'doughnut',
    data: {
      labels: d.map((x) => x.pais),
      datasets: [{ data: d.map((x) => x.total), backgroundColor: d.map((_, i) => palette[i % palette.length]), borderColor: css('--surface'), borderWidth: 3 }],
    },
    options: { maintainAspectRatio: false, cutout: '66%', plugins: { legend: { display: false } } },
  });
}

function renderRegionalGrid() {
  const list = state.ciudades || [];
  const max = Math.max(...list.map((c) => c.total_miembros), 1);
  document.getElementById('regionGrid').innerHTML = list
    .map((c) => {
      const ratio = c.total_miembros / max;
      const bgTint = `color-mix(in srgb, var(--accent) ${Math.round(5 + ratio * 16)}%, var(--surface))`;
      const s = Number(c.sentimiento_prom || 0);
      const moodCls = s > 0.15 ? 'ok' : s < -0.05 ? 'danger' : 'muted';
      return `
      <div class="region-tile" style="background:${bgTint}">
        <div class="region-city">${c.ciudad}</div>
        <div class="region-state">${c.estado} · ${c.pais}</div>
        <div class="region-bottom">
          <span class="region-count">${nf.format(c.total_miembros)} miembros</span>
          <span class="badge ${moodCls}">Ánimo ${s > 0 ? '+' : ''}${s.toFixed(2)}</span>
        </div>
      </div>`;
    })
    .join('');
}

// ---------- VISTA 4: DIRECTORIO Y PRIVACIDAD ----------
async function loadDirectory() {
  const estatus = document.getElementById('filterEstatus').value;
  const consentimiento = document.getElementById('filterConsent').value;
  const search = document.getElementById('filterSearch').value.trim();
  const limit = document.getElementById('filterLimit').value;

  const params = new URLSearchParams({ limit });
  if (estatus) params.set('estatus', estatus);
  if (consentimiento) params.set('consentimiento', consentimiento);
  if (search) params.set('search', search);

  try {
    const r = await fetch(`/api/usuarios?${params.toString()}`);
    if (!r.ok) throw new Error('err');
    const json = await r.json();
    document.getElementById('dirSummary').textContent = `Mostrando ${nf.format(json.total)} de ${nf.format(json.total_filtrado)} miembros coincidentes`;

    document.getElementById('tbodyUsuarios').innerHTML = json.data
      .map((u) => {
        const estCls = u.estatus === 'activo' ? 'ok' : u.estatus === 'en_riesgo' ? 'warn' : 'muted';
        const privBadge = u.consentimiento_datos
          ? '<span class="badge info">Autorizada</span>'
          : '<span class="badge ok">Privada · Protegida</span>';
        const locTxt = u.consentimiento_datos && u.ciudad ? `${u.ciudad}, ${u.pais}` : '—';
        const coordTxt =
          u.consentimiento_datos && u.latitud !== null && u.longitud !== null
            ? `${Number(u.latitud).toFixed(2)}, ${Number(u.longitud).toFixed(2)}`
            : '—';
        const s = Number(u.sentimiento_promedio || 0);
        return `
        <tr>
          <td class="mono">${u.id_usuario}</td>
          <td><strong>${u.alias}</strong></td>
          <td><span class="badge ${estCls}">${ESTATUS_LABEL[u.estatus] || u.estatus}</span></td>
          <td>${u.plataforma || '—'}</td>
          <td>${u.interes || '—'}</td>
          <td class="num">${nf.format(u.mensajes_30d || 0)}</td>
          <td class="num">${s > 0 ? '+' : ''}${s.toFixed(3)}</td>
          <td>${privBadge}</td>
          <td>${locTxt}</td>
          <td class="mono">${coordTxt}</td>
        </tr>`;
      })
      .join('');
  } catch {
    document.getElementById('dirSummary').textContent = 'No se pudo cargar el directorio.';
  }
}

function renderInteractionsTable() {
  const list = state.recientes || [];
  document.getElementById('tbodyInteracciones').innerHTML = list
    .map((it) => {
      const s = Number(it.sentimiento || 0);
      const sCls = s > 0.15 ? 'ok' : s < -0.15 ? 'danger' : 'muted';
      const tags = Array.isArray(it.etiquetas) && it.etiquetas.length ? it.etiquetas.join(', ') : '—';
      const fecha = it.timestamp ? new Date(it.timestamp).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      return `
      <tr>
        <td class="mono">${it.id_interaccion}</td>
        <td class="mono">${it.id_usuario}</td>
        <td><strong>${it.canal}</strong></td>
        <td>${TIPO_LABEL[it.tipo] || it.tipo}</td>
        <td>${TEMA_LABEL[it.tema] || it.tema || 'General'}</td>
        <td class="num"><span class="badge ${sCls}">${s > 0 ? '+' : ''}${s.toFixed(2)}</span></td>
        <td class="num">${nf.format(it.reacciones_recibidas || 0)}</td>
        <td>${tags}</td>
        <td class="mono">${fecha}</td>
      </tr>`;
    })
    .join('');
}

['filterEstatus', 'filterConsent', 'filterLimit'].forEach((id) => {
  document.getElementById(id).addEventListener('change', loadDirectory);
});
document.getElementById('btnFilter').addEventListener('click', loadDirectory);
document.getElementById('filterSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadDirectory();
});

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) Chart.defaults.animation = false;
Chart.defaults.font.family = css('--font');
checkSession();
