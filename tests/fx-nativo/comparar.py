"""Compara el procesado nativo (FxDsp.java) con el de Chromium (Web Audio).

Genera una señal de prueba (estéreo, con subidas y bajadas de volumen para que trabajen el
nivelador y el limitador), la pasa por la misma cadena que montaba ecualizador.js en un
OfflineAudioContext de Chromium y por FxDsp en Java, y mide la diferencia.

Uso (desde la raíz del repo; necesita Java y Playwright):
    python tests/fx-nativo/comparar.py
"""
import array
import math
import os
import random
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SR = 44100
SEG = 3.0
CH = 2

AUTOEQ = [
    ('lowshelf', 105, -1.1, 0.7), ('peaking', 43, -4.8, 0.75), ('peaking', 102, 2.5, 0.7),
    ('peaking', 283, -2.3, 1.01), ('peaking', 2322, 2.1, 2.05), ('highshelf', 10000, -8.0, 0.7),
    ('peaking', 8394, 2.4, 2.21), ('peaking', 5624, 1.1, 3.22), ('peaking', 1203, -0.8, 3.59),
]
EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]


def eq10(bands):
    out = []
    for i, f in enumerate(EQ_FREQS):
        t = 'lowshelf' if i == 0 else 'highshelf' if i == 9 else 'peaking'
        out.append((t, f, bands[i], 1.41))
    return out


CASOS = [
    # nombre, preDb, filtros, nivelador, balance, mono
    ('auriculares', -2.1, AUTOEQ, False, 0.0, False),
    ('auriculares+ecualizador', -8.1, AUTOEQ + eq10([6, 5.5, 4, 2, 0, 0, 0, 0, 0, 0]), False, 0.0, False),
    ('nivelador', 0.0, eq10([0, 0, 2, 3, 3, 2, 0, -1, -1, -1]), True, 0.0, False),
    ('balance izquierda', 0.0, [], False, -0.4, False),
    ('balance derecha + nivelador', 0.0, [], True, 0.7, False),
    ('mono', -3.0, eq10([3, 3, 2, 1, 0, 1, 2, 2, 1, 0]), False, 0.0, True),
    ('mono + balance', 0.0, [], True, 0.5, True),
    ('otros filtros', 0.0, [('lowpass', 9000, 3, 0), ('highpass', 40, 1, 0), ('notch', 3000, 0, 4),
                            ('bandpass', 1000, 0, 0.3), ('allpass', 500, 0, 1)], False, 0.0, False),
    ('saturando (+12 dB)', 12.0, [], False, 0.0, False),
]


def senal():
    random.seed(7)
    n = int(SR * SEG)
    x = array.array('f', [0.0]) * (n * CH)
    for i in range(n):
        t = i / SR
        # Volumen que sube y baja (fuerte, flojo, golpes) para el nivelador y el limitador.
        env = 0.15 + 0.85 * (0.5 + 0.5 * math.sin(2 * math.pi * 0.7 * t)) ** 3
        if int(t * 4) % 3 == 0 and (t * 4) % 1 < 0.08:
            env = 1.3
        base = (0.4 * math.sin(2 * math.pi * 60 * t) + 0.25 * math.sin(2 * math.pi * 440 * t)
                + 0.15 * math.sin(2 * math.pi * 3100 * t))
        l = env * (base + 0.08 * (random.random() * 2 - 1))
        r = env * (0.8 * base + 0.08 * (random.random() * 2 - 1) + 0.1 * math.sin(2 * math.pi * 900 * t))
        x[i * 2] = l
        x[i * 2 + 1] = r
    return x


