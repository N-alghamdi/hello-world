const SAMPLE_FILE = './Excel_Table_1_modified_similar_leaks_needed_web%20.csv';
const MODEL_FILE = './xgboost_leak_model.json';
const BALANCE_FILE = './balance_check%20(1).csv';
const MAKKAH_CENTER = [21.4225, 39.8262];
const FEATURE_ORDER = [
  'MATERIAL_1_DI', 'MATERIAL_1_HDPE', 'MATERIAL_1_STEEL', 'MATERIAL_1_UPVC',
  'MATERIAL_1_OTHER', 'Class_name_Roads', 'Class_name_Buildings', 'Class_name_Service',
  'Class_name_Other', 'Name_known_central', 'Name_known_east', 'Name_known_north',
  'Name_known_south', 'Name_known_west', 'Name_known_other', 'asset_active',
  'DIAMETER_1', 'pipe_age', 'NEW_REL_PR'
];

const state = {
  rows: [],
  model: null,
  predictions: [],
  neighbourhoods: new Map(),
  layers: new Map(),
  selectedName: null,
  balanceNames: new Set(),
};

const el = {
  datasetInput: document.querySelector('#datasetInput'),
  fileName: document.querySelector('#fileName'),
  loadSampleBtn: document.querySelector('#loadSampleBtn'),
  runModelBtn: document.querySelector('#runModelBtn'),
  hotelBtn: document.querySelector('#hotelBtn'),
  resetMapBtn: document.querySelector('#resetMapBtn'),
  downloadBtn: document.querySelector('#downloadBtn'),
  highCount: document.querySelector('#highCount'),
  mediumCount: document.querySelector('#mediumCount'),
  lowCount: document.querySelector('#lowCount'),
  rowCount: document.querySelector('#rowCount'),
  list: document.querySelector('#neighbourhoodList'),
  selectedStats: document.querySelector('#selectedStats'),
  insights: document.querySelector('#insights'),
};

const map = L.map('map', { zoomControl: true }).setView(MAKKAH_CENTER, 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const knownNeighbourhoods = {
  'حي الشرائع': [21.478, 39.955], 'الشرائع': [21.478, 39.955],
  'حي السلام': [21.408, 39.88], 'السلام': [21.408, 39.88],
  'حي التروية': [21.438, 39.885], 'التروية': [21.438, 39.885],
  'حي الكوثر': [21.463, 39.895], 'الكوثر': [21.463, 39.895],
  'حي أجياد': [21.414, 39.826], 'حي اجیاد': [21.414, 39.826],
  'حي العزيزية': [21.405, 39.879], 'حي العوالي': [21.381, 39.876],
  'حي النزهة': [21.447, 39.792], 'حي الزاهر': [21.441, 39.806],
  'حي الشوقية': [21.373, 39.787], 'حي بطحاء قريش': [21.366, 39.825],
  'حي الخالدية': [21.397, 39.843], 'حي المسفلة': [21.409, 39.811],
  'حي جرول': [21.428, 39.811], 'حي الحمراء': [21.435, 39.783],
  'حي البحيرات': [21.505, 39.75], 'حي ولي العهد': [21.33, 39.73],
};

const fallbackHotelCounts = {
  'حي أجياد': 160, 'حي اجیاد': 160, 'حي المسفلة': 105, 'حي العزيزية': 95,
  'حي جرول': 70, 'حي الشرائع': 18, 'حي السلام': 24, 'حي التروية': 14, 'حي الكوثر': 10,
};

bootstrap();

async function bootstrap() {
  try {
    const [modelResponse, balanceResponse] = await Promise.all([fetch(MODEL_FILE), fetch(BALANCE_FILE)]);
    state.model = await modelResponse.json();
    const balanceText = await balanceResponse.text();
    parseCsv(balanceText).forEach((row) => state.balanceNames.add(decodeMojibake(row.Name || '').trim()));
    renderInsights('Model and neighbourhood-name reference loaded. Upload a CSV or load the sample file.');
  } catch (error) {
    renderInsights(`Could not load model/reference files: ${error.message}`);
  }
}

el.datasetInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  el.fileName.textContent = file.name;
  await loadCsvText(await file.text());
});

el.loadSampleBtn.addEventListener('click', async () => {
  const response = await fetch(SAMPLE_FILE);
  await loadCsvText(await response.text());
  el.fileName.textContent = 'Sample CSV loaded';
});

el.runModelBtn.addEventListener('click', runPrediction);
el.hotelBtn.addEventListener('click', enrichHotelsFromOverpass);
el.resetMapBtn.addEventListener('click', () => map.setView(MAKKAH_CENTER, 12));
el.downloadBtn.addEventListener('click', downloadResults);

