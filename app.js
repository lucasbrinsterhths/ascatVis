const canvas = document.getElementById('map');
const mainCtx = canvas.getContext('2d');
let ctx = mainCtx;
const tooltip = document.getElementById('tooltip');
const statusEl = document.getElementById('status');
const countEl = document.getElementById('count');
const extentEl = document.getElementById('extent');
const freshnessEl = document.getElementById('freshness');

let points = [];
let particles = [];
let coastlines = null;
let view = { w: -180, e: 180, s: -90, n: 90 };
let drag = null;
let playing = false;
let timer = null;
let spatialIndex = new Map();
let staticLayer = null;
const CELL_SIZE = 2;
const MAX_PARTICLES = 900;

const project = (lon, lat) => ({
	x: (lon - view.w) / (view.e - view.w) * canvas.clientWidth,
	y: (view.n - lat) / (view.n - view.s) * canvas.clientHeight,
});
const unproject = (x, y) => ({
	lon: view.w + x / canvas.clientWidth * (view.e - view.w),
	lat: view.n - y / canvas.clientHeight * (view.n - view.s),
});

function cellKey(lon, lat) {
	return `${Math.floor((lon + 180) / CELL_SIZE)},${Math.floor((lat + 90) / CELL_SIZE)}`;
}

function buildSpatialIndex() {
	spatialIndex = new Map();
	points.forEach((point, index) => {
		const key = cellKey(point.lon, point.lat);
		if (!spatialIndex.has(key)) spatialIndex.set(key, []);
		spatialIndex.get(key).push(index);
	});
}

function nearestVector(lon, lat) {
	const x = Math.floor((lon + 180) / CELL_SIZE);
	const y = Math.floor((lat + 90) / CELL_SIZE);
	let bestIndex = -1;
	let bestDistance = Infinity;
	for (let radius = 0; radius <= 2; radius += 1) {
		for (let ix = x - radius; ix <= x + radius; ix += 1) {
			for (let iy = y - radius; iy <= y + radius; iy += 1) {
				const candidates = spatialIndex.get(`${ix},${iy}`) || [];
				for (const index of candidates) {
					const point = points[index];
					const distance = (point.lon - lon) ** 2 + (point.lat - lat) ** 2;
					if (distance < bestDistance) {
						bestDistance = distance;
						bestIndex = index;
					}
				}
			}
		}
	}
	return bestIndex < 0 ? null : points[bestIndex];
}

function makeParticles() {
	const stride = Math.max(1, Math.ceil(points.length / MAX_PARTICLES));
	particles = points.filter((_, index) => index % stride === 0).map(point => ({
		lon: point.lon,
		lat: point.lat,
		speed: point.speed,
	}));
}

function color(speed) {
	const stops = ['#173f5f', '#20639b', '#3caea3', '#f6d55c', '#ed553b'];
	const t = Math.max(0, Math.min(1, speed / 50)) * (stops.length - 1);
	const i = Math.min(stops.length - 2, Math.floor(t));
	const f = t - i;
	const a = parseInt(stops[i].slice(1), 16);
	const b = parseInt(stops[i + 1].slice(1), 16);
	return `rgb(${((a >> 16) + ((b >> 16) - (a >> 16)) * f) | 0},${(((a >> 8 & 255) + ((b >> 8 & 255) - (a >> 8 & 255)) * f)) | 0},${(((a & 255) + ((b & 255) - (a & 255)) * f)) | 0})`;
}

function resize() {
	const ratio = window.devicePixelRatio || 1;
	canvas.width = canvas.clientWidth * ratio;
	canvas.height = canvas.clientHeight * ratio;
	mainCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
	staticLayer = document.createElement('canvas');
	staticLayer.width = canvas.width;
	staticLayer.height = canvas.height;
	staticLayer.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
	drawStatic();
	draw();
}

function drawCoastlines() {
	if (!coastlines || !window.topojson) return;
	const land = topojson.feature(coastlines, coastlines.objects.land);
	ctx.beginPath();
	for (const polygon of land.geometry.coordinates) {
		for (const ring of polygon) {
				ring.forEach(([lon, lat], index) => {
				const point = project(lon, lat);
					const previous = ring[index - 1];
					const crossesDateLine = previous && Math.abs(lon - previous[0]) > 180;
					index && !crossesDateLine ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y);
			});
		}
	}
	ctx.fillStyle = '#d6d4ca';
	ctx.strokeStyle = '#89979b';
	ctx.lineWidth = 0.8;
	ctx.fill();
	ctx.stroke();
}

function drawStatic() {
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	ctx.clearRect(0, 0, width, height);
	ctx.fillStyle = '#d9edf0';
	ctx.fillRect(0, 0, width, height);
	ctx.strokeStyle = '#b8d4d8';
	ctx.lineWidth = 1;
	for (let lon = Math.ceil(view.w / 30) * 30; lon <= view.e; lon += 30) {
		const point = project(lon, 0);
		ctx.beginPath(); ctx.moveTo(point.x, 0); ctx.lineTo(point.x, height); ctx.stroke();
	}
	for (let lat = Math.ceil(view.s / 15) * 15; lat <= view.n; lat += 15) {
		const point = project(0, lat);
		ctx.beginPath(); ctx.moveTo(0, point.y); ctx.lineTo(width, point.y); ctx.stroke();
	}
	drawCoastlines();
	for (const point of points) {
		if (point.lon < view.w || point.lon > view.e || point.lat < view.s || point.lat > view.n) continue;
		const projected = project(point.lon, point.lat);
		ctx.beginPath();
		ctx.arc(projected.x, projected.y, view.e - view.w < 40 ? 2.2 : 1.1, 0, Math.PI * 2);
		ctx.fillStyle = color(point.speed * 1.94384);
		ctx.fill();
	}
	if (staticLayer) {
		staticLayer.getContext('2d').drawImage(canvas, 0, 0, width, height);
	}
}

