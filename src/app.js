const SAMPLE_FILE = './Excel_Table_1_modified_similar_leaks_needed_web%20.csv';
const MODEL_FILE = './xgboost_leak_model.json';
const BALANCE_FILE = './balance_check%20(1).csv';
const MAKKAH_CENTER = [39.8262, 21.4225];
const MAKKAH_BOUNDS = [[39.55, 21.22], [40.08, 21.62]];
const FEATURE_ORDER = [
  'MATERIAL_1_DI', 'MATERIAL_1_HDPE', 'MATERIAL_1_STEEL', 'MATERIAL_1_UPVC',
  'MATERIAL_1_OTHER', 'Class_name_Roads', 'Class_name_Buildings', 'Class_name_Service',
  'Class_name_Other', 'Name_known_central', 'Name_known_east', 'Name_known_north',
  'Name_known_south', 'Name_known_west', 'Name_known_other', 'asset_active',
  'DIAMETER_1', 'pipe_age', 'NEW_REL_PR'
];
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const state = {
  rows: [],
  model: null,
  predictions: [],
  neighbourhoods: new Map(),
  selectedName: null,
  balanceNames: new Set(),
  mapReady: false,
  lastGeoJson: EMPTY_GEOJSON,
};

const el = {
  datasetInput: document.querySelector('#datasetInput'),
  fileName: document.querySelector('#fileName'),
  loadSampleBtn: document.querySelector('#loadSampleBtn'),
  runModelBtn: document.querySelector('#runModelBtn'),
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

const map = new maplibregl.Map({
  container: 'map',
  center: MAKKAH_CENTER,
  zoom: 11.4,
  minZoom: 10,
  maxZoom: 17.5,
  maxBounds: MAKKAH_BOUNDS,
  pitch: 28,
  bearing: -12,
  attributionControl: false,
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-saturation': -0.1, 'raster-contrast': 0.05 } },
    ],
  },
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');
map.on('load', () => {
  state.mapReady = true;
  map.addSource('priority-areas', { type: 'geojson', data: EMPTY_GEOJSON });
  map.addLayer({
    id: 'priority-fills',
    type: 'fill',
    source: 'priority-areas',
    paint: {
      'fill-color': ['get', 'color'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.62, 0.36],
    },
  });
  map.addLayer({
    id: 'priority-outlines',
    type: 'line',
    source: 'priority-areas',
    paint: {
      'line-color': ['get', 'color'],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, 2],
      'line-opacity': 0.9,
    },
  });
  map.addLayer({
    id: 'priority-labels',
    type: 'symbol',
    source: 'priority-areas',
    layout: {
      'text-field': ['get', 'name'],
      'text-size': 13,
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#12211f',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.5,
    },
  });
  map.on('click', 'priority-fills', (event) => {
    const feature = event.features?.[0];
    if (feature?.properties?.name) focusNeighbourhood(feature.properties.name);
  });
  map.on('mouseenter', 'priority-fills', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'priority-fills', () => { map.getCanvas().style.cursor = ''; });
  updateMapSource();
});

const knownNeighbourhoods = {
  'حي الشرائع': [39.955, 21.478], 'الشرائع': [39.955, 21.478],
  'حي السلام': [39.88, 21.408], 'السلام': [39.88, 21.408],
  'حي التروية': [39.885, 21.438], 'التروية': [39.885, 21.438],
  'حي الكوثر': [39.895, 21.463], 'الكوثر': [39.895, 21.463],
  'حي أجياد': [39.826, 21.414], 'حي اجیاد': [39.826, 21.414],
  'حي العزيزية': [39.879, 21.405], 'حي العوالي': [39.876, 21.381],
  'حي النزهة': [39.792, 21.447], 'حي الزاهر': [39.806, 21.441],
  'حي الشوقية': [39.787, 21.373], 'حي بطحاء قريش': [39.825, 21.366],
  'حي الخالدية': [39.843, 21.397], 'حي المسفلة': [39.811, 21.409],
  'حي جرول': [39.811, 21.428], 'حي الحمراء': [39.783, 21.435],
  'حي البحيرات': [39.75, 21.505], 'حي ولي العهد': [39.73, 21.33],
};

