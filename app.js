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
let animationFrameId = null;
let renderingGif = false;

let spatialIndex = new Map();
let vectorGrid = new Map();

let staticLayer = null;
let pointLayer = null;

const CELL_SIZE = 0.25;
const MAX_PARTICLES = 30000;
const PARTICLE_MARGIN = 4;

const NORMAL_SUBSTEPS = 5;
const BOOSTED_SUBSTEPS = 10;
const BOOST_DURATION_MS = 10000;

const GIF_EXPORT_WIDTH = 1920;

// Smooth vector-field settings.
const VECTOR_SEARCH_RADIUS = 4;
const MAX_NEIGHBOR_VECTORS = 12;
const VECTOR_SIGMA = CELL_SIZE * 2.5;

// Small randomization prevents particles from inheriting
// the exact spatial pattern of the source observations.
const PARTICLE_JITTER = CELL_SIZE * 0.8;

let speedBoostUntil = 0;


/* ------------------------------------------------------------------
   Projection
------------------------------------------------------------------ */

const project = (lon, lat) => ({
	x: (lon - view.w) / (view.e - view.w) * canvas.clientWidth,
	y: (view.n - lat) / (view.n - view.s) * canvas.clientHeight,
});

const unproject = (x, y) => ({
	lon: view.w + x / canvas.clientWidth * (view.e - view.w),
	lat: view.n - y / canvas.clientHeight * (view.n - view.s),
});


/* ------------------------------------------------------------------
   Spatial index
------------------------------------------------------------------ */

function cellKey(lon, lat) {
	return `${Math.floor((lon + 180) / CELL_SIZE)},${Math.floor((lat + 90) / CELL_SIZE)}`;
}

function buildSpatialIndex() {
	spatialIndex = new Map();
	vectorGrid = new Map();

	points.forEach((point, index) => {
		const key = cellKey(point.lon, point.lat);

		if (!spatialIndex.has(key)) {
			spatialIndex.set(key, []);
		}

		spatialIndex.get(key).push(index);

		// Keep ALL vectors in each cell rather than only one.
		if (!vectorGrid.has(key)) {
			vectorGrid.set(key, []);
		}

		vectorGrid.get(key).push(point);
	});
}


/* ------------------------------------------------------------------
   Smooth weighted vector lookup
------------------------------------------------------------------ */

/*
 * Find nearby observations and calculate a weighted-average vector.
 *
 * IMPORTANT:
 * We average vector X/Y components instead of averaging direction
 * angles directly. This avoids problems around 0° / 360°.
 */
function weightedVector(lon, lat) {
	const x = Math.floor((lon + 180) / CELL_SIZE);
	const y = Math.floor((lat + 90) / CELL_SIZE);

	const candidates = [];

	for (
		let ix = x - VECTOR_SEARCH_RADIUS;
		ix <= x + VECTOR_SEARCH_RADIUS;
		ix += 1
	) {
		for (
			let iy = y - VECTOR_SEARCH_RADIUS;
			iy <= y + VECTOR_SEARCH_RADIUS;
			iy += 1
		) {
			const cell = vectorGrid.get(`${ix},${iy}`);

			if (!cell) continue;

			for (const point of cell) {
				const dx = point.lon - lon;
				const dy = point.lat - lat;

				const distanceSquared =
					dx * dx +
					dy * dy;

				candidates.push({
					point,
					distanceSquared,
				});
			}
		}
	}

	if (!candidates.length) {
		return null;
	}

	// Only use the closest observations.
	candidates.sort(
		(a, b) => a.distanceSquared - b.distanceSquared
	);

	const nearest = candidates.slice(
		0,
		MAX_NEIGHBOR_VECTORS
	);

	let sumX = 0;
	let sumY = 0;
	let sumSpeed = 0;
	let totalWeight = 0;

	for (const { point, distanceSquared } of nearest) {
		/*
		 * Gaussian weighting.
		 *
		 * Observations very close to the particle have more influence,
		 * but nearby observations still contribute.
		 */
		const weight = Math.exp(
			-distanceSquared /
			(2 * VECTOR_SIGMA * VECTOR_SIGMA)
		);

		const angle =
			point.direction * Math.PI / 180;

		/*
		 * Direction convention used by the original code:
		 *
		 * sin(angle) = east/west
		 * cos(angle) = north/south
		 */
		const vx = Math.sin(angle);
		const vy = Math.cos(angle);

		sumX += vx * weight;
		sumY += vy * weight;

		sumSpeed += point.speed * weight;
		totalWeight += weight;
	}

	if (totalWeight <= 0) {
		return null;
	}

	const vx = sumX / totalWeight;
	const vy = sumY / totalWeight;

	const magnitude = Math.hypot(vx, vy);

	// If vectors cancel each other out, don't move.
	if (magnitude < 0.0001) {
		return null;
	}

	const direction =
		Math.atan2(vx, vy) * 180 / Math.PI;

	return {
		direction: (direction + 360) % 360,
		speed: sumSpeed / totalWeight,
	};
}