function draw() {
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;
	if (staticLayer) {
		mainCtx.clearRect(0, 0, width, height);
		mainCtx.drawImage(staticLayer, 0, 0, width, height);
	}
	ctx = mainCtx;
	for (const particle of particles) {
		if (particle.lon < view.w || particle.lon > view.e || particle.lat < view.s || particle.lat > view.n) continue;
		const projected = project(particle.lon, particle.lat);
		ctx.beginPath(); ctx.arc(projected.x, projected.y, 2.5, 0, Math.PI * 2);
		ctx.fillStyle = color(particle.speed * 1.94384); ctx.fill();
	}
	if (drag) {
		const a = drag.start; const b = drag.now;
		ctx.strokeStyle = '#ed6a5a'; ctx.setLineDash([6, 4]); ctx.lineWidth = 2;
		ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
		ctx.setLineDash([]);
	}
}

function advanceParticles() {
	for (const particle of particles) {
		const vector = nearestVector(particle.lon, particle.lat);
		if (!vector) continue;
		const angle = vector.direction * Math.PI / 180;
		const step = 0.004;
		particle.lon += Math.sin(angle) * step;
		particle.lat += Math.cos(angle) * step;
		particle.speed = vector.speed;
	}
	draw();
}

function nearestPoint(x, y) {
	const location = unproject(x, y);
	const point = nearestVector(location.lon, location.lat);
	if (!point) return null;
	const projected = project(point.lon, point.lat);
	return (projected.x - x) ** 2 + (projected.y - y) ** 2 < 100 ? point : null;
}

function updateExtent() {
	extentEl.textContent = `${view.w.toFixed(1)}° to ${view.e.toFixed(1)}° / ${view.s.toFixed(1)}° to ${view.n.toFixed(1)}°`;
	drawStatic();
	draw();
}

canvas.onpointerdown = event => {
	canvas.setPointerCapture(event.pointerId);
	drag = { start: { x: event.offsetX, y: event.offsetY }, now: { x: event.offsetX, y: event.offsetY } };
};
canvas.onpointermove = event => {
	if (drag) { drag.now = { x: event.offsetX, y: event.offsetY }; draw(); }
	else {
		const point = nearestPoint(event.offsetX, event.offsetY);
		if (!point) { tooltip.hidden = true; return; }
		tooltip.hidden = false; tooltip.style.left = `${event.offsetX + 18}px`; tooltip.style.top = `${event.offsetY + 10}px`;
		tooltip.innerHTML = `<b>${point.speed * 1.94384 | 0} kt</b><br>${point.lon.toFixed(2)}°, ${point.lat.toFixed(2)}°<br>${new Date(point.time).toLocaleString()}`;
	}
};
canvas.onpointerup = () => {
	if (!drag) return;
	const first = unproject(Math.min(drag.start.x, drag.now.x), Math.max(drag.start.y, drag.now.y));
	const second = unproject(Math.max(drag.start.x, drag.now.x), Math.min(drag.start.y, drag.now.y));
	if (Math.abs(first.lon - second.lon) > 2 && Math.abs(first.lat - second.lat) > 2) {
		view = { w: first.lon, e: second.lon, s: first.lat, n: second.lat }; updateExtent();
	}
	drag = null; draw();
};

document.getElementById('zoomOutBtn').onclick = () => { view = { w: -180, e: 180, s: -90, n: 90 }; updateExtent(); };
document.getElementById('worldBtn').onclick = () => { view = { w: -180, e: 180, s: -90, n: 90 }; updateExtent(); };
document.getElementById('playBtn').onclick = () => {
	playing = !playing;
	document.getElementById('playBtn').textContent = playing ? 'Pause drift' : 'Play drift';
	if (playing) timer = setInterval(advanceParticles, 120); else clearInterval(timer);
};

document.getElementById('gifBtn').onclick = async () => {
	if (!particles.length || typeof GIF === 'undefined') return;
	const button = document.getElementById('gifBtn'); button.disabled = true; button.textContent = 'Rendering...';
	const frames = []; const original = particles.map(p => ({ lon: p.lon, lat: p.lat, speed: p.speed }));
	for (let frame = 0; frame < 24; frame += 1) { advanceParticles(); frames.push(canvas.toDataURL('image/png')); }
	particles.forEach((p, index) => Object.assign(p, original[index])); draw();
	const gif = new GIF({ workers: 2, quality: 10, width: canvas.width, height: canvas.height, workerScript: 'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js' });
	for (const frame of frames) { const image = new Image(); image.src = frame; await new Promise(resolve => { image.onload = resolve; }); gif.addFrame(image, { delay: 100, copy: true }); }
	gif.on('finished', blob => { const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'ascat-selection.gif'; link.click(); button.disabled = false; button.textContent = 'Generate GIF'; });
	gif.render();
};

async function load() {
	try {
		const [data, land] = await Promise.all([
			fetch('data/latest.json').then(response => response.json()),
			fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json').then(response => response.json()),
		]);
		points = data.points; coastlines = land; buildSpatialIndex(); makeParticles(); drawStatic();
		statusEl.textContent = `${data.collection} · ${new Date(data.generated).toLocaleString()}`;
		countEl.textContent = `${points.length.toLocaleString()} observations`;
		freshnessEl.textContent = new Date(data.generated).toLocaleString();
		draw();
	} catch (error) { statusEl.textContent = 'No data file published yet'; console.error(error); }
}

window.addEventListener('resize', resize);
resize();
load();
