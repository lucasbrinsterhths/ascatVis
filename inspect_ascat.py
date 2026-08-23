import os, struct
p = r'c:\Users\lucas\OneDrive\HTHS\Random\ascatVis\ASCA_SZF_1B_M03_20260822161200Z_20260822175059Z_N_O_20260822175151Z.nat'
print('exists', os.path.exists(p))
print('size', os.path.getsize(p))
b = open(p, 'rb').read(256)
print('head bytes', list(b[:32]))
print('hex', b[:64].hex())
print('ascii', ''.join(chr(x) if 32 <= x < 127 else '.' for x in b[:128]))
print('u32', [struct.unpack('<I', b[i:i+4])[0] for i in range(0, 32, 4)])
print('u16', [struct.unpack('<H', b[i:i+2])[0] for i in range(0, 32, 2)])