/*
 * Compatibility helper for the mouse tooltip.
 *
 * This still returns the closest actual observation rather than
 * the interpolated vector.
 */
function nearestVector(lon, lat) {
	const x = Math.floor((lon + 180) / CELL_SIZE);
	const y = Math.floor((lat + 90) / CELL_SIZE);

	let bestPoint = null;
	let bestDistance = Infinity;

	for (let radius = 0; radius <= 2; radius += 1) {
		for (let ix = x - radius; ix <= x + radius; ix += 1) {
			for (let iy = y - radius; iy <= y + radius; iy += 1) {
				const cell = vectorGrid.get(`${ix},${iy}`);

				if (!cell) continue;

				for (const point of cell) {
					const distance =
						(point.lon - lon) ** 2 +
						(point.lat - lat) ** 2;

					if (distance < bestDistance) {
						bestDistance = distance;
						bestPoint = point;
					}
				}
			}
		}
	}

	return bestPoint;
}


/* ------------------------------------------------------------------
   Particle creation
------------------------------------------------------------------ */

function makeParticles() {
	const nearbyPoints = points.filter(point =>
		point.lon >= view.w - PARTICLE_MARGIN &&
		point.lon <= view.e + PARTICLE_MARGIN &&
		point.lat >= view.s - PARTICLE_MARGIN &&
		point.lat <= view.n + PARTICLE_MARGIN
	);

	const stride = Math.max(
		1,
		Math.ceil(
			nearbyPoints.length / MAX_PARTICLES
		)
	);

	particles = nearbyPoints
		.filter((_, index) => index % stride === 0)
		.map(point => ({
			/*
			 * Start close to the observation but don't put every
			 * particle exactly on the observation coordinate.
			 */
			lon: point.lon +
				(Math.random() - 0.5) * PARTICLE_JITTER,

			lat: point.lat +
				(Math.random() - 0.5) * PARTICLE_JITTER,

			speed: point.speed,
		}));
}


/* ------------------------------------------------------------------
   Colors
------------------------------------------------------------------ */

function color(speed) {
	const bands = [
		[5, '#FFFFFF'],
		[10, '#88D1F6'],
		[15, '#46B5EC'],
		[20, '#1C90CA'],
		[25, '#30C016'],
		[30, '#74EC5F'],
		[34, '#DCD941'],
		[40, '#EC8346'],
		[45, '#D22D35'],
		[50, '#F26EF5'],
		[55, '#893BC4'],
		[60, '#9178ED'],
	];

	for (const [limit, bandColor] of bands) {
		if (speed < limit) {
			return bandColor;
		}
	}

	return '#B5B0F7';
}


/* ------------------------------------------------------------------
   Canvas resizing
------------------------------------------------------------------ */

