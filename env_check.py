import importlib.util, json
mods = ['numpy','matplotlib','cartopy','shapely','pyproj','pandas']
result = {m: bool(importlib.util.find_spec(m)) for m in mods}
with open('env_check.json', 'w', encoding='utf-8') as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))
