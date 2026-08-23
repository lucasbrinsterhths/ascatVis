import os, json
try:
    import netCDF4
    import numpy as np
except Exception as e:
    with open('nc_inspect_error.txt', 'w', encoding='utf-8') as f:
        f.write(f'IMPORT_ERROR: {type(e).__name__}: {e}\n')
    raise

p = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\OASWC12_20260822_172400_40429_M03.nc'
out = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\nc_inspect.txt'
info = {'exists': os.path.exists(p), 'size': os.path.getsize(p) if os.path.exists(p) else None}
with netCDF4.Dataset(p) as ds:
    vars_list = list(ds.variables.keys())
    info['dimensions'] = list(ds.dimensions.keys())
    info['variables'] = []
    for name in vars_list:
        v = ds.variables[name]
        item = {
            'name': name,
            'dimensions': list(v.dimensions),
            'shape': list(v.shape),
            'dtype': str(v.dtype),
            'attrs': {},
        }
        for attr in ['units','long_name','standard_name','scale_factor','add_offset','coordinates','missing_value','_FillValue']:
            if hasattr(v, attr):
                val = getattr(v, attr)
                if isinstance(val, (bytes, bytearray)):
                    val = val.decode('utf-8', 'replace')
                item['attrs'][attr] = val
        info['variables'].append(item)
        if name.lower() in {'lon','lat','longitude','latitude','u10','v10','u_wind','v_wind','wind_speed','wind_direction','wind_dir','speed','direction'}:
            arr = v[:]
            flat = np.asarray(arr).ravel()
            finite = flat[np.isfinite(flat)]
            if finite.size:
                item['sample'] = finite[:10].tolist()
                item['min'] = float(np.nanmin(finite))
                item['max'] = float(np.nanmax(finite))
with open(out, 'w', encoding='utf-8') as f:
    json.dump(info, f, indent=2, default=str)
print(json.dumps(info, indent=2, default=str))
