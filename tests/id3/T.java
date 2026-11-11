package com.viferor.radioespana;
import java.io.*; import java.nio.channels.FileChannel; import java.util.*;
public class T {
  public static void main(String[] a) throws Exception {
    // a[0]=file a[1]=mode(one|two) then key=value pairs
    Map<String,String> v = new LinkedHashMap<>();
    for (int i = 2; i < a.length; i++) { int e = a[i].indexOf('='); v.put(a[i].substring(0,e), a[i].substring(e+1)); }
    try (RandomAccessFile raf = new RandomAccessFile(a[0], "rw")) {
      if (a[1].equals("one")) { FileChannel c = raf.getChannel(); Id3Editor.write(c, c, v, new File(".")); }
      else { FileDescriptor fd = raf.getFD(); FileChannel in = new FileInputStream(fd).getChannel(); FileChannel out = new FileOutputStream(fd).getChannel(); Id3Editor.write(in, out, v, new File(".")); }
    }
  }
}