async function loadCsvText(text) {
  const rows = parseCsv(text).map(normalizeRow).filter((row) => Object.keys(row).length);
  state.rows = rows;
  state.predictions = [];
  state.neighbourhoods.clear();
  clearMap();
  el.rowCount.textContent = rows.length.toLocaleString();
  el.runModelBtn.disabled = !rows.length || !state.model;
  el.hotelBtn.disabled = true;
  el.downloadBtn.disabled = true;
  el.list.className = 'neighbourhood-list empty';
  el.list.textContent = rows.length ? `${rows.length.toLocaleString()} rows loaded. Press “Run prediction”.` : 'No rows found in the CSV.';
  renderInsights(rows.length ? describeColumns(rows) : 'No rows found.');
}

function normalizeRow(row) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => { normalized[key.trim()] = typeof value === 'string' ? value.trim() : value; });
  normalized.Name = decodeMojibake(normalized.Name || normalized['الحي_'] || normalized.NEIGHBORHOOD || 'Unknown').trim() || 'Unknown';
  normalized.pipe_age = calculatePipeAge(normalized.INSTALLDAT);
  normalized.DIAMETER_1 = toNumber(normalized.DIAMETER_1);
  normalized.NEW_REL_PR = toNumber(normalized.NEW_REL_PR);
  normalized.Y = toNumber(normalized.Y || normalized.latitude || normalized.Latitude);
  normalized.X = toNumber(normalized.X || normalized.longitude || normalized.Longitude);
  return normalized;
}

function runPrediction() {
  if (!state.rows.length || !state.model) return;
  state.predictions = state.rows.map((row) => {
    const probability = predictXgboost(row, state.model);
    return { ...row, leak_probability: probability, leak_prediction: probability >= 0.5 ? 1 : 0 };
  });
  buildNeighbourhoodStats();
  renderAll();
  el.hotelBtn.disabled = false;
  el.downloadBtn.disabled = false;
}

function buildNeighbourhoodStats() {
  state.neighbourhoods.clear();
  for (const row of state.predictions) {
    const name = row.Name || 'Unknown';
    if (!state.neighbourhoods.has(name)) {
      state.neighbourhoods.set(name, {
        name, rows: 0, predictedLeaks: 0, avgProbability: 0, avgDiameter: 0, maxDiameter: 0,
        hotelCount: getFallbackHotelCount(name), coords: resolveCoords(name, row), priorityScore: 0, priority: 'low', reasons: [],
      });
    }
    const stat = state.neighbourhoods.get(name);
    stat.rows += 1;
    stat.predictedLeaks += row.leak_prediction;
    stat.avgProbability += row.leak_probability;
    stat.avgDiameter += Number.isFinite(row.DIAMETER_1) ? row.DIAMETER_1 : 0;
    stat.maxDiameter = Math.max(stat.maxDiameter, Number.isFinite(row.DIAMETER_1) ? row.DIAMETER_1 : 0);
    if (Number.isFinite(row.Y) && Number.isFinite(row.X)) stat.coords = [row.Y, row.X];
  }
  [...state.neighbourhoods.values()].forEach(scoreNeighbourhood);
}

function scoreNeighbourhood(stat) {
  stat.avgProbability = stat.rows ? stat.avgProbability / stat.rows : 0;
  stat.avgDiameter = stat.rows ? stat.avgDiameter / stat.rows : 0;
  const leakRate = stat.rows ? stat.predictedLeaks / stat.rows : 0;
  const hotelPressure = Math.min(stat.hotelCount / 75, 1);
  const diameterPressure = Math.min(stat.avgDiameter / 500, 1);
  stat.priorityScore = (stat.avgProbability * 0.52) + (hotelPressure * 0.28) + (diameterPressure * 0.20) + (leakRate * 0.12);
  stat.priority = stat.priorityScore >= 0.66 ? 'high' : stat.priorityScore >= 0.38 ? 'medium' : 'low';
  stat.reasons = [
    `${percent(stat.avgProbability)} average leak probability`,
    `${Math.round(stat.avgDiameter || 0)} mm average pipe diameter`,
    `${stat.hotelCount} nearby hotels/accommodation places`,
  ];
}

function predictXgboost(row, modelJson) {
  const trees = modelJson.learner.gradient_booster.model.trees;
  const baseScore = parseFloat(String(modelJson.learner.learner_model_param.base_score).replace(/[\[\]]/g, '')) || 0.5;
  const vector = featureVector(row);
  let margin = logit(baseScore);
  for (const tree of trees) margin += traverseTree(tree, vector);
  return sigmoid(margin);
}

