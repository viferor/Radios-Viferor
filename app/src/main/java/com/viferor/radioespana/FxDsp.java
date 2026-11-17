package com.viferor.radioespana;

/**
 * Procesado de sonido de «Mi música» en el motor nativo (APK 1.17+): la misma cadena que
 * hacía ecualizador.js con Web Audio, pero en Java, delante del reproductor nativo.
 *
 *   entrada ─ (mono) ─ preamplificación ─ filtros de auriculares + ecualizador ─ nivelador
 *           ─ balance ─ limitador ─ salida          (el volumen lo pone el reproductor)
 *
 * Las fórmulas son las de Chromium (BiquadFilterNode, DynamicsCompressorNode y
 * StereoPannerNode) para que suene igual que antes; tests/fx-nativo compara este código con
 * el Chromium de verdad. No usa nada de Android: así se puede probar en el ordenador.
 *
 * Por qué existe: con Web Audio el audio pasaba por el WebView, que en Android solo admite
 * búferes de unos milisegundos; con la pantalla apagada cualquier retraso del móvil se oía
 * como un microcorte. El reproductor nativo procesa por adelantado y entrega bloques grandes.
 */
public final class FxDsp {

    /** Un filtro tal como lo manda la web: tipo de BiquadFilterNode, frecuencia, ganancia, Q. */
    public static final class Filter {
        public final String type;
        public final double freq, gain, q;

        public Filter(String type, double freq, double gain, double q) {
            this.type = type == null ? "peaking" : type;
            this.freq = freq;
            this.gain = gain;
            this.q = q;
        }
    }

    /** Lo que hay que aplicar (inmutable: la web manda uno nuevo cada vez que cambia algo). */
    public static final class Plan {
        public final boolean on;
        public final double preDb;
        public final Filter[] filters;
        public final boolean level;
        public final double balance;
        public final boolean mono;

        public Plan(boolean on, double preDb, Filter[] filters, boolean level, double balance, boolean mono) {
            this.on = on;
            this.preDb = preDb;
            this.filters = filters == null ? new Filter[0] : filters;
            this.level = level;
            this.balance = Math.max(-1, Math.min(1, balance));
            this.mono = mono;
        }

        public static final Plan OFF = new Plan(false, 0, null, false, 0, false);
    }

    private Plan plan = Plan.OFF;
    private int sampleRate = 44100;
    private int channels = 2;
    private Biquad[] biquads = new Biquad[0];
    private Compressor leveler;
    private Compressor limiter;

    public void configure(int sampleRate, int channels) {
        this.sampleRate = sampleRate > 0 ? sampleRate : 44100;
        this.channels = Math.max(1, channels);
        rebuild(true);
    }

    public Plan plan() {
        return plan;
    }

    /** Cambia los ajustes. Si solo cambian los valores se conserva el estado de los filtros. */
    public void setPlan(Plan p) {
        if (p == null) p = Plan.OFF;
        Plan old = plan;
        plan = p;
        boolean mismaForma = old.filters.length == p.filters.length && old.on == p.on && old.mono == p.mono;
        rebuild(!mismaForma);
        // El nivelador recién encendido empieza de cero (no con lo que recordaba de hace rato).
        if (mismaForma && p.level && !old.level && leveler != null) leveler.reset();
    }

    public boolean active() {
        return plan.on;
    }

    /** Vacía la memoria de los filtros (al saltar dentro de la canción o cambiar de canción). */
    public void reset() {
        for (Biquad b : biquads) b.clear();
        if (leveler != null) leveler.reset();
        if (limiter != null) limiter.reset();
    }

    private void rebuild(boolean clearState) {
        int work = workChannels();
        Filter[] fs = plan.filters;
        Biquad[] nb = new Biquad[fs.length];
        for (int i = 0; i < fs.length; i++) {
            Biquad b = (!clearState && i < biquads.length && biquads[i].channels == work) ? biquads[i] : new Biquad(work);
            b.set(fs[i], sampleRate);
            nb[i] = b;
        }
        biquads = nb;
        if (clearState || leveler == null || leveler.channels != work || leveler.sampleRate != sampleRate) {
            leveler = new Compressor(work, sampleRate);
            limiter = new Compressor(work, sampleRate);
        }
        // Mismos valores que applyFxChain/buildFxChain en ecualizador.js.
        leveler.setParams(-24, 18, 3, 0.01f, 0.3f);
        limiter.setParams(-1, 0, 20, 0.002f, 0.12f);
    }

