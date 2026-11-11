package com.viferor.radioespana;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Cambia las etiquetas ID3 de un MP3 sin tocar el audio ni el resto de etiquetas
 * (carátula, letra, comentarios…): solo se sustituyen los campos que se editan.
 *
 * Java puro (sin Android) para poder probarlo fuera del móvil. Trabaja con dos canales
 * sobre el mismo archivo (uno de lectura y otro de escritura) usando solo operaciones
 * con posición, porque en Android el archivo llega como descriptor de MediaStore.
 *
 * Si la etiqueta nueva cabe en el hueco de la antigua se escribe encima; si no, se
 * copia el audio a un temporal y se reescribe el archivo.
 */
final class Id3Editor {
    static final String[] KEYS = {"title", "artist", "album", "albumArtist", "track", "disc", "year", "genre"};
    private static final String[] FRAMES = {"TIT2", "TPE1", "TALB", "TPE2", "TRCK", "TPOS", null, "TCON"};
    private static final int PADDING = 2048;

    private Id3Editor() {}

    /** values: solo las claves que se cambian (cadena vacía = borrar ese campo). */
    static void write(FileChannel in, FileChannel out, Map<String, String> values, File tmpDir) throws IOException {
        long fileLen = in.size();
        byte[] head = readAt(in, 0, (int) Math.min(10, fileLen));
        int ver = 3;
        long oldTotal = 0;
        List<byte[]> kept = new ArrayList<>();
        Set<String> drop = new HashSet<>();
        for (int i = 0; i < KEYS.length; i++) {
            if (!values.containsKey(KEYS[i])) continue;
            if (FRAMES[i] != null) drop.add(FRAMES[i]);
            else drop.addAll(Arrays.asList("TYER", "TDRC", "TDAT", "TIME", "TRDA"));
        }

        if (head.length == 10 && head[0] == 'I' && head[1] == 'D' && head[2] == '3' && (head[3] & 0xff) <= 4) {
            int major = head[3] & 0xff;
            int flags = head[5] & 0xff;
            int size = syncsafe(head, 6);
            oldTotal = 10L + size + (major == 4 && (flags & 0x10) != 0 ? 10 : 0);
            if (oldTotal > fileLen) throw new IOException("Etiqueta ID3 dañada");
            if (major == 3 || major == 4) {
                ver = major;
                byte[] body = readAt(in, 10, size);
                if (major == 3 && (flags & 0x80) != 0) body = deUnsync(body);
                int pos = 0;
                if ((flags & 0x40) != 0 && body.length >= 4) {
                    pos = major == 3 ? 4 + int32(body, 0) : syncsafe(body, 0);
                }
                while (pos + 10 <= body.length) {
                    if (body[pos] == 0) break; // relleno
                    String id = new String(body, pos, 4, StandardCharsets.ISO_8859_1);
                    if (!id.matches("[A-Z0-9]{4}")) break;
                    int fsize = major == 4 ? syncsafe(body, pos + 4) : int32(body, pos + 4);
                    if (fsize < 0 || pos + 10 + fsize > body.length) break;
                    if (!drop.contains(id)) kept.add(Arrays.copyOfRange(body, pos, pos + 10 + fsize));
                    pos += 10 + fsize;
                }
            }
            // ID3v2.2 (muy antiguo): se sustituye por una v2.3 nueva.
        }

        ByteArrayOutputStream frames = new ByteArrayOutputStream();
        for (int i = 0; i < KEYS.length; i++) {
            String v = values.get(KEYS[i]);
            if (v == null) continue;
            v = v.trim();
            if (v.isEmpty()) continue;
            String id = FRAMES[i];
            if (id == null) { // año
                if (ver == 4) id = "TDRC";
                else {
                    java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d{4}").matcher(v);
                    if (!m.find()) continue;
                    v = m.group();
                    id = "TYER";
                }
            }
            frames.write(textFrame(id, v, ver));
        }
        for (byte[] f : kept) frames.write(f);
        byte[] fr = frames.toByteArray();

        long audioStart = oldTotal;
        long newTotal;
        boolean inPlace = oldTotal > 0 && 10L + fr.length <= oldTotal;
        newTotal = inPlace ? oldTotal : 10L + fr.length + PADDING;
        byte[] tag = new byte[(int) newTotal];
        tag[0] = 'I'; tag[1] = 'D'; tag[2] = '3';
        tag[3] = (byte) ver; tag[4] = 0; tag[5] = 0;
        putSyncsafe(tag, 6, (int) (newTotal - 10));
        System.arraycopy(fr, 0, tag, 10, fr.length);

        if (inPlace) {
            writeAt(out, 0, tag);
        } else {
            // Se guarda el audio aparte, se escribe la etiqueta y se vuelve a poner el audio detrás.
            File tmp = File.createTempFile("id3", ".audio", tmpDir);
            try (RandomAccessFile raf = new RandomAccessFile(tmp, "rw"); FileChannel t = raf.getChannel()) {
                long n = fileLen - audioStart;
                long done = 0;
                while (done < n) {
                    long c = in.transferTo(audioStart + done, n - done, t);
                    if (c <= 0) throw new IOException("No se pudo copiar el audio");
                    done += c;
                }
                if (t.size() != n) throw new IOException("Copia incompleta del audio");
                writeAt(out, 0, tag);
                done = 0;
                while (done < n) {
                    long c = out.transferFrom(t.position(done), newTotal + done, n - done);
                    if (c <= 0) throw new IOException("No se pudo reescribir el audio");
                    done += c;
                }
                out.truncate(newTotal + n);
            } finally {
                //noinspection ResultOfMethodCallIgnored
                tmp.delete();
            }
        }
        updateId3v1(in, out, values);
        out.force(true);
    }