function traverseTree(tree, vector) {
  let node = 0;
  while (tree.left_children[node] !== -1) {
    const featureIndex = tree.split_indices[node];
    const threshold = tree.split_conditions[node];
    const value = vector[featureIndex];
    const missingGoLeft = tree.default_left[node] === 1;
    if (!Number.isFinite(value)) node = missingGoLeft ? tree.left_children[node] : tree.right_children[node];
    else node = value < threshold ? tree.left_children[node] : tree.right_children[node];
  }
  return tree.base_weights[node] || 0;
}

function featureVector(row) {
  const material = String(row.MATERIAL_1 || '').toUpperCase();
  const className = String(row.Class_name || '').toLowerCase();
  const zone = neighbourhoodZone(row.Name);
  const values = new Array(19).fill(0);
  values[0] = material === 'DI' ? 3 : 0;
  values[1] = material.includes('HDPE') ? 3 : 0;
  values[2] = material.includes('STEEL') || material.includes('ST') ? 3 : 0;
  values[3] = material.includes('UPVC') ? 3 : 0;
  values[4] = material && !['DI', 'UPVC', 'HDPE', 'STEEL', 'ST'].some((m) => material.includes(m)) ? 3 : 0;
  values[5] = className.includes('road') ? 3 : 0;
  values[6] = className.includes('building') ? 3 : 0;
  values[7] = className.includes('service') ? 3 : 0;
  values[8] = className && !['road', 'building', 'service'].some((c) => className.includes(c)) ? 3 : 0;
  values[9] = zone === 'central' ? 3 : 0;
  values[10] = zone === 'east' ? 3 : 0;
  values[11] = zone === 'north' ? 3 : 0;
  values[12] = zone === 'south' ? 3 : 0;
  values[13] = zone === 'west' ? 3 : 0;
  values[14] = zone === 'other' ? 3 : 0;
  values[15] = String(row.ASSETSTATU || '').toLowerCase().includes('active') ? 3 : 0;
  values[16] = toNumber(row.DIAMETER_1);
  values[17] = toNumber(row.pipe_age);
  values[18] = toNumber(row.NEW_REL_PR);
  return values;
}

async function enrichHotelsFromOverpass() {
  el.hotelBtn.disabled = true;
  el.hotelBtn.textContent = 'Fetching hotels...';
  const stats = [...state.neighbourhoods.values()];
  try {
    await Promise.all(stats.map(async (stat) => {
      stat.hotelCount = await fetchHotelCount(stat.coords);
      scoreNeighbourhood(stat);
    }));
    renderInsights('Live accommodation counts were fetched from the public OpenStreetMap Overpass API. No API key is stored in the code.');
  } catch (error) {
    renderInsights(`Hotel API failed, so fallback estimates remain active: ${error.message}`);
  } finally {
    renderAll();
    el.hotelBtn.textContent = 'Refresh hotel counts';
    el.hotelBtn.disabled = false;
  }
}

async function fetchHotelCount([lat, lon]) {
  const query = `[out:json][timeout:18];(node["tourism"~"hotel|apartment|guest_house|hostel"](around:1800,${lat},${lon});way["tourism"~"hotel|apartment|guest_house|hostel"](around:1800,${lat},${lon}););out center;`;
  const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
  const data = await response.json();
  return new Set((data.elements || []).map((item) => item.id)).size;
}

function renderAll() {
  renderMetrics();
  renderList();
  renderMap();
  renderSelected(state.selectedName || [...state.neighbourhoods.keys()][0]);
}

function renderMetrics() {
  const counts = { high: 0, medium: 0, low: 0 };
  state.neighbourhoods.forEach((stat) => counts[stat.priority]++);
  el.highCount.textContent = counts.high;
  el.mediumCount.textContent = counts.medium;
  el.lowCount.textContent = counts.low;
  el.rowCount.textContent = state.predictions.length.toLocaleString();
}

function renderList() {
  const stats = sortedStats();
  el.list.className = 'neighbourhood-list';
  el.list.innerHTML = '';
  stats.forEach((stat) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `neighbourhood-item ${state.selectedName === stat.name ? 'active' : ''}`;
    button.innerHTML = `
      <span class="item-title"><span>${escapeHtml(stat.name)}</span><span class="badge ${stat.priority}-bg">${priorityLabel(stat.priority)}</span></span>
      <span class="item-meta"><span>${stat.predictedLeaks}/${stat.rows} leaks</span><span>${percent(stat.avgProbability)}</span><span>${stat.hotelCount} hotels</span></span>`;
    button.addEventListener('click', () => focusNeighbourhood(stat.name));
    el.list.appendChild(button);
  });
}