    /** Canales con los que se trabaja: 1 si se mezcla en mono. */
    private int workChannels() {
        return plan.mono ? 1 : channels;
    }

    private float[] monoBuf = new float[0];

    /**
     * Procesa en el sitio un bloque intercalado (L R L R…) de muestras en coma flotante
     * (-1..1). Con todo apagado no toca nada.
     */
    public void process(float[] buf, int frames) {
        Plan p = plan;
        if (!p.on || frames <= 0) return;
        final int ch = channels;
        final int wc = workChannels();
        float[] w;
        if (p.mono && ch > 1) {
            // GainNode con channelCount 1 «explicit» y «speakers»: (L+R)/2 (o la media).
            if (monoBuf.length < frames) monoBuf = new float[frames];
            w = monoBuf;
            for (int f = 0; f < frames; f++) {
                float s = 0;
                for (int c = 0; c < ch; c++) s += buf[f * ch + c];
                w[f] = ch == 2 ? 0.5f * s : s / ch;
            }
        } else {
            w = buf;
        }
        float pre = (float) Math.pow(10, p.preDb / 20);
        if (pre != 1f) for (int i = 0, n = frames * wc; i < n; i++) w[i] *= pre;
        for (Biquad b : biquads) b.process(w, frames);
        if (p.level) leveler.process(w, frames);
        boolean bal = Math.abs(p.balance) > 0.001;
        if (p.mono && ch > 1) {
            if (bal && ch == 2) {
                if (p.level) {
                    // El compresor de Chromium siempre saca dos canales: tras el nivelador el
                    // mono ya llega al balance como estéreo (L = R) y se usa esa fórmula.
                    for (int f = 0; f < frames; f++) buf[f * 2] = buf[f * 2 + 1] = w[f];
                    panStereo(buf, frames, p.balance);
                } else {
                    // StereoPanner con entrada mono.
                    double x = (p.balance + 1) * 0.5 * Math.PI / 2;
                    float gl = (float) Math.cos(x), gr = (float) Math.sin(x);
                    for (int f = 0; f < frames; f++) {
                        float m = w[f];
                        buf[f * 2] = m * gl;
                        buf[f * 2 + 1] = m * gr;
                    }
                }
                // El limitador trabaja ya en estéreo (lo que sale del balance).
                limiterStereo().process(buf, frames);
                return;
            }
            limiter.process(w, frames);
            // Al llegar a la salida (estéreo) el mono se copia en todos los canales.
            for (int f = 0; f < frames; f++) {
                float m = w[f];
                for (int c = 0; c < ch; c++) buf[f * ch + c] = m;
            }
            return;
        }
        if (bal && ch == 2) panStereo(buf, frames, p.balance);
        limiter.process(buf, frames);
    }

    /** StereoPanner de Chromium con entrada estéreo (potencia constante). */
    private static void panStereo(float[] buf, int frames, double pan) {
        double x = pan <= 0 ? (pan + 1) * Math.PI / 2 : pan * Math.PI / 2;
        double gl = Math.cos(x), gr = Math.sin(x);
        for (int f = 0; f < frames; f++) {
            float l = buf[f * 2], r = buf[f * 2 + 1];
            if (pan <= 0) {
                buf[f * 2] = (float) (l + r * gl);
                buf[f * 2 + 1] = (float) (r * gr);
            } else {
                buf[f * 2] = (float) (l * gl);
                buf[f * 2 + 1] = (float) (r + l * gr);
            }
        }
    }

    private Compressor limiter2;

    /** Limitador para el caso mono + balance (la señal vuelve a ser estéreo antes de limitar). */
    private Compressor limiterStereo() {
        if (limiter2 == null || limiter2.sampleRate != sampleRate) {
            limiter2 = new Compressor(2, sampleRate);
            limiter2.setParams(-1, 0, 20, 0.002f, 0.12f);
        }
        return limiter2;
    }

    // ------------------------------------------------------------------ Filtros

    /** BiquadFilterNode de Chromium (forma directa I, coeficientes en double). */
    static final class Biquad {
        final int channels;
        double b0 = 1, b1, b2, a1, a2;
        final double[] x1, x2, y1, y2;

        Biquad(int channels) {
            this.channels = channels;
            x1 = new double[channels];
            x2 = new double[channels];
            y1 = new double[channels];
            y2 = new double[channels];
        }

