import os
import numpy as np
import geopandas as gpd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.animation import FuncAnimation
from netCDF4 import Dataset

HAS_GEOPANDAS = True

INPUT = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\OASWC12_20260822_202400_72273_M01.nc'
OUTPUT = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\ascat_wind_vectors.png'
FRAME_BOUNDS = (-180, -165, 30, 40)
FRAME_EXTENT = (-180, -165, 30, 40)
DATA_WINDOW = (-182, -163, 28, 42)

print(f'Using input file: {INPUT}')

with Dataset(INPUT) as ds:
    lon = ds.variables['lon'][:]
    lat = ds.variables['lat'][:]
    speed = ds.variables['wind_speed'][:]
    direction_deg = ds.variables['wind_dir'][:]

    lon = np.asarray(lon, dtype=float).ravel()
    lat = np.asarray(lat, dtype=float).ravel()
    speed = np.asarray(speed, dtype=float).ravel()
    direction_deg = np.asarray(direction_deg, dtype=float).ravel()

    # Convert the raw 0–360° longitude to the standard signed system used in maps:
    # values > 180° are western longitudes, so 220° becomes -140° (140°W).
    lon = np.where(lon > 180.0, lon - 360.0, lon)

    valid = (
        np.isfinite(lon)
        & np.isfinite(lat)
        & np.isfinite(speed)
        & np.isfinite(direction_deg)
        & (speed > 0)
        & (speed < 100)
        & (direction_deg >= 0)
        & (direction_deg <= 360)
    )

    # Keep the point selection wider than the exact requested box so nearby valid wind samples are
    # still plotted and the coastal context remains visible instead of clipping the field to a tiny
    # subset of the available data.
    window = (
        (lon >= DATA_WINDOW[0]) & (lon <= DATA_WINDOW[1])
        & (lat >= DATA_WINDOW[2]) & (lat <= DATA_WINDOW[3])
    )
    valid = valid & window

    lon_v = lon[valid]
    lat_v = lat[valid]
    speed_v = speed[valid]
    direction_v = direction_deg[valid]

    # The dataset reports wind direction as the direction the air is moving toward (CF
    # standard_name: wind_to_direction), not the meteorological convention where the wind is
    # coming from. Use the direct flow vector so the particles move with the actual wind.
    theta = np.deg2rad(direction_v)
    u = speed_v * np.sin(theta)
    v = speed_v * np.cos(theta)

    # Downsample for readability while preserving the true anchor points.
    if len(lon_v) == 0:
        lon_v = np.array([], dtype=float)
        lat_v = np.array([], dtype=float)
        u = np.array([], dtype=float)
        v = np.array([], dtype=float)
        speed_v = np.array([], dtype=float)
    else:
        step = max(1, len(lon_v) // 2000)
        idx = np.arange(0, len(lon_v), step)
        lon_v = lon_v[idx]
        lat_v = lat_v[idx]
        u = u[idx]
        v = v[idx]
        speed_v = speed_v[idx]

fig, ax = plt.subplots(figsize=(14, 8))
ax.set_xlim(FRAME_EXTENT[0], FRAME_EXTENT[1])
ax.set_ylim(FRAME_EXTENT[2], FRAME_EXTENT[3])
ax.set_xticks(np.arange(FRAME_EXTENT[0], FRAME_EXTENT[1] + 1, 5))
ax.set_yticks(np.arange(FRAME_EXTENT[2], FRAME_EXTENT[3] + 1, 4))
ax.grid(True, alpha=0.3)
ax.set_xlabel('Longitude (°E/W)')
ax.set_ylabel('Latitude (°N)')
ax.set_facecolor('#e0f2fe')

if HAS_GEOPANDAS:
    land_url = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip'
    coast_url = 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_coastline.zip'

    land = gpd.read_file(land_url)
    coast = gpd.read_file(coast_url)

    land = land.to_crs('EPSG:4326')
    coast = coast.to_crs('EPSG:4326')

    land_window = land.cx[FRAME_EXTENT[0]:FRAME_EXTENT[1], FRAME_EXTENT[2]:FRAME_EXTENT[3]]
    coast_window = coast.cx[FRAME_EXTENT[0]:FRAME_EXTENT[1], FRAME_EXTENT[2]:FRAME_EXTENT[3]]

    if not land_window.empty:
        land_window.plot(ax=ax, color='#f8fafc', edgecolor='none', zorder=1)
    if not coast_window.empty:
        coast_window.plot(ax=ax, color='black', linewidth=1.0, zorder=2)

ax.set_title('ASCAT passive tracer drift simulation')

if len(lon_v) > 0:
    # Seed passive tracers across the grid and move each one by a nearest-neighbor Euler step:
    # at each frame, choose the closest vector in the field and advance a short distance in its
    # direction, then repeat. This makes the animation behave like a ball dropped into the flow.
    particle_count = min(1600, len(lon_v))
    particle_idx = np.linspace(0, len(lon_v) - 1, particle_count, dtype=int)
    positions_x = lon_v[particle_idx].copy()
    positions_y = lat_v[particle_idx].copy()
    tracer_speed = speed_v[particle_idx].copy()

    # Keep the full vector field for the nearest-neighbor lookup at each time step.
    field_lon = lon_v.copy()
    field_lat = lat_v.copy()
    field_u = u.copy()
    field_v = v.copy()
    field_speed = speed_v.copy()

    speed_min, speed_max = 0.0, 50.0
    color_norm = plt.Normalize(vmin=speed_min, vmax=speed_max)
    tracer_colors = plt.cm.viridis(color_norm(np.clip(tracer_speed * 1.94384, 0.0, 50.0)))
    scat = ax.scatter(positions_x, positions_y, s=28, c=tracer_colors,
                     edgecolors='black', linewidths=0.2, alpha=0.8)

    sm = plt.cm.ScalarMappable(cmap='viridis', norm=color_norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, label='Wind speed (kt)', pad=0.04)
else:
    positions_x = np.array([], dtype=float)
    positions_y = np.array([], dtype=float)
    tracer_speed = np.array([], dtype=float)
    field_lon = np.array([], dtype=float)
    field_lat = np.array([], dtype=float)
    field_u = np.array([], dtype=float)
    field_v = np.array([], dtype=float)
    field_speed = np.array([], dtype=float)
    color_norm = plt.Normalize(vmin=0.0, vmax=50.0)
    scat = ax.scatter([], [], s=28, c=[], edgecolors='black', linewidths=0.2, alpha=0.8)
    sm = plt.cm.ScalarMappable(cmap='viridis', norm=color_norm)
    sm.set_array([])
    cbar = fig.colorbar(sm, ax=ax, label='Wind speed (kt)', pad=0.04)

fig.tight_layout()
fig.savefig(OUTPUT, dpi=200, bbox_inches='tight')
gif_path = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\ascat_wind_vectors.gif'


def advance(frame):
    if len(positions_x) == 0:
        scat.set_offsets(np.empty((0, 2)))
        return scat,

    # Euler-style particle drift: at each step, choose the nearest vector in the field and move in
    # that direction for a short increment. This mimics dropping a ball into the flow and letting
    # it follow the local wind.
    step_scale = 0.0001
    if len(field_lon) > 0:
        dx = field_lon[None, :] - positions_x[:, None]
        dy = field_lat[None, :] - positions_y[:, None]
        dist2 = dx * dx + dy * dy
        nearest_idx = np.argmin(dist2, axis=1)
        local_u = field_u[nearest_idx]
        local_v = field_v[nearest_idx]

        positions_x[:] = positions_x + local_u * step_scale
        positions_y[:] = positions_y + local_v * step_scale

    local_speed = tracer_speed.copy()
    if len(field_lon) == 0:
        local_speed[:] = 0.0

    colors = plt.cm.viridis(color_norm(np.clip(local_speed * 1.94384, 0.0, 50.0)))
    scat.set_offsets(np.column_stack([positions_x, positions_y]))
    scat.set_color(colors)
    return scat,

anim = FuncAnimation(fig, advance, frames=180, interval=90, blit=True, repeat=True)
anim.save(gif_path, writer='pillow', fps=12, dpi=150)
print(f'Wrote static map to {OUTPUT}')
print(f'Wrote animated GIF to {gif_path}')
print(f'Valid vectors: {len(lon_v)}')
if len(lon_v) > 0:
    print(f'Lon range: {np.nanmin(lon_v):.2f} to {np.nanmax(lon_v):.2f}')
    print(f'Lat range: {np.nanmin(lat_v):.2f} to {np.nanmax(lat_v):.2f}')
    print(f'Speed range: {np.nanmin(speed_v):.2f} to {np.nanmax(speed_v):.2f} m/s')
else:
    print(f'No valid vectors in {FRAME_BOUNDS} window for this file.')