function renderMap() {
  clearMap();
  sortedStats().forEach((stat) => {
    const color = priorityColor(stat.priority);
    const radius = Math.max(520, Math.min(1700, 480 + stat.rows * 14 + stat.hotelCount * 5));
    const layer = L.circle(stat.coords, { radius, color, weight: 3, fillColor: color, fillOpacity: 0.36 }).addTo(map);
    layer.bindPopup(popupHtml(stat));
    layer.on('click', () => focusNeighbourhood(stat.name));
    state.layers.set(stat.name, layer);
  });
  if (state.layers.size) {
    const group = L.featureGroup([...state.layers.values()]);
    map.fitBounds(group.getBounds().pad(0.2));
  }
}

function renderSelected(name) {
  const stat = state.neighbourhoods.get(name);
  if (!stat) return;
  state.selectedName = name;
  el.selectedStats.innerHTML = `
    <p class="eyebrow">Selected neighbourhood</p>
    <h2>${escapeHtml(stat.name)}</h2>
    <p><span class="badge ${stat.priority}-bg">${priorityLabel(stat.priority)} priority</span></p>
    <div class="stat-grid">
      <div class="stat"><span>Priority score</span><strong>${percent(stat.priorityScore)}</strong></div>
      <div class="stat"><span>Predicted leaks</span><strong>${stat.predictedLeaks}/${stat.rows}</strong></div>
      <div class="stat"><span>Avg probability</span><strong>${percent(stat.avgProbability)}</strong></div>
      <div class="stat"><span>Hotels nearby</span><strong>${stat.hotelCount}</strong></div>
      <div class="stat"><span>Avg diameter</span><strong>${Math.round(stat.avgDiameter || 0)} mm</strong></div>
      <div class="stat"><span>Max diameter</span><strong>${Math.round(stat.maxDiameter || 0)} mm</strong></div>
    </div>
    <p>${stat.reasons.map(escapeHtml).join(' • ')}</p>`;
  renderList();
}

function focusNeighbourhood(name) {
  const stat = state.neighbourhoods.get(name);
  if (!stat) return;
  renderSelected(name);
  map.flyTo(stat.coords, 15, { duration: 0.7 });
  const layer = state.layers.get(name);
  if (layer) layer.openPopup();
}

function renderInsights(message) {
  if (!state.predictions.length) {
    el.insights.innerHTML = `<div class="insight"><strong>Status</strong><br>${escapeHtml(message)}</div>`;
    return;
  }
  const stats = sortedStats();
  const top = stats[0];
  const avgDiameter = average(state.predictions.map((row) => toNumber(row.DIAMETER_1)).filter(Number.isFinite));
  const missingDates = state.rows.filter((row) => !Number.isFinite(row.pipe_age)).length;
  el.insights.innerHTML = `
    <div class="insight"><strong>Top priority</strong><br>${escapeHtml(top.name)} has a ${percent(top.priorityScore)} combined score.</div>
    <div class="insight"><strong>Pipe diameter</strong><br>Average uploaded diameter is ${Math.round(avgDiameter || 0)} mm.</div>
    <div class="insight"><strong>Data readiness</strong><br>${missingDates} rows have missing or invalid installation dates.</div>
    <div class="insight"><strong>Hotel factor</strong><br>Hotels are retrieved from Overpass when available; otherwise local Makkah fallback estimates are used.</div>
    <div class="insight"><strong>Model features</strong><br>${FEATURE_ORDER.slice(16).join(', ')} plus encoded material/class/location indicators.</div>
    <div class="insight"><strong>Status</strong><br>${escapeHtml(message || 'Prediction completed.')}</div>`;
}

function popupHtml(stat) {
  return `<div class="popup-title">${escapeHtml(stat.name)}</div>
    <div><b>${priorityLabel(stat.priority)} priority</b></div>
    <div>Score: ${percent(stat.priorityScore)}</div>
    <div>Predicted leaks: ${stat.predictedLeaks}/${stat.rows}</div>
    <div>Hotels: ${stat.hotelCount}</div>
    <button type="button" onclick="document.dispatchEvent(new CustomEvent('focus-neighbourhood',{detail:'${escapeAttr(stat.name)}'}))">Open statistics</button>`;
}

document.addEventListener('focus-neighbourhood', (event) => focusNeighbourhood(event.detail));