    // ID3v1 (128 bytes al final): si existe, se pone al día para que no contradiga a la v2.
    private static void updateId3v1(FileChannel in, FileChannel out, Map<String, String> values) throws IOException {
        long len = in.size();
        if (len < 128) return;
        byte[] t = readAt(in, len - 128, 128);
        if (t[0] != 'T' || t[1] != 'A' || t[2] != 'G') return;
        put1(t, 3, 30, values.get("title"));
        put1(t, 33, 30, values.get("artist"));
        put1(t, 63, 30, values.get("album"));
        String y = values.get("year");
        if (y != null) {
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\d{4}").matcher(y);
            put1(t, 93, 4, m.find() ? m.group() : "");
        }
        String tr = values.get("track");
        if (tr != null && t[125] == 0) {
            try {
                int n = Integer.parseInt(tr.split("/")[0].trim());
                t[126] = (byte) Math.max(0, Math.min(255, n));
            } catch (NumberFormatException e) {
                t[126] = 0;
            }
        }
        writeAt(out, len - 128, t);
    }

    private static void put1(byte[] t, int off, int len, String v) {
        if (v == null) return;
        Arrays.fill(t, off, off + len, (byte) 0);
        String clean = java.text.Normalizer.normalize(v.trim(), java.text.Normalizer.Form.NFC);
        byte[] b = clean.getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(b, 0, t, off, Math.min(len, b.length));
    }

    private static byte[] textFrame(String id, String v, int ver) {
        byte[] text;
        byte enc;
        if (ver == 4) {
            enc = 3;
            text = v.getBytes(StandardCharsets.UTF_8);
        } else {
            enc = 1;
            byte[] u = v.getBytes(StandardCharsets.UTF_16LE);
            text = new byte[u.length + 2];
            text[0] = (byte) 0xFF;
            text[1] = (byte) 0xFE;
            System.arraycopy(u, 0, text, 2, u.length);
        }
        int size = 1 + text.length;
        byte[] f = new byte[10 + size];
        byte[] idb = id.getBytes(StandardCharsets.ISO_8859_1);
        System.arraycopy(idb, 0, f, 0, 4);
        if (ver == 4) putSyncsafe(f, 4, size);
        else putInt32(f, 4, size);
        f[10] = enc;
        System.arraycopy(text, 0, f, 11, text.length);
        return f;
    }

    private static byte[] deUnsync(byte[] b) {
        ByteArrayOutputStream o = new ByteArrayOutputStream(b.length);
        for (int i = 0; i < b.length; i++) {
            o.write(b[i]);
            if ((b[i] & 0xff) == 0xFF && i + 1 < b.length && b[i + 1] == 0) i++;
        }
        return o.toByteArray();
    }

    private static byte[] readAt(FileChannel c, long pos, int len) throws IOException {
        ByteBuffer bb = ByteBuffer.allocate(len);
        while (bb.hasRemaining()) {
            int r = c.read(bb, pos + bb.position());
            if (r < 0) break;
        }
        return bb.position() == len ? bb.array() : Arrays.copyOf(bb.array(), bb.position());
    }

    private static void writeAt(FileChannel c, long pos, byte[] data) throws IOException {
        ByteBuffer bb = ByteBuffer.wrap(data);
        while (bb.hasRemaining()) c.write(bb, pos + bb.position());
    }

    private static int syncsafe(byte[] b, int o) {
        return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
    }

    private static int int32(byte[] b, int o) {
        return ((b[o] & 0xff) << 24) | ((b[o + 1] & 0xff) << 16) | ((b[o + 2] & 0xff) << 8) | (b[o + 3] & 0xff);
    }

    private static void putSyncsafe(byte[] b, int o, int v) {
        b[o] = (byte) ((v >> 21) & 0x7f);
        b[o + 1] = (byte) ((v >> 14) & 0x7f);
        b[o + 2] = (byte) ((v >> 7) & 0x7f);
        b[o + 3] = (byte) (v & 0x7f);
    }

    private static void putInt32(byte[] b, int o, int v) {
        b[o] = (byte) (v >>> 24);
        b[o + 1] = (byte) (v >>> 16);
        b[o + 2] = (byte) (v >>> 8);
        b[o + 3] = (byte) v;
    }
}