function resize() {
	const ratio =
		window.devicePixelRatio || 1;

	canvas.width =
		canvas.clientWidth * ratio;

	canvas.height =
		canvas.clientHeight * ratio;

	mainCtx.setTransform(
		ratio,
		0,
		0,
		ratio,
		0,
		0
	);

	staticLayer =
		document.createElement('canvas');

	staticLayer.width = canvas.width;
	staticLayer.height = canvas.height;

	staticLayer
		.getContext('2d')
		.setTransform(
			ratio,
			0,
			0,
			ratio,
			0,
			0
		);

	pointLayer =
		document.createElement('canvas');

	pointLayer.width = canvas.width;
	pointLayer.height = canvas.height;

	pointLayer
		.getContext('2d')
		.setTransform(
			ratio,
			0,
			0,
			ratio,
			0,
			0
		);

	drawStatic();
	draw();
}


/* ------------------------------------------------------------------
   Coastlines
------------------------------------------------------------------ */

function drawCoastlines() {
	if (
		!coastlines ||
		!window.topojson ||
		!coastlines.objects ||
		!coastlines.objects.land
	) {
		return;
	}

	const land = topojson.feature(
		coastlines,
		coastlines.objects.land
	);

	ctx.beginPath();

	const geometries =
		land.type === 'FeatureCollection'
			? land.features.map(
				feature => feature.geometry
			)
			: [land.geometry];

	for (const geometry of geometries) {
		const polygons =
			geometry.type === 'Polygon'
				? [geometry.coordinates]
				: geometry.coordinates;

		for (const polygon of polygons) {
			for (const ring of polygon) {
				ring.forEach(
					([lon, lat], index) => {
						const point =
							project(lon, lat);

						const previous =
							ring[index - 1];

						const crossesDateLine =
							previous &&
							Math.abs(
								lon - previous[0]
							) > 180;

						index && !crossesDateLine
							? ctx.lineTo(
								point.x,
								point.y
							)
							: ctx.moveTo(
								point.x,
								point.y
							);
					}
				);
			}
		}
	}

	ctx.fillStyle = '#d6d4ca';
	ctx.strokeStyle = '#89979b';
	ctx.lineWidth = 0.8;

	ctx.fill();
	ctx.stroke();
}


/* ------------------------------------------------------------------
   High-resolution rendering
------------------------------------------------------------------ */

function projectTo(lon, lat, width, height) {
	return {
		x:
			(lon - view.w) /
			(view.e - view.w) *
			width,

		y:
			(view.n - lat) /
			(view.n - view.s) *
			height,
	};
}

function drawHighResolutionFrame(
	target,
	width,
	height
) {
	target.clearRect(
		0,
		0,
		width,
		height
	);

	target.fillStyle = '#d9edf0';
	target.fillRect(
		0,
		0,
		width,
		height
	);

	target.strokeStyle = '#b8d4d8';
	target.lineWidth = 1;

	for (
		let lon =
			Math.ceil(view.w / 30) * 30;
		lon <= view.e;
		lon += 30
	) {
		const point = projectTo(
			lon,
			0,
			width,
			height
		);

		target.beginPath();
		target.moveTo(point.x, 0);
		target.lineTo(point.x, height);
		target.stroke();
	}

	for (
		let lat =
			Math.ceil(view.s / 15) * 15;
		lat <= view.n;
		lat += 15
	) {
		const point = projectTo(
			0,
			lat,
			width,
			height
		);

		target.beginPath();
		target.moveTo(0, point.y);
		target.lineTo(width, point.y);
		target.stroke();
	}

	if (
		coastlines &&
		window.topojson &&
		coastlines.objects &&
		coastlines.objects.land
	) {
		const land = topojson.feature(
			coastlines,
			coastlines.objects.land
		);

		const geometries =
			land.type === 'FeatureCollection'
				? land.features.map(
					feature => feature.geometry
				)
				: [land.geometry];

		target.beginPath();

		for (const geometry of geometries) {
			const polygons =
				geometry.type === 'Polygon'
					? [geometry.coordinates]
					: geometry.coordinates;

			for (const polygon of polygons) {
				for (const ring of polygon) {
					ring.forEach(
						([lon, lat], index) => {
							const point =
								projectTo(
									lon,
									lat,
									width,
									height
								);

							const previous =
								ring[index - 1];

							const crossesDateLine =
								previous &&
								Math.abs(
									lon -
									previous[0]
								) > 180;

							index &&
							!crossesDateLine
								? target.lineTo(
									point.x,
									point.y
								)
								: target.moveTo(
									point.x,
									point.y
								);
						}
					);
				}
			}
		}

		target.fillStyle = '#d6d4ca';
		target.strokeStyle = '#89979b';
		target.lineWidth = 1.5;

		target.fill();
		target.stroke();
	}

	for (const particle of particles) {
		if (
			particle.lon < view.w ||
			particle.lon > view.e ||
			particle.lat < view.s ||
			particle.lat > view.n
		) {
			continue;
		}

		const point = projectTo(
			particle.lon,
			particle.lat,
			width,
			height
		);

		target.beginPath();

		target.arc(
			point.x,
			point.y,
			4,
			0,
			Math.PI * 2
		);

		target.fillStyle =
			color(
				particle.speed * 1.94384
			);

		target.fill();
	}
}