JS = r"""
async ([data, sr, ch, c]) => {
  const frames = data.length / ch;
  const ctx = new OfflineAudioContext(2, frames, sr);
  const buf = ctx.createBuffer(ch, frames, sr);
  for (let k = 0; k < ch; k++) {
    const d = buf.getChannelData(k);
    for (let i = 0; i < frames; i++) d[i] = data[i * ch + k];
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  // Igual que buildFxChain + applyFxChain de ecualizador.js.
  const input = ctx.createGain();
  input.channelCount = c.mono ? 1 : 2;
  input.channelCountMode = c.mono ? 'explicit' : 'max';
  input.channelInterpretation = 'speakers';
  const pre = ctx.createGain();
  pre.gain.value = Math.pow(10, c.pre / 20);
  const chain = [input, pre];
  for (const [type, f, g, q] of c.filters) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.gain.value = g; b.Q.value = q;
    chain.push(b);
  }
  if (c.level) {
    const lv = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -24, knee: 18, ratio: 3, attack: 0.01, release: 0.3 }).forEach(([k, v]) => (lv[k].value = v));
    chain.push(lv);
  }
  if (Math.abs(c.bal) > 0.001) {
    const p = ctx.createStereoPanner();
    p.pan.value = c.bal;
    chain.push(p);
  }
  const lim = ctx.createDynamicsCompressor();
  Object.entries({ threshold: -1, knee: 0, ratio: 20, attack: 0.002, release: 0.12 }).forEach(([k, v]) => (lim[k].value = v));
  chain.push(lim);
  src.connect(chain[0]);
  for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
  chain[chain.length - 1].connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  const L = out.getChannelData(0), R = out.getChannelData(1);
  const res = new Array(frames * 2);
  for (let i = 0; i < frames; i++) { res[i * 2] = L[i]; res[i * 2 + 1] = R[i]; }
  return res;
}
"""


def java(entrada, caso, bloque):
    nombre, pre, filtros, nivel, bal, mono = caso
    plan = ';'.join(['1', str(pre), '1' if nivel else '0', str(bal), '1' if mono else '0',
                     '|'.join(f'{t},{f},{g},{q}' for t, f, g, q in filtros)])
    salida = entrada + '.out'
    r = subprocess.run(['java', '-cp', CLASES, 'FxTest', entrada, salida, str(CH), str(SR), str(bloque), plan],
                       capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    tiempo = [l for l in r.stderr.splitlines() if 'ms para' in l]
    y = array.array('f')
    with open(salida, 'rb') as fh:
        y.frombytes(fh.read())
    return y, (tiempo[0] if tiempo else '')


CLASES = os.path.join(tempfile.gettempdir(), 'fxnativo-clases')


def main():
    os.makedirs(CLASES, exist_ok=True)
    r = subprocess.run(['javac', '-d', CLASES,
                        os.path.join(RAIZ, 'app/src/main/java/com/viferor/radioespana/FxDsp.java'),
                        os.path.join(RAIZ, 'tests/fx-nativo/FxTest.java')], capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(r.stderr)
    x = senal()
    entrada = os.path.join(tempfile.gettempdir(), 'fxnativo-entrada.f32')
    with open(entrada, 'wb') as fh:
        x.tofile(fh)
    fallos = 0
    with sync_playwright() as p:
        nav = p.chromium.launch()
        page = nav.new_page()
        page.goto('about:blank')
        for caso in CASOS:
            nombre, pre, filtros, nivel, bal, mono = caso
            ref = page.evaluate(JS, [list(x), SR, CH, {'pre': pre, 'filters': filtros, 'level': nivel, 'bal': bal, 'mono': mono}])
            for bloque in (1024, 333):
                y, tiempo = java(entrada, caso, bloque)
                # Se ignoran los primeros 10 ms (arranque de los filtros y del retardo).
                ini = int(0.01 * SR) * 2
                err = max(abs(ref[i] - y[i]) for i in range(ini, len(ref)))
                pico = max(abs(v) for v in ref[ini:]) or 1
                rms = math.sqrt(sum((ref[i] - y[i]) ** 2 for i in range(ini, len(ref))) / (len(ref) - ini))
                db = 20 * math.log10(max(rms, 1e-12) / pico)
                ok = err < 2e-3 and db < -60
                fallos += 0 if ok else 1
                print(f"{'OK  ' if ok else 'FAIL'} {nombre:32s} bloque={bloque:5d} dif.máx={err:.2e} dif.rms={db:6.1f} dB pico={pico:.3f} {tiempo}")
        nav.close()
    print(f'{len(CASOS) * 2 - fallos}/{len(CASOS) * 2} OK')
    sys.exit(1 if fallos else 0)


if __name__ == '__main__':
    main()