        void clear() {
            for (int c = 0; c < channels; c++) x1[c] = x2[c] = y1[c] = y2[c] = 0;
        }

        void set(Filter f, int sampleRate) {
            double nyquist = sampleRate / 2.0;
            // Frecuencia normalizada (0..1 = 0..Nyquist), como hace Chromium.
            double fr = Math.max(0, Math.min(1, f.freq / nyquist));
            String t = f.type.toLowerCase();
            switch (t) {
                case "lowpass": setLowpass(fr, f.q); break;
                case "highpass": setHighpass(fr, f.q); break;
                case "bandpass": setBandpass(fr, f.q); break;
                case "lowshelf": setLowShelf(fr, f.gain); break;
                case "highshelf": setHighShelf(fr, f.gain); break;
                case "notch": setNotch(fr, f.q); break;
                case "allpass": setAllpass(fr, f.q); break;
                default: setPeaking(fr, f.q, f.gain); break;
            }
        }

        private void norm(double b0, double b1, double b2, double a0, double a1, double a2) {
            double k = 1.0 / a0;
            this.b0 = b0 * k;
            this.b1 = b1 * k;
            this.b2 = b2 * k;
            this.a1 = a1 * k;
            this.a2 = a2 * k;
        }

        private void setZeroPolesCoefficients(double b0) {
            norm(b0, 0, 0, 1, 0, 0);
        }

        void setLowpass(double cutoff, double resonance) {
            if (cutoff >= 1) { setZeroPolesCoefficients(1); return; }
            if (cutoff <= 0) { setZeroPolesCoefficients(0); return; }
            double g = Math.pow(10.0, -0.05 * resonance);
            double w0 = Math.PI * cutoff;
            double cosw = Math.cos(w0);
            double alpha = 0.5 * Math.sin(w0) * g;
            double b1 = 1.0 - cosw;
            double b0 = 0.5 * b1;
            norm(b0, b1, b0, 1 + alpha, -2 * cosw, 1 - alpha);
        }

        void setHighpass(double cutoff, double resonance) {
            if (cutoff >= 1) { setZeroPolesCoefficients(0); return; }
            if (cutoff <= 0) { setZeroPolesCoefficients(1); return; }
            double g = Math.pow(10.0, -0.05 * resonance);
            double w0 = Math.PI * cutoff;
            double cosw = Math.cos(w0);
            double alpha = 0.5 * Math.sin(w0) * g;
            double b1 = -1.0 - cosw;
            double b0 = -0.5 * b1;
            norm(b0, b1, b0, 1 + alpha, -2 * cosw, 1 - alpha);
        }

        void setLowShelf(double frequency, double dbGain) {
            double A = Math.pow(10.0, dbGain / 40);
            if (frequency == 1) { setZeroPolesCoefficients(A * A); return; }
            if (frequency <= 0) { setZeroPolesCoefficients(1); return; }
            double w0 = Math.PI * frequency;
            double S = 1; // Web Audio no usa la Q en los «shelf»
            double alpha = 0.5 * Math.sin(w0) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
            double k = Math.cos(w0);
            double k2 = 2 * Math.sqrt(A) * alpha;
            double aPlusOne = A + 1;
            double aMinusOne = A - 1;
            norm(A * (aPlusOne - aMinusOne * k + k2),
                    2 * A * (aMinusOne - aPlusOne * k),
                    A * (aPlusOne - aMinusOne * k - k2),
                    aPlusOne + aMinusOne * k + k2,
                    -2 * (aMinusOne + aPlusOne * k),
                    aPlusOne + aMinusOne * k - k2);
        }

        void setHighShelf(double frequency, double dbGain) {
            double A = Math.pow(10.0, dbGain / 40);
            if (frequency == 1) { setZeroPolesCoefficients(1); return; }
            if (frequency <= 0) { setZeroPolesCoefficients(A * A); return; }
            double w0 = Math.PI * frequency;
            double S = 1;
            double alpha = 0.5 * Math.sin(w0) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
            double k = Math.cos(w0);
            double k2 = 2 * Math.sqrt(A) * alpha;
            double aPlusOne = A + 1;
            double aMinusOne = A - 1;
            norm(A * (aPlusOne + aMinusOne * k + k2),
                    -2 * A * (aMinusOne + aPlusOne * k),
                    A * (aPlusOne + aMinusOne * k - k2),
                    aPlusOne - aMinusOne * k + k2,
                    2 * (aMinusOne - aPlusOne * k),
                    aPlusOne - aMinusOne * k - k2);
        }