/* ------------------------------------------------------------------
   Static layer
------------------------------------------------------------------ */

function drawStatic() {
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;

	ctx.clearRect(
		0,
		0,
		width,
		height
	);

	ctx.fillStyle = '#d9edf0';

	ctx.fillRect(
		0,
		0,
		width,
		height
	);

	ctx.strokeStyle = '#b8d4d8';
	ctx.lineWidth = 1;

	for (
		let lon =
			Math.ceil(view.w / 30) * 30;
		lon <= view.e;
		lon += 30
	) {
		const point = project(lon, 0);

		ctx.beginPath();
		ctx.moveTo(point.x, 0);
		ctx.lineTo(point.x, height);
		ctx.stroke();
	}

	for (
		let lat =
			Math.ceil(view.s / 15) * 15;
		lat <= view.n;
		lat += 15
	) {
		const point = project(0, lat);

		ctx.beginPath();
		ctx.moveTo(0, point.y);
		ctx.lineTo(width, point.y);
		ctx.stroke();
	}

	drawCoastlines();

	const pointsContext =
		pointLayer.getContext('2d');

	pointsContext.clearRect(
		0,
		0,
		width,
		height
	);

	for (const point of points) {
		if (
			point.lon < view.w ||
			point.lon > view.e ||
			point.lat < view.s ||
			point.lat > view.n
		) {
			continue;
		}

		const projected =
			project(
				point.lon,
				point.lat
			);

		pointsContext.beginPath();

		pointsContext.arc(
			projected.x,
			projected.y,
			view.e - view.w < 40
				? 2.2
				: 1.1,
			0,
			Math.PI * 2
		);

		pointsContext.fillStyle =
			color(
				point.speed * 1.94384
			);

		pointsContext.fill();
	}

	if (staticLayer) {
		staticLayer
			.getContext('2d')
			.drawImage(
				canvas,
				0,
				0,
				width,
				height
			);
	}
}


/* ------------------------------------------------------------------
   Animation rendering
------------------------------------------------------------------ */