function downloadResults() {
  const headers = [...Object.keys(state.predictions[0] || {}), 'priority'];
  const csv = [headers.join(',')].concat(state.predictions.map((row) => headers.map((key) => csvCell(key === 'priority' ? state.neighbourhoods.get(row.Name)?.priority : row[key])).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'makkah_leak_predictions.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function clearMap() { state.layers.forEach((layer) => layer.remove()); state.layers.clear(); }
function sortedStats() { return [...state.neighbourhoods.values()].sort((a, b) => b.priorityScore - a.priorityScore || b.rows - a.rows); }
function priorityColor(priority) { return priority === 'high' ? '#dc2626' : priority === 'medium' ? '#f59e0b' : '#22a06b'; }
function priorityLabel(priority) { return priority === 'high' ? 'High' : priority === 'medium' ? 'Medium' : 'Less'; }
function percent(value) { return `${Math.round((value || 0) * 100)}%`; }
function sigmoid(value) { return 1 / (1 + Math.exp(-value)); }
function logit(value) { return Math.log(value / (1 - value)); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function toNumber(value) { const number = Number.parseFloat(String(value ?? '').replace(/,/g, '')); return Number.isFinite(number) ? number : NaN; }
function calculatePipeAge(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? NaN : new Date().getFullYear() - date.getFullYear(); }

function resolveCoords(name, row) {
  if (Number.isFinite(row.Y) && Number.isFinite(row.X)) return [row.Y, row.X];
  if (knownNeighbourhoods[name]) return knownNeighbourhoods[name];
  const clean = name.replace(/^حي\s*/, '');
  if (knownNeighbourhoods[clean]) return knownNeighbourhoods[clean];
  const offset = hashCode(name) % 1000;
  const angle = (offset / 1000) * Math.PI * 2;
  const distance = 0.025 + ((offset % 80) / 1000);
  return [MAKKAH_CENTER[0] + Math.sin(angle) * distance, MAKKAH_CENTER[1] + Math.cos(angle) * distance];
}

function getFallbackHotelCount(name) {
  if (fallbackHotelCounts[name] !== undefined) return fallbackHotelCounts[name];
  if (/أجياد|اجياد|المسفلة|جرول|العزيزية|الحرم/.test(name)) return 80;
  if (/الشرائع|السلام|العوالي|الشوقية|الخالدية/.test(name)) return 22;
  return 8 + (hashCode(name) % 18);
}

function neighbourhoodZone(name) {
  if (/أجياد|اجياد|المسفلة|جرول|الحرم|الخالدية/.test(name)) return 'central';
  if (/الشرائع|السلام|التروية|الكوثر|العزيزية|العوالي/.test(name)) return 'east';
  if (/الزاهر|النزهة|البحيرات/.test(name)) return 'north';
  if (/الشوقية|بطحاء|ولي العهد/.test(name)) return 'south';
  if (/الحمراء|الكعكية/.test(name)) return 'west';
  return 'other';
}

function decodeMojibake(value) {
  if (!/[ØÙ]/.test(value)) return value;
  try {
    const bytes = Uint8Array.from([...value].map((char) => char.charCodeAt(0) & 255));
    return new TextDecoder('utf-8').decode(bytes);
  } catch { return value; }
}

function parseCsv(text) {
  const rows = [];
  let current = '', row = [], inQuotes = false;
  const pushCell = () => { row.push(current); current = ''; };
  const pushRow = () => { if (row.length || current) { pushCell(); rows.push(row); } row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i], next = text[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) pushCell();
    else if ((char === '\n' || char === '\r') && !inQuotes) { if (char === '\r' && next === '\n') i++; pushRow(); }
    else current += char;
  }
  pushRow();
  const headers = (rows.shift() || []).map((header) => header.replace(/^\uFEFF/, '').trim());
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== '')).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function describeColumns(rows) {
  const first = rows[0] || {};
  const required = ['DIAMETER_1', 'MATERIAL_1', 'INSTALLDAT', 'NEW_REL_PR', 'Class_name', 'Name'];
  const missing = required.filter((key) => !(key in first));
  return missing.length ? `Loaded ${rows.length.toLocaleString()} rows. Missing expected columns: ${missing.join(', ')}.` : `Loaded ${rows.length.toLocaleString()} rows with all expected model columns.`;
}

function hashCode(value) { return Math.abs([...String(value)].reduce((hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0)); }
function escapeHtml(value) { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }
function escapeAttr(value) { return escapeHtml(value).replace(/'/g, '&#39;'); }
function csvCell(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