        void setPeaking(double frequency, double Q, double dbGain) {
            double A = Math.pow(10.0, dbGain / 40);
            if (frequency <= 0 || frequency >= 1) { setZeroPolesCoefficients(1); return; }
            if (Q <= 0) { setZeroPolesCoefficients(A * A); return; }
            double w0 = Math.PI * frequency;
            double alpha = Math.sin(w0) / (2 * Q);
            double k = Math.cos(w0);
            norm(1 + alpha * A, -2 * k, 1 - alpha * A, 1 + alpha / A, -2 * k, 1 - alpha / A);
        }

        void setBandpass(double frequency, double Q) {
            if (frequency <= 0 || frequency >= 1) { setZeroPolesCoefficients(0); return; }
            if (Q <= 0) { setZeroPolesCoefficients(1); return; }
            double w0 = Math.PI * frequency;
            double alpha = Math.sin(w0) / (2 * Q);
            double k = Math.cos(w0);
            norm(alpha, 0, -alpha, 1 + alpha, -2 * k, 1 - alpha);
        }

        void setNotch(double frequency, double Q) {
            if (frequency <= 0 || frequency >= 1) { setZeroPolesCoefficients(1); return; }
            if (Q <= 0) { setZeroPolesCoefficients(0); return; }
            double w0 = Math.PI * frequency;
            double alpha = Math.sin(w0) / (2 * Q);
            double k = Math.cos(w0);
            norm(1, -2 * k, 1, 1 + alpha, -2 * k, 1 - alpha);
        }

        void setAllpass(double frequency, double Q) {
            if (frequency <= 0 || frequency >= 1) { setZeroPolesCoefficients(1); return; }
            if (Q <= 0) { setZeroPolesCoefficients(-1); return; }
            double w0 = Math.PI * frequency;
            double alpha = Math.sin(w0) / (2 * Q);
            double k = Math.cos(w0);
            norm(1 - alpha, -2 * k, 1 + alpha, 1 + alpha, -2 * k, 1 - alpha);
        }

        void process(float[] buf, int frames) {
            final int ch = channels;
            for (int c = 0; c < ch; c++) {
                double px1 = x1[c], px2 = x2[c], py1 = y1[c], py2 = y2[c];
                for (int f = 0, i = c; f < frames; f++, i += ch) {
                    double x = buf[i];
                    double y = b0 * x + b1 * px1 + b2 * px2 - a1 * py1 - a2 * py2;
                    px2 = px1;
                    px1 = x;
                    py2 = py1;
                    py1 = y;
                    buf[i] = (float) y;
                }
                // Evita números «denormales» (muy lentos) en los silencios largos.
                if (Math.abs(py1) < 1e-30) py1 = 0;
                if (Math.abs(py2) < 1e-30) py2 = 0;
                x1[c] = px1;
                x2[c] = px2;
                y1[c] = py1;
                y2[c] = py2;
            }
        }
    }

    // ------------------------------------------------------------------ Compresor

    /**
     * DynamicsCompressorNode de Chromium (DynamicsCompressorKernel): curva con rodilla
     * exponencial, ganancia de compensación (makeup) y liberación adaptativa. Se procesa en
     * bloques de 32 muestras, como Chromium, aunque el búfer de entrada sea de otro tamaño.
     */
    static final class Compressor {
        static final int DIVISION = 32;
        static final double PRE_DELAY = 0.006;
        static final float RELEASE_ZONE1 = 0.09f, RELEASE_ZONE2 = 0.16f, RELEASE_ZONE3 = 0.42f, RELEASE_ZONE4 = 0.98f;
        static final float SAT_RELEASE_TIME = 0.0025f;
        static final float SPACING_DB = 5;
        static final int MAX_PRE_DELAY_FRAMES = 1024;
        static final int MASK = MAX_PRE_DELAY_FRAMES - 1;

        final int channels;
        final int sampleRate;
        final float[][] delay;
        int readIndex, writeIndex;

        // Parámetros
        float dbThreshold = Float.NaN, dbKnee = Float.NaN, ratio = Float.NaN;
        float attackTime, releaseTime;
        // Curva estática
        float linearThreshold, slope, kneeThresholdDb, kneeThreshold, ykneeThresholdDb, K;
        // Derivados por bloque
        float masterLinearGain, attackFrames, satReleaseFrames, satReleaseRateMin;
        float kA, kB, kC, kD, kE;
        // Estado
        float detectorAverage, compressorGain, maxAttackCompressionDiffDb;
        float envelopeRate, scaledDesiredGain;
        int divisionLeft;