function draw() {
	const width = canvas.clientWidth;
	const height = canvas.clientHeight;

	if (staticLayer) {
		mainCtx.clearRect(
			0,
			0,
			width,
			height
		);

		mainCtx.drawImage(
			staticLayer,
			0,
			0,
			width,
			height
		);

		if (
			!playing &&
			!renderingGif &&
			pointLayer
		) {
			mainCtx.drawImage(
				pointLayer,
				0,
				0,
				width,
				height
			);
		}
	}

	ctx = mainCtx;

	for (const particle of particles) {
		if (
			particle.lon < view.w ||
			particle.lon > view.e ||
			particle.lat < view.s ||
			particle.lat > view.n
		) {
			continue;
		}

		const projected =
			project(
				particle.lon,
				particle.lat
			);

		ctx.beginPath();

		ctx.arc(
			projected.x,
			projected.y,
			2.5,
			0,
			Math.PI * 2
		);

		ctx.fillStyle =
			color(
				particle.speed * 1.94384
			);

		ctx.fill();
	}

	if (drag) {
		const a = drag.start;
		const b = drag.now;

		ctx.strokeStyle = '#ed6a5a';
		ctx.setLineDash([6, 4]);
		ctx.lineWidth = 2;

		ctx.strokeRect(
			Math.min(a.x, b.x),
			Math.min(a.y, b.y),
			Math.abs(a.x - b.x),
			Math.abs(a.y - b.y)
		);

		ctx.setLineDash([]);
	}
}


/* ------------------------------------------------------------------
   Particle movement
------------------------------------------------------------------ */

function advanceParticles(
	step = 0.001,
	substeps = 1,
	shouldDraw = true
) {
	for (
		let substep = 0;
		substep < substeps;
		substep += 1
	) {
		for (const particle of particles) {
			const vector =
				weightedVector(
					particle.lon,
					particle.lat
				);

			if (!vector) {
				continue;
			}

			const angle =
				vector.direction *
				Math.PI /
				180;

			particle.lon +=
				Math.sin(angle) *
				step;

			particle.lat +=
				Math.cos(angle) *
				step;

			particle.speed =
				vector.speed;

			/*
			 * Wrap longitude around the globe.
			 */
			if (particle.lon > 180) {
				particle.lon -= 360;
			} else if (particle.lon < -180) {
				particle.lon += 360;
			}

			/*
			 * Keep particles from wandering beyond the poles.
			 */
			if (particle.lat > 90) {
				particle.lat = 90;
			} else if (particle.lat < -90) {
				particle.lat = -90;
			}
		}
	}

	if (shouldDraw) {
		draw();
	}
}


/* ------------------------------------------------------------------
   Animation loop
------------------------------------------------------------------ */

function animationLoop(timestamp) {
	if (!playing) {
		return;
	}

	const substeps =
		timestamp < speedBoostUntil
			? BOOSTED_SUBSTEPS
			: NORMAL_SUBSTEPS;

	advanceParticles(
		0.001,
		substeps
	);

	animationFrameId =
		requestAnimationFrame(
			animationLoop
		);
}


/* ------------------------------------------------------------------
   Mouse interaction
------------------------------------------------------------------ */

function nearestPoint(x, y) {
	const location = unproject(x, y);

	const point =
		nearestVector(
			location.lon,
			location.lat
		);

	if (!point) {
		return null;
	}

	const projected =
		project(
			point.lon,
			point.lat
		);

	return (
		(projected.x - x) ** 2 +
		(projected.y - y) ** 2
	) < 100
		? point
		: null;
}


/* ------------------------------------------------------------------
   View
------------------------------------------------------------------ */

function updateExtent() {
	extentEl.textContent =
		`${view.w.toFixed(1)}° to ` +
		`${view.e.toFixed(1)}° / ` +
		`${view.s.toFixed(1)}° to ` +
		`${view.n.toFixed(1)}°`;

	drawStatic();
	draw();
}

function focusAnimationView() {
	if (
		view.e - view.w <= 80 &&
		view.n - view.s <= 50
	) {
		return;
	}

	const anchor =
		particles[0] ||
		points[0];

	if (!anchor) {
		return;
	}

	const width = 24;
	const height = 16;

	const centerLon =
		Math.max(
			-180 + width / 2,
			Math.min(
				180 - width / 2,
				anchor.lon
			)
		);

	const centerLat =
		Math.max(
			-90 + height / 2,
			Math.min(
				90 - height / 2,
				anchor.lat
			)
		);

	view = {
		w: centerLon - width / 2,
		e: centerLon + width / 2,
		s: centerLat - height / 2,
		n: centerLat + height / 2,
	};

	updateExtent();
}


