import os
out = os.path.join(r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis', 'hello_marker.txt')
with open(out, 'w', encoding='utf-8') as f:
    f.write('marker')
print('WROTE', out)