        Compressor(int channels, int sampleRate) {
            this.channels = channels;
            this.sampleRate = sampleRate;
            delay = new float[channels][MAX_PRE_DELAY_FRAMES];
            reset();
        }

        void reset() {
            detectorAverage = 0;
            compressorGain = 1;
            maxAttackCompressionDiffDb = -1;
            for (float[] d : delay) java.util.Arrays.fill(d, 0);
            int pre = (int) (PRE_DELAY * sampleRate);
            if (pre > MAX_PRE_DELAY_FRAMES - 1) pre = MAX_PRE_DELAY_FRAMES - 1;
            readIndex = 0;
            writeIndex = pre;
            divisionLeft = 0;
        }

        static float lin2db(float x) {
            return (float) (20 * Math.log10(x));
        }

        static float db2lin(float db) {
            return (float) Math.pow(10, 0.05 * db);
        }

        float kneeCurve(float x, float k) {
            if (x < linearThreshold) return x;
            return linearThreshold + (1 - (float) Math.exp(-k * (x - linearThreshold))) / k;
        }

        float saturate(float x, float k) {
            if (x < kneeThreshold) return kneeCurve(x, k);
            float xDb = lin2db(x);
            float yDb = ykneeThresholdDb + slope * (xDb - kneeThresholdDb);
            return db2lin(yDb);
        }

        float slopeAt(float x, float k) {
            if (x < linearThreshold) return 1;
            float x2 = x * 1.001f;
            float xDb = lin2db(x);
            float x2Db = lin2db(x2);
            float yDb = lin2db(kneeCurve(x, k));
            float y2Db = lin2db(kneeCurve(x2, k));
            return (y2Db - yDb) / (x2Db - xDb);
        }

        float kAtSlope(float desiredSlope) {
            float xDb = dbThreshold + dbKnee;
            float x = db2lin(xDb);
            float minK = 0.1f, maxK = 10000, k = 5;
            for (int i = 0; i < 15; ++i) {
                float s = slopeAt(x, k);
                if (s < desiredSlope) maxK = k;
                else minK = k;
                k = (float) Math.sqrt(minK * maxK);
            }
            return k;
        }

        void setParams(float threshold, float knee, float ratio, float attack, float release) {
            if (threshold != dbThreshold || knee != dbKnee || ratio != this.ratio) {
                dbThreshold = threshold;
                linearThreshold = db2lin(threshold);
                dbKnee = knee;
                this.ratio = ratio;
                slope = 1 / ratio;
                float k = kAtSlope(1 / ratio);
                kneeThresholdDb = threshold + knee;
                kneeThreshold = db2lin(kneeThresholdDb);
                ykneeThresholdDb = lin2db(kneeCurve(kneeThreshold, k));
                K = k;
            }
            attackTime = attack;
            releaseTime = release;
            float fullRangeGain = saturate(1, K);
            float fullRangeMakeupGain = 1 / fullRangeGain;
            fullRangeMakeupGain = (float) Math.pow(fullRangeMakeupGain, 0.6f);
            masterLinearGain = fullRangeMakeupGain; // ganancia posterior 0 dB
            attackFrames = Math.max(0.001f, attackTime) * sampleRate;
            float releaseFrames = sampleRate * releaseTime;
            satReleaseFrames = SAT_RELEASE_TIME * sampleRate;
            satReleaseRateMin = db2lin(2.0f / satReleaseFrames) - 1;
            float y1 = releaseFrames * RELEASE_ZONE1;
            float y2 = releaseFrames * RELEASE_ZONE2;
            float y3 = releaseFrames * RELEASE_ZONE3;
            float y4 = releaseFrames * RELEASE_ZONE4;
            kA = 0.9999999999999998f * y1 + 1.8432219684323923e-16f * y2 - 1.9373394351676423e-16f * y3 + 8.824516011816245e-18f * y4;
            kB = -1.5788320352845888f * y1 + 2.3305837032074286f * y2 - 0.9141194204840429f * y3 + 0.1623677525612032f * y4;
            kC = 0.5334142869106424f * y1 - 1.272736789213631f * y2 + 0.9258856042207512f * y3 - 0.18656310191776226f * y4;
            kD = 0.08783463138207234f * y1 - 0.1694162967925622f * y2 + 0.08588057951595272f * y3 - 0.00429891410546283f * y4;
            kE = -0.042416883008123074f * y1 + 0.1115693827987602f * y2 - 0.09764676325265872f * y3 + 0.028494263462021576f * y4;
        }