/* ------------------------------------------------------------------
   Pointer events
------------------------------------------------------------------ */

canvas.onpointerdown = event => {
	canvas.setPointerCapture(
		event.pointerId
	);

	drag = {
		start: {
			x: event.offsetX,
			y: event.offsetY,
		},
		now: {
			x: event.offsetX,
			y: event.offsetY,
		},
	};
};

canvas.onpointermove = event => {
	if (drag) {
		drag.now = {
			x: event.offsetX,
			y: event.offsetY,
		};

		draw();
		return;
	}

	const point =
		nearestPoint(
			event.offsetX,
			event.offsetY
		);

	if (!point) {
		tooltip.hidden = true;
		return;
	}

	tooltip.hidden = false;

	tooltip.style.left =
		`${event.offsetX + 18}px`;

	tooltip.style.top =
		`${event.offsetY + 10}px`;

	tooltip.innerHTML =
		`<b>${point.speed * 1.94384 | 0} kt</b>` +
		`<br>${point.lon.toFixed(2)}°, ` +
		`${point.lat.toFixed(2)}°` +
		`<br>${new Date(point.time).toLocaleString()}`;
};

canvas.onpointerup = () => {
	if (!drag) {
		return;
	}

	const first =
		unproject(
			Math.min(
				drag.start.x,
				drag.now.x
			),
			Math.max(
				drag.start.y,
				drag.now.y
			)
		);

	const second =
		unproject(
			Math.max(
				drag.start.x,
				drag.now.x
			),
			Math.min(
				drag.start.y,
				drag.now.y
			)
		);

	if (
		Math.abs(
			first.lon - second.lon
		) > 2 &&
		Math.abs(
			first.lat - second.lat
		) > 2
	) {
		view = {
			w: first.lon,
			e: second.lon,
			s: first.lat,
			n: second.lat,
		};

		updateExtent();
	}

	drag = null;
	draw();
};


/* ------------------------------------------------------------------
   Buttons
------------------------------------------------------------------ */

document.getElementById(
	'zoomOutBtn'
).onclick = () => {
	view = {
		w: -180,
		e: 180,
		s: -90,
		n: 90,
	};

	updateExtent();
};

document.getElementById(
	'worldBtn'
).onclick = () => {
	view = {
		w: -180,
		e: 180,
		s: -90,
		n: 90,
	};

	updateExtent();
};

document.getElementById(
	'playBtn'
).onclick = () => {
	if (!playing) {
		focusAnimationView();
	}

	if (!playing) {
		makeParticles();
	}

	playing = !playing;

	document.getElementById(
		'playBtn'
	).textContent =
		playing
			? 'Pause drift'
			: 'Play drift';

	if (playing) {
		speedBoostUntil =
			performance.now() +
			BOOST_DURATION_MS;

		animationFrameId =
			requestAnimationFrame(
				animationLoop
			);
	} else if (
		animationFrameId !== null
	) {
		cancelAnimationFrame(
			animationFrameId
		);

		animationFrameId = null;
	}

	draw();
};


/* ------------------------------------------------------------------
   GIF generation
------------------------------------------------------------------ */

