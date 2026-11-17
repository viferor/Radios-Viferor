import com.viferor.radioespana.FxDsp;
import java.io.*;
import java.nio.*;
import java.nio.file.*;

/**
 * Procesa un archivo de muestras (float32 intercaladas) con FxDsp y escribe el resultado.
 * Uso: java FxTest entrada.f32 salida.f32 canales frecuencia bloque "plan"
 * plan: on;preDb;level;balance;mono;tipo,frec,gan,q|tipo,frec,gan,q...
 * bloque: tamaño de los trozos en que se entrega el audio (para probar que da igual).
 */
public class FxTest {
    public static void main(String[] a) throws Exception {
        byte[] raw = Files.readAllBytes(Paths.get(a[0]));
        FloatBuffer fb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] x = new float[fb.remaining()];
        fb.get(x);
        int ch = Integer.parseInt(a[2]);
        int sr = Integer.parseInt(a[3]);
        int block = Integer.parseInt(a[4]);
        String[] p = a[5].split(";", -1);
        FxDsp.Filter[] fs = new FxDsp.Filter[0];
        if (p.length > 5 && !p[5].isEmpty()) {
            String[] parts = p[5].split("\\|");
            fs = new FxDsp.Filter[parts.length];
            for (int i = 0; i < parts.length; i++) {
                String[] q = parts[i].split(",");
                fs[i] = new FxDsp.Filter(q[0], Double.parseDouble(q[1]), Double.parseDouble(q[2]), Double.parseDouble(q[3]));
            }
        }
        FxDsp.Plan plan = new FxDsp.Plan("1".equals(p[0]), Double.parseDouble(p[1]), fs, "1".equals(p[2]), Double.parseDouble(p[3]), "1".equals(p[4]));
        FxDsp d = new FxDsp();
        d.configure(sr, ch);
        d.setPlan(plan);
        int frames = x.length / ch;
        float[] tmp = new float[block * ch];
        long t0 = System.nanoTime();
        for (int f = 0; f < frames; f += block) {
            int n = Math.min(block, frames - f);
            System.arraycopy(x, f * ch, tmp, 0, n * ch);
            d.process(tmp, n);
            System.arraycopy(tmp, 0, x, f * ch, n * ch);
        }
        long t1 = System.nanoTime();
        System.err.printf("%.1f ms para %.1f s de audio%n", (t1 - t0) / 1e6, frames / (double) sr);
        ByteBuffer out = ByteBuffer.allocate(x.length * 4).order(ByteOrder.LITTLE_ENDIAN);
        out.asFloatBuffer().put(x);
        Files.write(Paths.get(a[1]), out.array());
    }
}
