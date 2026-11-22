package com.viferor.radioespana;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;

import java.nio.ByteBuffer;

/**
 * Pasa el audio decodificado por FxDsp (ecualizador, auriculares, nivelador, balance, mono y
 * limitador) dentro del reproductor nativo. Trabaja en el hilo de reproducción de ExoPlayer,
 * que va por delante de lo que suena (cientos de milisegundos): por eso no se corta aunque
 * el móvil vaya cargado o tenga la pantalla apagada.
 *
 * Los ajustes llegan desde el hilo principal con setPlan() y se aplican en el siguiente
 * bloque de audio. Con todo apagado el audio pasa sin tocar.
 */
@OptIn(markerClass = UnstableApi.class)
final class FxAudioProcessor extends BaseAudioProcessor {
    private final FxDsp dsp = new FxDsp();
    private volatile FxDsp.Plan pending = FxDsp.Plan.OFF;
    private FxDsp.Plan applied;
    private float[] work = new float[0];

    void setPlan(FxDsp.Plan p) {
        pending = p == null ? FxDsp.Plan.OFF : p;
    }

    @Override
    protected AudioFormat onConfigure(AudioFormat in) throws UnhandledAudioFormatException {
        if (in.encoding != C.ENCODING_PCM_16BIT && in.encoding != C.ENCODING_PCM_FLOAT) {
            throw new UnhandledAudioFormatException(in);
        }
        dsp.configure(in.sampleRate, in.channelCount);
        applied = null;
        return in;
    }

    @Override
    public void queueInput(ByteBuffer input) {
        int remaining = input.remaining();
        if (remaining == 0) return;
        FxDsp.Plan p = pending;
        if (p != applied) {
            dsp.setPlan(p);
            applied = p;
        }
        ByteBuffer out = replaceOutputBuffer(remaining);
        if (!dsp.active()) {
            out.put(input);
            out.flip();
            return;
        }
        boolean f32 = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT;
        int channels = Math.max(1, inputAudioFormat.channelCount);
        int samples = remaining / (f32 ? 4 : 2);
        int frames = samples / channels;
        samples = frames * channels;
        if (work.length < samples) work = new float[samples];
        if (f32) {
            for (int i = 0; i < samples; i++) work[i] = input.getFloat();
        } else {
            for (int i = 0; i < samples; i++) work[i] = input.getShort() / 32768f;
        }
        // Si quedara algún byte suelto (no debería), se descarta para no atascar el búfer.
        input.position(input.limit());
        dsp.process(work, frames);
        if (f32) {
            for (int i = 0; i < samples; i++) out.putFloat(work[i]);
        } else {
            for (int i = 0; i < samples; i++) {
                int v = Math.round(work[i] * 32768f);
                if (v > 32767) v = 32767;
                else if (v < -32768) v = -32768;
                out.putShort((short) v);
            }
        }
        out.flip();
    }

    @Override
    protected void onFlush() {
        // Salto dentro de la canción o canción nueva: que no se arrastre el final de la anterior.
        dsp.reset();
    }

    @Override
    protected void onReset() {
        dsp.reset();
        applied = null;
    }
}
