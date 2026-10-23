(function () {
  const VERSION = window.RV_VERSION?.version || '0',
    BUILD = String(window.RV_VERSION?.build || '0');
  const KEY = 'radios_viferor_error_log_v1';
  function read() {
    try {
      const x = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(x) ? x : [];
    } catch {
      return [];
    }
  }
  function write(a) {
    try {
      localStorage.setItem(KEY, JSON.stringify(a.slice(-100)));
    } catch {}
  }
  function add(type, message, source, extra) {
    const a = read();
    // El mismo error seguido no ocupa varias líneas (si no, uno repetido borra los demás).
    const last = a[a.length - 1];
    if (last && last.type === type && last.message === String(message || '') && last.source === (source || '')) {
      last.count = (last.count || 1) + 1;
      last.last = new Date().toISOString();
      if (extra) last.extra = extra;
      return write(a);
    }
    a.push({
      time: new Date().toISOString(),
      type,
      message: String(message || ''),
      source: source || '',
      extra: extra || '',
      version: VERSION
    });
    write(a);
  }
  window.logError = (type, message, source, extra) => add(type, message, source, extra);
  window.addEventListener('error', e =>
    add(
      'error',
      e.message || 'Error desconocido',
      e.filename ? `${e.filename}:${e.lineno || 0}:${e.colno || 0}` : ''
    )
  );
  // Errores de los reproductores (no suben como los demás: se recogen en captura).
  const MEDIA_ERR = { 1: 'cancelado', 2: 'red', 3: 'decodificación', 4: 'formato no soportado' };
  window.addEventListener(
    'error',
    e => {
      const el = e.target;
      if (!el || !/^(AUDIO|VIDEO)$/.test(el.tagName || '')) return;
      const code = el.error?.code || 0;
      const src = String(el.currentSrc || el.src || '').replace(/\?.*$/, '').slice(0, 160);
      add('media', `${el.id || 'audio'}: error ${code} (${MEDIA_ERR[code] || 'desconocido'})${el.error?.message ? ' · ' + el.error.message : ''}`, src, `t=${(el.currentTime || 0).toFixed(1)} rs=${el.readyState} ns=${el.networkState}`);
    },
    true
  );
  window.addEventListener('unhandledrejection', e =>
    add('unhandledrejection', e.reason?.stack || e.reason?.message || String(e.reason || 'Promise rechazada'))
  );
  const nativeFetch = window.fetch;
  window.fetch = function (...args) {
    return nativeFetch
      .apply(this, args)
      .then(r => {
        if (!r.ok) add('http', `HTTP ${r.status} ${r.statusText}`, String(args[0] || ''));
        return r;
      })
      .catch(e => {
        add('fetch', e.message || String(e), String(args[0] || ''));
        throw e;
      });
  };
  function render() {
    const pre = document.getElementById('errorLogContent');
    if (!pre) return;
    const a = read();
    pre.textContent = a.length
      ? a
          .map(
            x =>
              `[${x.time}] ${x.type.toUpperCase()} | ${x.message}${x.count > 1 ? ` (×${x.count}, última ${x.last})` : ''}${x.source ? ' | ' + x.source : ''}${x.extra ? ' | ' + x.extra : ''}`
          )
          .join('\n')
      : 'Sin errores registrados.';
  }
  function open() {
    render();
    document.getElementById('errorModal').hidden = false;
  }
  function close() {
    document.getElementById('errorModal').hidden = true;
  }
  function applyUpdate() {
    const url = new URL(window.location.href);
    url.searchParams.set('_refresh', Date.now().toString());
    try {
      if (window.Android && typeof window.Android.reloadApp === 'function') {
        window.Android.reloadApp(url.toString());
        return;
      }
    } catch (e) {
      add('update', e.message || String(e), 'Android.reloadApp');
    }
    window.location.replace(url.toString());
  }
  async function updates() {
    const modal = document.getElementById('updateModal'),
      out = document.getElementById('updateStatus'),
      apply = document.getElementById('btnApplyUpdate');
    modal.hidden = false;
    out.textContent = 'Comprobando versión…';
    if (apply) apply.hidden = true;
    try {
      // Se compara la versión que está ejecutándose con el version.js publicado.
      const r = await nativeFetch('/version.js?ts=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const txt = await r.text();
      const d = {
        version: (txt.match(/version:\s*'([^']+)'/) || [])[1] || '',
        build: (txt.match(/build:\s*'([^']+)'/) || [])[1] || ''
      };
      if (!d.version || !d.build) throw new Error('version.js no válido');
      if (d.version === VERSION && String(d.build) === BUILD) {
        out.textContent = `Estás al día. Versión ${d.version} · Compilación ${d.build}.`;
      } else {
        out.textContent = `Hay una versión nueva: ${d.version} · Compilación ${d.build} (tienes ${VERSION} · ${BUILD}). Pulsa «Aplicar actualización» para cargarla.`;
        if (apply) apply.hidden = false;
      }
    } catch (e) {
      out.textContent = 'No se pudo comprobar la actualización. Revisa la conexión.';
      add('update', e.message || String(e));
    }
  }
  window.addEventListener('DOMContentLoaded', () => {
    const menu = document.getElementById('settingsMenu'),
      btn = document.getElementById('btnMenuSettings');
    btn?.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', e => {
      if (menu && !menu.hidden && !menu.contains(e.target) && e.target !== btn) menu.hidden = true;
    });
    document.getElementById('btnErrorLog')?.addEventListener('click', () => {
      menu.hidden = true;
      open();
    });
    document.getElementById('btnCloseErrorLog')?.addEventListener('click', close);
    document.getElementById('btnCopyErrorLog')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(document.getElementById('errorLogContent').textContent);
        alert('Registro copiado.');
      } catch {
        alert('No se pudo copiar el registro.');
      }
    });
    document.getElementById('btnExportErrorLog')?.addEventListener('click', async () => {
      const name = 'radios-viferor-registro-errores-' + new Date().toISOString().slice(0, 10) + '.txt';
      const content = document.getElementById('errorLogContent').textContent || '';
      if (window.Android && typeof window.Android.saveTextFile === 'function') {
        try {
          window.Android.saveTextFile(name, content, 'text/plain');
          return;
        } catch (e) {
          add('export', e.message || String(e), 'Android.saveTextFile');
        }
      }
      if (window.showSaveFilePicker) {
        try {
          const h = await window.showSaveFilePicker({
            suggestedName: name,
            types: [{ description: 'Registro de errores', accept: { 'text/plain': ['.txt'] } }]
          });
          const w = await h.createWritable();
          await w.write(content);
          await w.close();
          return;
        } catch (e) {
          if (e?.name === 'AbortError') return;
          add('export', e.message || String(e), 'showSaveFilePicker');
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    document.getElementById('btnClearErrorLog')?.addEventListener('click', () => {
      localStorage.removeItem(KEY);
      render();
    });
    document.getElementById('btnCheckUpdates')?.addEventListener('click', () => {
      menu.hidden = true;
      updates();
    });
    document.getElementById('btnApplyUpdate')?.addEventListener('click', () => {
      document.getElementById('updateModal').hidden = true;
      applyUpdate();
    });
    document
      .getElementById('btnCloseUpdate')
      ?.addEventListener('click', () => (document.getElementById('updateModal').hidden = true));
    document.getElementById('btnImportPodcasts')?.addEventListener('click', () => {
      menu.hidden = true;
      document.getElementById('podcastFile')?.click();
    });
    document.getElementById('btnExportPodcasts')?.addEventListener('click', () => {
      menu.hidden = true;
      window.exportPodcastOPML?.();
    });
    const themeBtn = document.getElementById('btnDarkMode');
    function applyTheme(dark) {
      document.documentElement.classList.toggle('dark-mode', dark);
      try {
        localStorage.setItem('radios_viferor_theme', dark ? 'dark' : 'light');
      } catch {}
      if (themeBtn) themeBtn.textContent = dark ? '☀️ Modo claro' : '🌙 Modo oscuro';
      const meta = document.querySelector('meta[name=theme-color]');
      if (meta) meta.setAttribute('content', dark ? '#121426' : '#d32f2f');
    }
    const dark = (() => {
      try {
        return localStorage.getItem('radios_viferor_theme') === 'dark';
      } catch {
        return false;
      }
    })();
    applyTheme(dark);
    themeBtn?.addEventListener('click', () => {
      menu.hidden = true;
      applyTheme(!document.documentElement.classList.contains('dark-mode'));
    });
    const notifBtn = document.getElementById('btnNotifications');
    function notificationStatusText(enabled) {
      if (!notifBtn) return;
      notifBtn.textContent = enabled ? '🔔 Notificaciones: activadas' : '🔕 Notificaciones: bloqueadas';
    }
    function notificationStatus() {
      try {
        if (window.Android && typeof window.Android.areNotificationsEnabled === 'function') {
          notificationStatusText(!!window.Android.areNotificationsEnabled());
          return;
        }
      } catch (e) {
        add('notifications', e.message || String(e), 'Android.areNotificationsEnabled');
      }
      notificationStatusText(false);
    }
    window.onAndroidNotificationPermissionResult = function (granted) {
      notificationStatusText(!!granted);
      if (granted) alert('Notificaciones activadas en Android.');
      else alert('Las notificaciones están bloqueadas. Puedes activarlas desde Ajustes de Android.');
    };
    notifBtn?.addEventListener('click', () => {
      menu.hidden = true;
      try {
        if (window.Android && typeof window.Android.requestNotificationPermission === 'function') {
          window.Android.requestNotificationPermission();
        } else if (window.Android && typeof window.Android.openNotificationSettings === 'function') {
          window.Android.openNotificationSettings();
        } else {
          alert('Esta opción requiere la aplicación Android.');
        }
      } catch (e) {
        add('notifications', e.message || String(e), 'Android.requestNotificationPermission');
        alert('No se pudo abrir la configuración de notificaciones.');
      }
    });
    notificationStatus();
    const resumeBtn = document.getElementById('btnAutoResume');
    const resumeText = () => {
      if (!resumeBtn) return;
      let on = false;
      try {
        on = localStorage.getItem('radios_viferor_autoresume') === '1';
      } catch {}
      resumeBtn.textContent = on ? '▶️ Reanudar al abrir: sí' : '⏸️ Reanudar al abrir: no';
    };
    resumeText();
    resumeBtn?.addEventListener('click', () => {
      try {
        const on = localStorage.getItem('radios_viferor_autoresume') === '1';
        localStorage.setItem('radios_viferor_autoresume', on ? '0' : '1');
      } catch {}
      resumeText();
    });
    // Tras una llamada o un aviso corto, la radio, el podcast o la música vuelven a sonar solos.
    const afterBtn = document.getElementById('btnResumeAfter');
    const afterText = () => {
      if (!afterBtn) return;
      let on = true;
      try {
        on = localStorage.getItem('radios_viferor_resume_after_interrupt') !== '0';
      } catch {}
      afterBtn.textContent = on ? '🔁 Volver a sonar tras una llamada o aviso: sí' : '⏹️ Volver a sonar tras una llamada o aviso: no';
    };
    afterText();
    afterBtn?.addEventListener('click', () => {
      try {
        const on = localStorage.getItem('radios_viferor_resume_after_interrupt') !== '0';
        localStorage.setItem('radios_viferor_resume_after_interrupt', on ? '0' : '1');
      } catch {}
      afterText();
    });
    const v = document.getElementById('appVersionText'),
      b = document.getElementById('appBuildText');
    if (v) v.textContent = VERSION;
    if (b) b.textContent = BUILD;
    // Versión del APK instalado: la pone el propio APK en el user-agent
    // («RadiosViferor/1.16.0»). Importa: las mejoras de lectura de música van en el APK
    // 1.16.0 y sin él los cortes se arreglan a medias (la web no puede leer los archivos).
    const apk = (String(navigator.userAgent || '').match(/RadiosViferor\/([\d.]+)/) || [])[1] || '';
    if (apk) {
      const wrap = document.getElementById('appApkWrap'),
        el = document.getElementById('appApkText');
      const num = s => String(s).split('.').map(x => Number(x) || 0);
      const [a1 = 0, a2 = 0, a3 = 0] = num(apk),
        [m1, m2, m3] = num('1.16.0');
      const vieja = a1 < m1 || (a1 === m1 && (a2 < m2 || (a2 === m2 && a3 < m3)));
      if (el) el.textContent = apk + (vieja ? ' ⚠️' : '');
      if (wrap) {
        wrap.hidden = false;
        wrap.title = vieja
          ? 'Tu APK es anterior al 1.16.0: instálalo para que la música no se corte al leer los archivos.'
          : 'Versión de la aplicación Android instalada.';
      }
      window.rvAnotar?.(`App Android ${apk} · web ${VERSION} (${BUILD})`, vieja ? 'APK anterior al 1.16.0: instala el nuevo' : '');
    } else if (window.rvAnotar) {
      window.rvAnotar(`Navegador · web ${VERSION} (${BUILD})`, '');
    }
  });
})();