        /** Cálculo del ritmo de la envolvente al empezar cada bloque de 32 muestras. */
        private void startDivision() {
            if (Float.isNaN(detectorAverage) || Float.isInfinite(detectorAverage)) detectorAverage = 1;
            float desiredGain = detectorAverage;
            scaledDesiredGain = (float) (Math.asin(desiredGain) / (Math.PI / 2));
            boolean isReleasing = scaledDesiredGain > compressorGain;
            float compressionDiffDb = lin2db(compressorGain / scaledDesiredGain);
            if (isReleasing) {
                maxAttackCompressionDiffDb = -1;
                if (Float.isNaN(compressionDiffDb) || Float.isInfinite(compressionDiffDb)) compressionDiffDb = -1;
                float x = compressionDiffDb;
                x = Math.max(-12.0f, Math.min(0.0f, x));
                x = 0.25f * (x + 12);
                float x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
                float releaseFrames = kA + kB * x + kC * x2 + kD * x3 + kE * x4;
                float dbPerFrame = SPACING_DB / releaseFrames;
                envelopeRate = db2lin(dbPerFrame);
            } else {
                if (Float.isNaN(compressionDiffDb) || Float.isInfinite(compressionDiffDb)) compressionDiffDb = 1;
                if (maxAttackCompressionDiffDb == -1 || maxAttackCompressionDiffDb < compressionDiffDb)
                    maxAttackCompressionDiffDb = compressionDiffDb;
                float effAttenDiffDb = Math.max(0.5f, maxAttackCompressionDiffDb);
                float x = 0.25f / effAttenDiffDb;
                envelopeRate = 1 - (float) Math.pow(x, 1 / attackFrames);
            }
        }

        void process(float[] buf, int frames) {
            final int ch = channels;
            final float k = K;
            for (int f = 0; f < frames; f++) {
                if (divisionLeft == 0) {
                    startDivision();
                    divisionLeft = DIVISION;
                }
                divisionLeft--;
                float compressorInput = 0;
                int base = f * ch;
                for (int c = 0; c < ch; c++) {
                    float v = buf[base + c];
                    delay[c][writeIndex] = v;
                    float a = v > 0 ? v : -v;
                    if (compressorInput < a) compressorInput = a;
                }
                float absInput = compressorInput;
                float attenuation, satReleaseRate;
                if (absInput < linearThreshold || absInput <= 0.0001f) {
                    // Por debajo del umbral no se comprime: atenuación 1 (0 dB → se usa el
                    // mínimo de 2 dB). Es lo más habitual y así no se calculan logaritmos.
                    attenuation = 1;
                    satReleaseRate = satReleaseRateMin;
                } else {
                    float shapedInput = saturate(absInput, k);
                    attenuation = shapedInput / absInput;
                    float attenuationDb = -lin2db(attenuation);
                    attenuationDb = Math.max(2.0f, attenuationDb);
                    float dbPerFrame = attenuationDb / satReleaseFrames;
                    satReleaseRate = db2lin(dbPerFrame) - 1;
                }
                boolean isRelease = attenuation > detectorAverage;
                float rate = isRelease ? satReleaseRate : 1;
                detectorAverage += (attenuation - detectorAverage) * rate;
                detectorAverage = Math.min(1.0f, detectorAverage);
                if (Float.isNaN(detectorAverage) || Float.isInfinite(detectorAverage)) detectorAverage = 1;
                if (envelopeRate < 1) {
                    compressorGain += (scaledDesiredGain - compressorGain) * envelopeRate;
                } else {
                    compressorGain *= envelopeRate;
                    compressorGain = Math.min(1.0f, compressorGain);
                }
                float postWarpCompressorGain = (float) Math.sin(Math.PI / 2 * compressorGain);
                float totalGain = masterLinearGain * postWarpCompressorGain;
                for (int c = 0; c < ch; c++) buf[base + c] = delay[c][readIndex] * totalGain;
                readIndex = (readIndex + 1) & MASK;
                writeIndex = (writeIndex + 1) & MASK;
            }
        }
    }
}
