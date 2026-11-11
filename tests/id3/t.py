import subprocess, shutil, os, sys
from mutagen.id3 import ID3, ID3v1SaveOptions, TIT2, TPE1, TDRC, TALB, APIC
from mutagen.mp3 import MP3
D=os.path.dirname(os.path.abspath(__file__)); M=sys.argv[1]
ok=0; bad=0
def chk(name, c, extra=''):
    global ok, bad
    print(('OK   ' if c else 'FAIL ')+name+('' if c else f'  [{extra}]')); 
    if c: ok+=1
    else: bad+=1
def audio(path):
    b=open(path,'rb').read()
    if b[:3]==b'ID3':
        sz=(b[6]<<21)|(b[7]<<14)|(b[8]<<7)|b[9]; b=b[10+sz:]
    if b[-128:-125]==b'TAG': b=b[:-128]
    return b
def run(f, mode, **kv):
    r=subprocess.run(['java','-cp',D+'/out','com.viferor.radioespana.T',f,mode]+[f'{k}={v}' for k,v in kv.items()],capture_output=True,text=True)
    assert r.returncode==0, r.stderr
for mode in ['one','two']:
    # 1. v2.3 con carátula: cambio pequeño (cabe en el hueco o no)
    f=f'{D}/a_{mode}.mp3'; shutil.copy(M+'/tag1.mp3', f); a0=audio(f)
    run(f, mode, title='Título nuevo ñ €', artist='Artista Ñ', year='1999', genre='Rock')
    t=ID3(f)
    chk(f'{mode}: título/artista (UTF-16)', str(t['TIT2'])=='Título nuevo ñ €' and str(t['TPE1'])=='Artista Ñ', t.pprint())
    chk(f'{mode}: año v2.3', 'TYER' in t or str(t.get('TDRC'))=='1999', t.pprint())
    chk(f'{mode}: conserva carátula y álbum', any(k.startswith('APIC') for k in t.keys()) and 'TALB' in t)
    chk(f'{mode}: audio intacto', audio(f)==a0)
    chk(f'{mode}: MP3 válido', MP3(f).info.length > 0)
    # 2. crece mucho → reescribe
    big='X'*5000
    run(f, mode, album=big, title='Corto')
    t=ID3(f)
    chk(f'{mode}: etiqueta grande (reescribe)', str(t['TALB'])==big and str(t['TIT2'])=='Corto' and audio(f)==a0 and any(k.startswith('APIC') for k in t.keys()))
    # 3. borrar un campo
    run(f, mode, genre='')
    chk(f'{mode}: borrar campo', 'TCON' not in ID3(f) and audio(f)==a0)
    # 4. con letra USLT
    g=f'{D}/b_{mode}.mp3'; shutil.copy(M+'/withlyrics.mp3', g); a1=audio(g)
    run(g, mode, title='Con letra editada', track='3/12', disc='1')
    t=ID3(g)
    chk(f'{mode}: conserva la letra', any(k.startswith('USLT') for k in t.keys()) and str(t['TRCK'])=='3/12' and str(t['TPOS'])=='1' and audio(g)==a1, t.pprint())
    # 5. sin etiqueta
    h=f'{D}/c_{mode}.mp3'; open(h,'wb').write(a1); 
    run(h, mode, title='Sin etiqueta antes', artist='X')
    t=ID3(h); chk(f'{mode}: archivo sin ID3', str(t['TIT2'])=='Sin etiqueta antes' and audio(h)==a1)
    # 6. v2.4 con ID3v1
    k=f'{D}/d_{mode}.mp3'; shutil.copy(M+'/tag1.mp3', k)
    t=ID3(k); t.save(k, v2_version=4, v1=ID3v1SaveOptions.CREATE); a2=audio(k)
    run(k, mode, year='2001-05-01', title='Versión cuatro', album='Álbum')
    t=ID3(k)
    chk(f'{mode}: v2.4 UTF-8 y TDRC', t.version[1]==4 and str(t['TIT2'])=='Versión cuatro' and str(t['TDRC']).startswith('2001') and audio(k)==a2, (t.version, t.pprint()))
    raw=open(k,'rb').read()[-128:]
    chk(f'{mode}: ID3v1 al día', raw[:3]==b'TAG' and raw[3:3+len('Versi')]==b'Versi' and raw[93:97]==b'2001', raw[:40])
print(f'{ok}/{ok+bad} OK')