document.getElementById(
	'gifBtn'
).onclick = async () => {
	if (
		!particles.length ||
		typeof GIF === 'undefined'
	) {
		return;
	}

	focusAnimationView();
	makeParticles();

	const button =
		document.getElementById(
			'gifBtn'
		);

	button.disabled = true;
	button.textContent = 'Rendering...';

	try {
		renderingGif = true;

		const workerSource =
			await fetch(
				'https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js'
			).then(
				response => response.text()
			);

		const workerUrl =
			URL.createObjectURL(
				new Blob(
					[workerSource],
					{
						type:
							'application/javascript',
					}
				)
			);

		const frames = [];

		const original =
			particles.map(p => ({
				lon: p.lon,
				lat: p.lat,
				speed: p.speed,
			}));

		const gifStep =
			Math.max(
				0.02,
				Math.min(
					0.08,
					(view.e - view.w) /
						600
				)
			);

		const exportCanvas =
			document.createElement(
				'canvas'
			);

		exportCanvas.width =
			GIF_EXPORT_WIDTH;

		exportCanvas.height =
			Math.round(
				GIF_EXPORT_WIDTH *
				canvas.clientHeight /
				canvas.clientWidth
			);

		const exportContext =
			exportCanvas.getContext(
				'2d'
			);

		for (
			let frame = 0;
			frame < 36;
			frame += 1
		) {
			advanceParticles(
				gifStep,
				1,
				false
			);

			await new Promise(
				resolve =>
					requestAnimationFrame(
						resolve
					)
			);

			exportContext.clearRect(
				0,
				0,
				exportCanvas.width,
				exportCanvas.height
			);

			drawHighResolutionFrame(
				exportContext,
				exportCanvas.width,
				exportCanvas.height
			);

			frames.push(
				exportCanvas.toDataURL(
					'image/png'
				)
			);
		}

		particles.forEach(
			(p, index) =>
				Object.assign(
					p,
					original[index]
				)
		);

		draw();

		const gif = new GIF({
			workers: 2,
			quality: 10,
			width: exportCanvas.width,
			height: exportCanvas.height,
			workerScript: workerUrl,
		});

		for (const frame of frames) {
			const image =
				new Image();

			image.src = frame;

			await new Promise(
				resolve => {
					image.onload = resolve;
				}
			);

			gif.addFrame(
				image,
				{
					delay: 140,
					copy: true,
				}
			);
		}

		gif.on('finished', blob => {
			renderingGif = false;

			const link =
				document.createElement(
					'a'
				);

			link.href =
				URL.createObjectURL(blob);

			link.download =
				'ascat-selection.gif';

			link.click();

			URL.revokeObjectURL(
				workerUrl
			);

			button.disabled = false;
			button.textContent =
				'Generate GIF';

			draw();
		});

		gif.on('abort', () => {
			renderingGif = false;

			URL.revokeObjectURL(
				workerUrl
			);

			button.disabled = false;
			button.textContent =
				'Generate GIF';

			draw();
		});

		gif.render();

	} catch (error) {
		renderingGif = false;

		console.error(
			'GIF generation failed',
			error
		);

		button.disabled = false;
		button.textContent =
			'Generate GIF';
	}
};


/* ------------------------------------------------------------------
   Data loading
------------------------------------------------------------------ */

async function load() {
	try {
		const data =
			await fetch(
				`data/latest.json?t=${Date.now()}`
			).then(response => {
				if (!response.ok) {
					throw new Error(
						`Data request failed: ${response.status}`
					);
				}

				return response.json();
			});

		points = data.points;

		buildSpatialIndex();
		makeParticles();

		drawStatic();

		statusEl.textContent =
			`${data.collection} · ` +
			`${new Date(
				data.generated
			).toLocaleString()}`;

		countEl.textContent =
			`${points.length.toLocaleString()} observations`;

		freshnessEl.textContent =
			new Date(
				data.generated
			).toLocaleString();

		draw();

	} catch (error) {
		statusEl.textContent =
			'No data file published yet';

		console.error(error);
	}

	try {
		const response =
			await fetch(
				'https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json'
			);

		if (!response.ok) {
			throw new Error(
				`Coastline request failed: ${response.status}`
			);
		}

		coastlines =
			await response.json();

		drawStatic();
		draw();

	} catch (error) {
		console.warn(
			'Coastline layer unavailable',
			error
		);
	}
}


/* ------------------------------------------------------------------
   Startup
------------------------------------------------------------------ */

window.addEventListener(
	'resize',
	resize
);

resize();
load();