const estimatedHotelCounts = {
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
el.resetMapBtn.addEventListener('click', resetToMakkah);
el.downloadBtn.addEventListener('click', downloadResults);

async function loadCsvText(text) {
  const rows = parseCsv(text).map(normalizeRow).filter((row) => Object.keys(row).length);
  state.rows = rows;
  state.predictions = [];
  state.neighbourhoods.clear();
  state.selectedName = null;
  state.lastGeoJson = EMPTY_GEOJSON;
  updateMapSource();
  resetToMakkah();
  el.rowCount.textContent = rows.length.toLocaleString();
  el.runModelBtn.disabled = !rows.length || !state.model;
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
  el.downloadBtn.disabled = false;
}

function buildNeighbourhoodStats() {
  state.neighbourhoods.clear();
  for (const row of state.predictions) {
    const name = row.Name || 'Unknown';
    if (!state.neighbourhoods.has(name)) {
      state.neighbourhoods.set(name, {
        name, rows: 0, predictedLeaks: 0, avgProbability: 0, avgDiameter: 0, maxDiameter: 0,
        hotelCount: getEstimatedHotelCount(name), coords: resolveCoords(name, row), priorityScore: 0, priority: 'low', reasons: [],
      });
    }
    const stat = state.neighbourhoods.get(name);
    stat.rows += 1;
    stat.predictedLeaks += row.leak_prediction;
    stat.avgProbability += row.leak_probability;
    stat.avgDiameter += Number.isFinite(row.DIAMETER_1) ? row.DIAMETER_1 : 0;
    stat.maxDiameter = Math.max(stat.maxDiameter, Number.isFinite(row.DIAMETER_1) ? row.DIAMETER_1 : 0);
    if (Number.isFinite(row.Y) && Number.isFinite(row.X)) stat.coords = clampToMakkah([row.X, row.Y]);
  }
  [...state.neighbourhoods.values()].forEach(scoreNeighbourhood);
}

function scoreNeighbourhood(stat) {
  stat.avgProbability = stat.rows ? stat.avgProbability / stat.rows : 0;
  stat.avgDiameter = stat.rows ? stat.avgDiameter / stat.rows : 0;
  const leakRate = stat.rows ? stat.predictedLeaks / stat.rows : 0;
  const hotelPressure = Math.min(stat.hotelCount / 75, 1);
  const diameterPressure = Math.min(stat.avgDiameter / 500, 1);
  stat.priorityScore = (stat.avgProbability * 0.50) + (hotelPressure * 0.30) + (diameterPressure * 0.20) + (leakRate * 0.10);
  stat.priority = stat.priorityScore >= 0.66 ? 'high' : stat.priorityScore >= 0.38 ? 'medium' : 'low';
  stat.reasons = [
    `${percent(stat.avgProbability)} average leak probability`,
    `${Math.round(stat.avgDiameter || 0)} mm average pipe diameter`,
    `${stat.hotelCount} estimated hotels/accommodation places in the area`,
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

function renderAll() {
  renderMetrics();
  renderList();
  renderMap();
  renderSelected(state.selectedName || sortedStats()[0]?.name);
  renderInsights('Prediction completed. Hotel pressure is estimated from each Makkah neighbourhood name and combined with pipe diameter in the priority score.');
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
  state.lastGeoJson = makePriorityGeoJson(sortedStats());
  updateMapSource();
  fitMapToStats();
}

function updateMapSource() {
  if (!state.mapReady) return;
  const source = map.getSource('priority-areas');
  if (source) source.setData(state.lastGeoJson);
}

function makePriorityGeoJson(stats) {
  return {
    type: 'FeatureCollection',
    features: stats.map((stat, index) => ({
      type: 'Feature',
      id: hashCode(stat.name),
      properties: {
        name: stat.name,
        priority: stat.priority,
        color: priorityColor(stat.priority),
        priorityScore: stat.priorityScore,
        rows: stat.rows,
        predictedLeaks: stat.predictedLeaks,
        sort: index,
      },
      geometry: makeNeighbourhoodPolygon(stat),
    })),
  };
}

function makeNeighbourhoodPolygon(stat) {
  const [lng, lat] = stat.coords;
  const size = Math.max(0.009, Math.min(0.026, 0.009 + stat.rows * 0.00016 + stat.hotelCount * 0.00005));
  const points = [];
  for (let step = 0; step <= 32; step++) {
    const angle = (Math.PI * 2 * step) / 32;
    const wobble = 0.82 + (((hashCode(stat.name) + step * 17) % 9) / 30);
    points.push([lng + Math.cos(angle) * size * wobble, lat + Math.sin(angle) * size * 0.72 * wobble]);
  }
  return { type: 'Polygon', coordinates: [points.map(clampToMakkah)] };
}

function fitMapToStats() {
  const stats = sortedStats();
  if (!stats.length) return resetToMakkah();
  const bounds = new maplibregl.LngLatBounds();
  stats.forEach((stat) => bounds.extend(stat.coords));
  map.fitBounds(bounds, { padding: 95, maxZoom: 13.5, duration: 700 });
}

function renderSelected(name) {
  const stat = state.neighbourhoods.get(name);
  if (!stat) return;
  const previousName = state.selectedName;
  state.selectedName = name;
  if (state.mapReady) {
    if (previousName && previousName !== name) map.setFeatureState({ source: 'priority-areas', id: hashCode(previousName) }, { selected: false });
    map.setFeatureState({ source: 'priority-areas', id: hashCode(name) }, { selected: true });
  }
  el.selectedStats.innerHTML = `
    <p class="eyebrow">Selected neighbourhood</p>
    <h2>${escapeHtml(stat.name)}</h2>
    <p><span class="badge ${stat.priority}-bg">${priorityLabel(stat.priority)} priority</span></p>
    <div class="stat-grid">
      <div class="stat"><span>Priority score</span><strong>${percent(stat.priorityScore)}</strong></div>
      <div class="stat"><span>Predicted leaks</span><strong>${stat.predictedLeaks}/${stat.rows}</strong></div>
      <div class="stat"><span>Avg probability</span><strong>${percent(stat.avgProbability)}</strong></div>
      <div class="stat"><span>Estimated hotels</span><strong>${stat.hotelCount}</strong></div>
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
  map.flyTo({ center: stat.coords, zoom: 14.4, pitch: 34, bearing: -10, duration: 750 });
  new maplibregl.Popup({ closeButton: true, closeOnClick: true, offset: 12 })
    .setLngLat(stat.coords)
    .setHTML(popupHtml(stat))
    .addTo(map);
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
    <div class="insight"><strong>Hotel factor</strong><br>Hotel pressure is estimated per Makkah neighbourhood and used only as a priority-scoring criterion.</div>
    <div class="insight"><strong>Map scope</strong><br>The MapLibre map is constrained to Makkah city bounds so it cannot drift to other countries.</div>
    <div class="insight"><strong>Status</strong><br>${escapeHtml(message || 'Prediction completed.')}</div>`;
}

function popupHtml(stat) {
  return `<div class="popup-title">${escapeHtml(stat.name)}</div>
    <div><b>${priorityLabel(stat.priority)} priority</b></div>
    <div>Score: ${percent(stat.priorityScore)}</div>
    <div>Predicted leaks: ${stat.predictedLeaks}/${stat.rows}</div>
    <div>Estimated hotels: ${stat.hotelCount}</div>`;
}

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

function resetToMakkah() { map.fitBounds(MAKKAH_BOUNDS, { padding: 35, duration: 650 }); }
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
  if (Number.isFinite(row.Y) && Number.isFinite(row.X)) return clampToMakkah([row.X, row.Y]);
  if (knownNeighbourhoods[name]) return knownNeighbourhoods[name];
  const clean = name.replace(/^حي\s*/, '');
  if (knownNeighbourhoods[clean]) return knownNeighbourhoods[clean];
  const offset = hashCode(name) % 1000;
  const angle = (offset / 1000) * Math.PI * 2;
  const distance = 0.025 + ((offset % 80) / 1000);
  return clampToMakkah([MAKKAH_CENTER[0] + Math.cos(angle) * distance, MAKKAH_CENTER[1] + Math.sin(angle) * distance]);
}

function clampToMakkah([lng, lat]) {
  return [
    Math.min(Math.max(lng, MAKKAH_BOUNDS[0][0] + 0.004), MAKKAH_BOUNDS[1][0] - 0.004),
    Math.min(Math.max(lat, MAKKAH_BOUNDS[0][1] + 0.004), MAKKAH_BOUNDS[1][1] - 0.004),
  ];
}

function getEstimatedHotelCount(name) {
  if (estimatedHotelCounts[name] !== undefined) return estimatedHotelCounts[name];
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
function csvCell(value) { const text = String(value ?? ''); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
