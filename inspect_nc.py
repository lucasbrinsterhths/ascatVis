import os
import netCDF4
import numpy as np

p = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\OASWC12_20260822_172400_40429_M03.nc'
print('exists', os.path.exists(p), 'size', os.path.getsize(p))
with netCDF4.Dataset(p) as ds:
    print('dims', list(ds.dimensions.keys()))
    print('vars', list(ds.variables.keys()))
    for name in list(ds.variables.keys()):
        v = ds.variables[name]
        print(f'-- {name}: dims={v.dimensions}, shape={v.shape}, dtype={v.dtype}')
        if hasattr(v, 'units'):
            print('   units=', v.units)
        if hasattr(v, 'long_name'):
            print('   long_name=', v.long_name)
        if name.lower() in {'u10','v10','u_wind','v_wind','wind_speed','wind_dir','lon','lat'}:
            arr = v[:]
            print('   sample=', arr[:5] if arr.size > 5 else arr)
            print('   minmax=', np.nanmin(arr), np.nanmax(arr))
