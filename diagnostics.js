(function(){
  const VERSION='1.4.65', BUILD='1465';
  const KEY='radios_viferor_error_log_v1';
  function read(){try{const x=JSON.parse(localStorage.getItem(KEY)||'[]');return Array.isArray(x)?x:[]}catch{return[]}}
  function write(a){try{localStorage.setItem(KEY,JSON.stringify(a.slice(-100)))}catch{}}
  function add(type,message,source,extra){const a=read();a.push({time:new Date().toISOString(),type,message:String(message||''),source:source||'',extra:extra||'',version:VERSION});write(a)}
  window.logError=(type,message,source,extra)=>add(type,message,source,extra);
  window.addEventListener('error',e=>add('error',e.message||'Error desconocido',e.filename?`${e.filename}:${e.lineno||0}:${e.colno||0}`:''));
  window.addEventListener('unhandledrejection',e=>add('unhandledrejection',e.reason?.stack||e.reason?.message||String(e.reason||'Promise rechazada')));
  const nativeFetch=window.fetch;
  window.fetch=function(...args){return nativeFetch.apply(this,args).then(r=>{if(!r.ok)add('http',`HTTP ${r.status} ${r.statusText}`,String(args[0]||''));return r}).catch(e=>{add('fetch',e.message||String(e),String(args[0]||''));throw e})};
  function render(){const pre=document.getElementById('errorLogContent');if(!pre)return;const a=read();pre.textContent=a.length?a.map(x=>`[${x.time}] ${x.type.toUpperCase()} | ${x.message}${x.source?' | '+x.source:''}${x.extra?' | '+x.extra:''}`).join('\n'):'Sin errores registrados.'}
  function open(){render();document.getElementById('errorModal').hidden=false}
  function close(){document.getElementById('errorModal').hidden=true}
  function applyUpdate(){
    const url=new URL(window.location.href);url.searchParams.set('_refresh',Date.now().toString());
    try{if(window.Android&&typeof window.Android.reloadApp==='function'){window.Android.reloadApp(url.toString());return}}catch(e){add('update',e.message||String(e),'Android.reloadApp')}
    window.location.replace(url.toString());
  }
  async function updates(){
    const modal=document.getElementById('updateModal'),out=document.getElementById('updateStatus'),apply=document.getElementById('btnApplyUpdate');
    modal.hidden=false;out.textContent='Comprobando versión…';if(apply)apply.hidden=true;
    try{
      const r=await nativeFetch('/api/version?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();
      if(d.version===VERSION && String(d.build)===BUILD){out.textContent=`Estás al día. Versión ${d.version} · Compilación ${d.build}.`}
      else {out.textContent=`Hay una versión nueva: ${d.version} · Compilación ${d.build}. Pulsa «Aplicar actualización» para cargarla sin borrar la caché manualmente.`;if(apply)apply.hidden=false}
    }catch(e){out.textContent='No se pudo comprobar la actualización. Revisa la conexión.';add('update',e.message||String(e))}
  }
  window.addEventListener('DOMContentLoaded',()=>{
    const menu=document.getElementById('settingsMenu'),btn=document.getElementById('btnMenuSettings');
    btn?.addEventListener('click',e=>{e.stopPropagation();menu.hidden=!menu.hidden});
    document.addEventListener('click',e=>{if(menu&&!menu.hidden&&!menu.contains(e.target)&&e.target!==btn)menu.hidden=true});
    document.getElementById('btnErrorLog')?.addEventListener('click',()=>{menu.hidden=true;open()});
    document.getElementById('btnCloseErrorLog')?.addEventListener('click',close);
    document.getElementById('btnCopyErrorLog')?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(document.getElementById('errorLogContent').textContent);alert('Registro copiado.')}catch{alert('No se pudo copiar el registro.')}});
    document.getElementById('btnExportErrorLog')?.addEventListener('click',async()=>{
      const name='radios-viferor-registro-errores-'+new Date().toISOString().slice(0,10)+'.txt';
      const content=document.getElementById('errorLogContent').textContent||'';
      if(window.Android&&typeof window.Android.saveTextFile==='function'){
        try{window.Android.saveTextFile(name,content,'text/plain');return;}catch(e){add('export',e.message||String(e),'Android.saveTextFile');}
      }
      if(window.showSaveFilePicker){
        try{
          const h=await window.showSaveFilePicker({suggestedName:name,types:[{description:'Registro de errores',accept:{'text/plain':['.txt']}}]});
          const w=await h.createWritable();await w.write(content);await w.close();return;
        }catch(e){if(e?.name==='AbortError')return;add('export',e.message||String(e),'showSaveFilePicker');}
      }
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:'text/plain'}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
    });
    document.getElementById('btnClearErrorLog')?.addEventListener('click',()=>{localStorage.removeItem(KEY);render()});
    document.getElementById('btnCheckUpdates')?.addEventListener('click',()=>{menu.hidden=true;updates()});
    document.getElementById('btnApplyUpdate')?.addEventListener('click',()=>{document.getElementById('updateModal').hidden=true;applyUpdate()});
    document.getElementById('btnCloseUpdate')?.addEventListener('click',()=>document.getElementById('updateModal').hidden=true);
    document.getElementById('btnImportPodcasts')?.addEventListener('click',()=>{menu.hidden=true;document.getElementById('podcastFile')?.click()});
    document.getElementById('btnExportPodcasts')?.addEventListener('click',()=>{menu.hidden=true;window.exportPodcastOPML?.()});
    const themeBtn=document.getElementById('btnDarkMode');
    function applyTheme(dark){ document.documentElement.classList.toggle('dark-mode',dark); try{localStorage.setItem('radios_viferor_theme',dark?'dark':'light')}catch{}; if(themeBtn)themeBtn.textContent=dark?'☀️ Modo claro':'🌙 Modo oscuro'; const meta=document.querySelector('meta[name=theme-color]'); if(meta)meta.setAttribute('content',dark?'#121426':'#d32f2f'); }
    const dark=(()=>{try{return localStorage.getItem('radios_viferor_theme')==='dark'}catch{return false}})();
    applyTheme(dark);
    themeBtn?.addEventListener('click',()=>{menu.hidden=true;applyTheme(!document.documentElement.classList.contains('dark-mode'))});
    const notifBtn=document.getElementById('btnNotifications');
    function notificationStatusText(enabled){
      if(!notifBtn)return;
      notifBtn.textContent=enabled?'🔔 Notificaciones: activadas':'🔕 Notificaciones: bloqueadas';
    }
    function notificationStatus(){
      try{
        if(window.Android&&typeof window.Android.areNotificationsEnabled==='function'){
          notificationStatusText(!!window.Android.areNotificationsEnabled());
          return;
        }
      }catch(e){add('notifications',e.message||String(e),'Android.areNotificationsEnabled')}
      notificationStatusText(false);
    }
    window.onAndroidNotificationPermissionResult=function(granted){
      notificationStatusText(!!granted);
      if(granted) alert('Notificaciones activadas en Android.');
      else alert('Las notificaciones están bloqueadas. Puedes activarlas desde Ajustes de Android.');
    };
    notifBtn?.addEventListener('click',()=>{
      menu.hidden=true;
      try{
        if(window.Android&&typeof window.Android.requestNotificationPermission==='function'){
          window.Android.requestNotificationPermission();
        }else if(window.Android&&typeof window.Android.openNotificationSettings==='function'){
          window.Android.openNotificationSettings();
        }else{
          alert('Esta opción requiere la aplicación Android.');
        }
      }catch(e){add('notifications',e.message||String(e),'Android.requestNotificationPermission');alert('No se pudo abrir la configuración de notificaciones.');}
    });
    notificationStatus();
    const v=document.getElementById('appVersionText'),b=document.getElementById('appBuildText');if(v)v.textContent=VERSION;if(b)b.textContent=BUILD;
  });
})();
