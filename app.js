const APP_VERSION = '1.5.0';
const APP_BUILD = '1500';
const STORAGE_KEY = 'mis_radios_favoritas_v1';
const LOGO_CACHE_KEY = 'radio_espana_logos_v1';
const GLOBAL_SOURCES = {
  'cadena ser': { logo:'https://graph.facebook.com/cadenaser/picture?width=200&height=200', options:[
    ['mp3','https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASER.mp3'],
    ['aac','https://playerservices.streamtheworld.com/api/livestream-redirect/CADENASERAAC.aac'] ]},
  'cope': { logo:'https://graph.facebook.com/COPE/picture?width=200&height=200', options:[
    ['mp3','https://flucast09-h-cloud.flumotion.com/cope/net1.mp3'],['aac','https://flucast09-h-cloud.flumotion.com/cope/net1.aac'],['mp3','https://flucast31-h-cloud.flumotion.com/cope/net2.mp3'] ]},
  'onda cero': { logo:'https://graph.facebook.com/ondacero/picture?width=200&height=200', options:[
    ['aac','https://radio-atres-live.ondacero.es/api/livestream-redirect/OCAAC.aac'],['m3u8','https://atres-live.ondacero.es/live/ondaceroeventos1/master.m3u8'] ]},
  'rne': { logo:'https://graph.facebook.com/radionacionalrne/picture?width=200&height=200', options:[['m3u8','https://rtvelivestream.rtve.es/rtvesec/rne/rne_r1_main.m3u8']]},
  'los40': { logo:'https://graph.facebook.com/los40/picture?width=200&height=200', options:[['mp3','https://playerservices.streamtheworld.com/api/livestream-redirect/Los40.mp3'],['aac','https://playerservices.streamtheworld.com/api/livestream-redirect/LOS40AAC.aac']]},
  'cadena dial': { logo:'https://graph.facebook.com/cadenadial/picture?width=200&height=200', options:[['mp3','https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIAL.mp3'],['aac','https://playerservices.streamtheworld.com/api/livestream-redirect/CADENADIALAAC.aac']]},
  'rock fm': { logo:'https://graph.facebook.com/RockFM/picture?width=200&height=200', options:[['m3u8','https://rockfm-cope.flumotion.com/playlist.m3u8']]},
  'kiss fm': { logo:'https://graph.facebook.com/kissfm.es/picture?width=200&height=200', options:[['mp3','https://kissfm.kissfmradio.cires21.com/kissfm.mp3']]},
  'europa fm': { logo:'https://graph.facebook.com/tueuropafm/picture?width=200&height=200', options:[['aac','https://radio-atres-live.ondacero.es/api/livestream-redirect/EFMAAC.aac']]},
  'canal sur': { logo:'https://graph.facebook.com/CanalSurRadioAndalucia/picture?width=200&height=200', options:[['mp3','https://rtva-live-radio.flumotion.com/rtva/csr.mp3']]},
  'radio marca': { logo:'https://graph.facebook.com/RadioMARCA/picture?width=200&height=200', options:[['mp3','https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONAL.mp3'],['aac','https://playerservices.streamtheworld.com/api/livestream-redirect/RADIOMARCA_NACIONALAAC.aac']]}
};
const TYPE_PATTERNS = {
 musical:['los40','los 40','40 principales','dial','cadena dial','rock fm','kiss fm','europa fm','m80','melodía','melodia','happy fm','radio 3','radio clásica','radio clasica','hit fm','maxima fm','máxima fm','radiolé','radiole','flamenco radio','gaztea','rac 105'],
 informativa:['cadena ser',' ser ','cope','onda cero','rne','radio nacional','radio 1','radio 5','radio exterior','hoy por hoy','hora 25','herrera en cope','más de uno','es la mañana','intereconomía','radio voz','generalista','informativa','noticias'],
 deportiva:['radio marca','marca ','deporte','deportes','esport','tiempo de juego','partido de las 12','al primer toque','taller deportivo','carrusel deportivo','ser deportes','cope deportes','radio deportiva','futbol','fútbol','sport','depor'],
 autonomica:['catalunya ràdio','catalunya radio','rac1','rac 1','radio euskadi','euskadi irratia','gaztea','eitb','radio galega','aragón radio','aragon radio','ib3','onda madrid','à punt','apunt','radio canarias','rtvc','canal sur','rva','radio asturias','rpa','cyl radio','radio la rioja','radio navarra'],
 tematica:['jazz','flamenco','clásica','clasica','cultural','religión','religion','radio maria','chillout','lounge','ibiza','café del mar','cafe del mar','indie','electrónica','electronica','house','techno','reggaeton','latina','tropical','salsa','bachata','rumba']
};
const NETWORK_PATTERNS = {'cadena ser':['ser','cadena ser'],'cope':['cope'],'onda cero':['onda cero'],'rne':['rne','radio nacional','rtve','radio 1','radio 3','radio 5'],'los40':['los40','los 40','40 principales'],'cadena dial':['dial','cadena dial','cadenadial'],'rock fm':['rock fm'],'kiss fm':['kiss fm'],'europa fm':['europa fm'],'canal sur':['canal sur','rva'],'radio marca':['radio marca','marca']};
let stations=[]; let loadedStations=[]; let catalogPromise=null; let favorites=[]; let currentStation=null; let currentView='fav'; let requestSeq=0; let hls=null; let metadataTimer=null; let programTimer=null; let logoCache={}; let currentStreamUrl=''; let previousVolume=.8; let reconnectTimer=null; let reconnectAttempts=0;
const favGrid=document.getElementById('favGrid'), stationsGrid=document.getElementById('stationsGrid'), audio=document.getElementById('audioPlayer'), currentNameEl=document.getElementById('currentStationName'), statusEl=document.getElementById('playerStatus'), nowPlayingEl=document.getElementById('nowPlayingTrack'), programNowEl=document.getElementById('programNow'), programNextEl=document.getElementById('programNext'), favCountEl=document.getElementById('favCount'), activeFiltersEl=document.getElementById('activeFilters');
function normalizar(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();}
function slug(v){return normalizar(v).replace(/[^a-z0-9]+/g,' ');}
function escapeHtml(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function coincide(texto,patrones){const t=normalizar(texto);return patrones.some(p=>t.includes(normalizar(p)));}
function networkKey(s){const t=normalizar((s.network||'')+' '+(s.name||'')+' '+(s.tags||''));for(const [k,ps] of Object.entries(NETWORK_PATTERNS))if(coincide(t,ps))return k;return '';}
function detectarCadena(s){const k=networkKey(s);const names={'cadena ser':['chain-ser','SER'],'cope':['chain-cope','COPE'],'onda cero':['chain-ondacero','ONDA CERO'],'rne':['chain-rne','RNE'],'los40':['chain-los40','LOS40'],'cadena dial':['chain-dial','DIAL'],'rock fm':['chain-rockfm','ROCK FM'],'kiss fm':['chain-kissfm','KISS FM'],'europa fm':['chain-europafm','EUROPA FM'],'canal sur':['chain-canalsur','CANAL SUR'],'radio marca':['chain-marca','MARCA']};return names[k]||['chain-default',(s.name||'RADIO').split(/\s+/).filter(Boolean).slice(0,3).map(x=>x[0]).join('').toUpperCase()||'RADIO'];}
function logoFor(s){if(s.logo)return s.logo;if(s.favicon)return s.favicon;const k=networkKey(s);return GLOBAL_SOURCES[k]?.logo||'';}
function construirLogo(s){const [clase,texto]=detectarCadena(s);const logo=logoFor(s);const safeLogo=logo?escapeHtml(logo):'';return `<div class="chain-logo ${clase}">${safeLogo?`<img src="${safeLogo}" alt="Logo ${escapeHtml(s.name)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.classList.add('logo-fallback')">`:''}<span class="logo-fallback-text">${escapeHtml(texto)}</span></div>`;}
function obtenerFiltros(){return {network:document.getElementById('selectNetwork').value.trim(),location:document.getElementById('selectLocation').value.trim(),type:document.getElementById('selectType').value.trim(),text:document.getElementById('textSearch').value.trim()};}
function actualizarChips(){const f=obtenerFiltros(),chips=[];if(f.type)chips.push(`<span class="chip-label">Tipo:</span><span class="chip">${escapeHtml(f.type)}</span>`);if(f.network)chips.push(`<span class="chip-label">Cadena:</span><span class="chip">${escapeHtml(f.network)}</span>`);if(f.location)chips.push(`<span class="chip-label">Prov:</span><span class="chip">${escapeHtml(f.location)}</span>`);if(f.text)chips.push(`<span class="chip-label">Nom:</span><span class="chip">${escapeHtml(f.text)}</span>`);activeFiltersEl.hidden=!chips.length;activeFiltersEl.innerHTML=chips.join('');}
function filtrarLocal(f){return stations.filter(s=>{const tc=(s.name||'')+' '+(s.network||'')+' '+(s.tags||'');if(f.type&&!coincide(tc,TYPE_PATTERNS[f.type]||[]))return false;if(f.network&&!coincide(tc,NETWORK_PATTERNS[normalizar(f.network)]||[]))return false;if(f.location&&!normalizar(s.state||'').includes(normalizar(f.location)))return false;if(f.text&&!normalizar((s.name||'')+' '+(s.city||'')+' '+(s.network||'')).includes(normalizar(f.text)))return false;return true;});}
function setStatus(t){stationsGrid.innerHTML=`<div class="status-msg">${t}</div>`;}
async function aplicarFiltros(){const seq=++requestSeq;const f=obtenerFiltros();actualizarChips();setStatus('Buscando... ⏳');await Promise.resolve();if(seq!==requestSeq)return;loadedStations=filtrarLocal(f);if(seq!==requestSeq)return;if(!loadedStations.length){setStatus('⚠️ No se encontraron emisoras.<br><small>Prueba a quitar algún filtro.</small>');return;}renderSearch();}
function stationId(s){return String(s?.uuid||s?.stationuuid||'').trim();}
function cardFor(s,i,favMode=false){const sid=stationId(s);const isFav=!!sid&&favorites.some(f=>{const fid=stationId(f);return !!fid&&fid===sid;}),isCur=currentStation&&(currentStation.uuid===s.uuid||currentStation.stationuuid===s.stationuuid);const card=document.createElement('div');card.className='station-card'+(isCur?' playing':'');card.dataset.uuid=s.uuid||s.stationuuid;card.dataset.index=i;card.innerHTML=`${favMode?`<div class="drag-handle">⋮⋮</div>`:''}<button class="fav-btn ${isFav?'is-fav':''}" aria-label="${isFav?'Quitar de favoritas':'Añadir a favoritas'}">★</button>${construirLogo(s)}<div class="station-name">${escapeHtml(s.name)}</div><div class="station-tag">${escapeHtml(s.city||s.state||'España')}</div>`;card.addEventListener('click',()=>reproducirRadio(s));card.querySelector('.fav-btn').addEventListener('click',e=>{e.stopPropagation();toggleFav(s.uuid||s.stationuuid,card);});if(favMode){const h=card.querySelector('.drag-handle');h.ontouchstart=e=>handleTouchStart(e,i,card,favGrid);h.ontouchmove=e=>handleTouchMove(e,favGrid);h.ontouchend=handleTouchEnd;}return card;}
function renderSearch(){const frag=document.createDocumentFragment();loadedStations.forEach((s,i)=>frag.appendChild(cardFor(s,i,false)));stationsGrid.replaceChildren(frag);}
function renderFavoritas(){const frag=document.createDocumentFragment();if(!favorites.length){favGrid.innerHTML='<div class="status-msg big"><div class="empty-icon">⭐</div><h2>Sin favoritas</h2><p>Pulsa "🔍 Buscar" y añade con ★</p></div>';return;}favorites.forEach((s,i)=>frag.appendChild(cardFor(s,i,true)));favGrid.replaceChildren(frag);}
function updatePlayingCards(){document.querySelectorAll('.station-card').forEach(c=>c.classList.toggle('playing',!!currentStation&&(c.dataset.uuid===currentStation.uuid||c.dataset.uuid===currentStation.stationuuid)));}
function toggleFav(id,card){id=String(id||'').trim();if(!id)return;const idx=favorites.findIndex(f=>stationId(f)===id);if(idx>=0){favorites.splice(idx,1);}else{const s=stations.find(x=>stationId(x)===id)||loadedStations.find(x=>stationId(x)===id);if(s)favorites.push({...s});}saveFavorites();const fav=favorites.some(f=>(f.uuid||f.stationuuid)===id);if(card){card.querySelector('.fav-btn')?.classList.toggle('is-fav',fav);card.querySelector('.fav-btn')?.setAttribute('aria-label',fav?'Quitar de favoritas':'Añadir a favoritas');}if(currentView==='fav'&&!fav)renderFavoritas();}
function saveFavorites(){localStorage.setItem(STORAGE_KEY,JSON.stringify(favorites));favCountEl.textContent=favorites.length;}
function loadFavorites(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY)||'[]';
    const x=JSON.parse(raw);
    const list=Array.isArray(x)?x:[];
    const seen=new Set();
    favorites=list.filter(f=>{
      const id=stationId(f);
      if(!id||seen.has(id))return false;
      seen.add(id);
      return true;
    });
    localStorage.setItem(STORAGE_KEY,JSON.stringify(favorites));
  }catch{favorites=[];}
  favCountEl.textContent=favorites.length;
}

function configurarGestoRadiosPodcasts(){
  let sx=0, sy=0, tracking=false;
  const ignorar=(el)=>{
    if(!el) return true;
    return !!el.closest('input,textarea,select,button,a,[contenteditable="true"],.player-bar,.pod-expanded,.dragging,.settings-menu');
  };
  const enMenuPrincipal=()=>{
    const fav=document.getElementById('viewFav'), pods=document.getElementById('viewPodcasts'), search=document.getElementById('viewSearch');
    if(search?.classList.contains('active')) return false;
    if(fav?.classList.contains('active')) return true;
    if(pods?.classList.contains('active')){
      const screen=window.podcastState?.screen;
      return screen==='landing' && !document.body.classList.contains('podcast-detail-active') && !document.body.classList.contains('podcast-results-active') && !document.body.classList.contains('podcast-subs-fullscreen');
    }
    return false;
  };
  document.addEventListener('touchstart',e=>{
    if(e.touches.length!==1 || ignorar(e.target) || !enMenuPrincipal()) { tracking=false; return; }
    const t=e.touches[0]; sx=t.clientX; sy=t.clientY; tracking=true;
  },{passive:true});
  document.addEventListener('touchend',e=>{
    if(!tracking || !e.changedTouches.length) return;
    tracking=false;
    if(!enMenuPrincipal()) return;
    const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
    if(Math.abs(dx)<65 || Math.abs(dx)<Math.abs(dy)*1.25) return;
    const pods=document.getElementById('viewPodcasts');
    if(dx<0){
      if(pods?.classList.contains('active') && typeof window.switchToRadios==='function') window.switchToRadios();
    }else{
      if(!pods?.classList.contains('active') && typeof window.switchToPodcasts==='function') window.switchToPodcasts();
    }
  },{passive:true});
}

function cambiarVista(v){currentView=v;if(v==='fav'||v==='search'){document.body.classList.remove('podcasts-active','podcast-detail-active','podcast-subs-fullscreen','podcast-results-active');}const fav=document.getElementById('viewFav'),search=document.getElementById('viewSearch');fav?.classList.toggle('active',v==='fav');search?.classList.toggle('active',v==='search');document.getElementById('btnViewRadios')?.classList.toggle('active',v==='fav'||v==='search');if(v==='fav')renderFavoritas();else if(loadedStations.length)renderSearch();else aplicarFiltros();}
function fuentesLocales(s){const out=[];if(Array.isArray(s.options))s.options.forEach(o=>out.push(o));if(s.url_resolved)out.push({format:'stream',url:s.url_resolved});if(s.url)out.push({format:'stream',url:s.url});const k=networkKey(s);(GLOBAL_SOURCES[k]?.options||[]).forEach(([format,url])=>out.push({format,url}));const seen=new Set();return out.filter(o=>o?.url&&/^https?:\/\//i.test(o.url)&&!seen.has(o.url)&&seen.add(o.url));}
async function resolveRemote(s){try{const p=new URLSearchParams({name:s.name,state:s.state||'',network:s.network||networkKey(s)});const r=await fetch('/api/resolve?'+p.toString(),{cache:'no-store'});if(!r.ok)return null;const d=await r.json();return d.station||null;}catch{return null;}}
function esHls(u){return /\.m3u8(?:$|\?)/i.test(u);}
function clearHls(){if(hls){try{hls.destroy();}catch{}hls=null;}}
function waitForAudio(timeout=8000){return new Promise((resolve,reject)=>{let done=false;const finish=(ok,e)=>{if(done)return;done=true;clearTimeout(timer);audio.removeEventListener('playing',onPlaying);audio.removeEventListener('error',onError);ok?resolve():reject(e||new Error('audio error'));};const onPlaying=()=>finish(true);const onError=e=>finish(false,e);const timer=setTimeout(()=>finish(false,new Error('timeout')),timeout);audio.addEventListener('playing',onPlaying,{once:true});audio.addEventListener('error',onError,{once:true});});}
async function intentarFuente(source){clearHls();audio.pause();audio.removeAttribute('src');audio.load();const url=source.url;if(esHls(url)&&window.Hls&&Hls.isSupported()){return new Promise((resolve,reject)=>{hls=new Hls({enableWorker:true});hls.on(Hls.Events.ERROR,(_,data)=>{if(data.fatal)reject(new Error(data.details||'HLS fatal error'));});hls.on(Hls.Events.MANIFEST_PARSED,async()=>{try{const ready=waitForAudio(8000);await audio.play();await ready;resolve();}catch(e){reject(e);}});hls.loadSource(url);hls.attachMedia(audio);});}audio.src=url;audio.load();const ready=waitForAudio(8000);await audio.play();await ready;}
async function reproducirRadio(s){clearTimeout(reconnectTimer);reconnectAttempts=0;const podcastAudio=document.getElementById('podcastAudio');if(podcastAudio&&!podcastAudio.paused){try{podcastAudio.pause();}catch{}}currentStation=s;updatePlayingCards();currentNameEl.textContent=s.name;statusEl.textContent='Conectando... ⏳';actualizarCancion('🎵 Buscando información…');actualizarPrograma(null,null);clearInterval(metadataTimer);clearInterval(programTimer);currentStreamUrl='';let fuentes=Array.isArray(s.options)?fuentesLocales(s):[];if(!fuentes.length || !s.url){statusEl.textContent='Buscando stream... ⏳';const remote=await resolveRemote(s);if(remote){if(remote.logo)s.logo=remote.logo;if(remote.web)s.web=remote.web;if(remote.epg_id)s.epg_id=remote.epg_id;if(remote.stationuuid)s.stationuuid=remote.stationuuid;s.options=remote.options||[];fuentes=fuentesLocales(s);if(remote.source==='radio-browser'&&remote.name)s.remoteName=remote.name;}else{fuentes=fuentesLocales(s);} }if(!fuentes.length){statusEl.textContent='❌ Sin stream disponible';actualizarCancion('🎵 Emisión no disponible');return;}let last=null;for(const f of fuentes){try{statusEl.textContent=`Conectando… ${String(f.format||'stream').toUpperCase()}`;await intentarFuente(f);currentStreamUrl=f.url;reconnectAttempts=0;try{window.Android?.setPlaybackSection?.('radio');window.__radioMediaStarted=false;window.Android?.startRadioMedia?.(s.name||'Radio',nowPlayingEl?.textContent||'🎵 En directo',s.logo||'',true);}catch{};localStorage.setItem('radio_resume_state',JSON.stringify({station:s,streamUrl:f.url,playing:true,at:Date.now()}));
      localStorage.setItem('radios_viferor_playback_resume_v1',JSON.stringify({type:'radio',station:s,streamUrl:f.url,playing:true,at:Date.now()}));statusEl.textContent='En directo ✅';actualizarCancion('🎵 En directo');startMetadata(s,f.url);startProgramGuide(s);return;}catch(e){last=e;}}statusEl.textContent='❌ No se pudo reproducir';actualizarCancion('🎵 Ninguna fuente disponible');console.warn('Radio playback failed',s,last);scheduleRadioReconnect();}
async function startMetadata(s,streamUrl){const run=async()=>{let found='';try{const q=new URLSearchParams({url:streamUrl,name:s.name||'',state:s.state||'',stationuuid:s.stationuuid||s.uuid||''});const r=await fetch('/api/metadata?'+q.toString(),{cache:'no-store'});if(r.ok){const d=await r.json();found=d.song||d.title||d.streamTitle||'';if(d.station){if(d.station.logo&&!s.logo)s.logo=d.station.logo;if(d.station.epg_id&&!s.epg_id)s.epg_id=d.station.epg_id;if(d.station.stationuuid&&!s.stationuuid)s.stationuuid=d.station.stationuuid;}}}catch{}if(!found&&s.stationuuid){try{const r=await fetch('https://de1.api.radio-browser.info/json/stations/byuuid/'+encodeURIComponent(s.stationuuid),{cache:'no-store'});const d=await r.json();const x=d?.[0];found=x?.songtitle||x?.streamtitle||x?.title||'';}catch{}}actualizarCancion(found?'🎵 '+found:'🎵 En directo');};run();metadataTimer=setInterval(run,12000);}
async function startProgramGuide(s){const run=async()=>{try{const q=new URLSearchParams({name:s.name||'',epg_id:s.epg_id||''});const r=await fetch('/api/program?'+q.toString(),{cache:'no-store'});if(!r.ok)return;const d=await r.json();actualizarPrograma(d.current,d.next);}catch{}};run();programTimer=setInterval(run,60000);}
function scheduleRadioReconnect(){
  clearTimeout(reconnectTimer);
  if(!currentStation||document.hidden&&false)return;
  const delay=Math.min(30000,1500*Math.pow(2,reconnectAttempts));
  reconnectTimer=setTimeout(async()=>{
    if(!currentStation||!audio.paused)return;
    reconnectAttempts++;
    statusEl.textContent='Reconectando… ⏳';
    try{await reproducirRadio(currentStation);}catch{}
  },delay);
}
function syncRadioAndroidMedia(){try{if(!window.Android||!currentStation||!audio)return;const podcastAudio=document.getElementById('podcastAudio');if(podcastAudio&&!podcastAudio.paused&&!podcastAudio.ended)return;const playing=!audio.paused&&!audio.ended;const station=currentStation.name||'Radio';const track=nowPlayingEl?.textContent||'🎵 En directo';const art=currentStation.logo||'';if(typeof window.Android.startRadioMedia==='function'&&!window.__radioMediaStarted&&playing){window.__radioMediaStarted=true;window.__podMediaStarted=false;window.Android.startRadioMedia(station,track,art,true);}else if(typeof window.Android.updateRadioMedia==='function'){window.Android.updateRadioMedia(station,track,playing);}}catch{}}
window.viferorNativeRadioPlay=()=>{try{if(audio)audio.play().catch(()=>{});}catch{}};
window.viferorNativeRadioPause=()=>{try{if(audio)audio.pause();}catch{}};
function actualizarCancion(t){nowPlayingEl.textContent=t;nowPlayingEl.classList.remove('scrolling');requestAnimationFrame(()=>{if(nowPlayingEl.scrollWidth>nowPlayingEl.parentElement.clientWidth)nowPlayingEl.classList.add('scrolling');});syncRadioAndroidMedia();}
function actualizarPrograma(current,next){if(programNowEl){programNowEl.textContent=current?.title?`📻 ${current.title}`:'📻 Programa actual: sin información';programNowEl.title=current?.description||'';}if(programNextEl){programNextEl.textContent=next?.title?`Siguiente: ${next.title}`:'Siguiente: —';programNextEl.title=next?.description||'';}}
function handleTouchStart(e,i,card,g){e.stopPropagation();card.dataset.dragIndex=i;card.classList.add('dragging');card._dragging=true;}
function handleTouchMove(e,g){const active=g.querySelector('.dragging');if(!active)return;e.preventDefault();const t=e.touches[0],el=document.elementFromPoint(t.clientX,t.clientY)?.closest('.station-card');if(el&&el!==active){const a=+active.dataset.dragIndex,b=+el.dataset.index;if(Number.isInteger(a)&&Number.isInteger(b)&&a!==b){const item=favorites.splice(a,1)[0];favorites.splice(b,0,item);saveFavorites();renderFavoritas();}}}
function handleTouchEnd(){document.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging'));}
function exportarFavoritas(){if(!favorites.length){alert('No tienes favoritas.');return;}const name='mis_radios_'+new Date().toISOString().slice(0,10)+'.json';const content=JSON.stringify(favorites,null,2);if(window.Android&&typeof window.Android.saveTextFile==='function'){window.Android.saveTextFile(name,content,'application/json');return;}if(window.showSaveFilePicker){(async()=>{try{const h=await window.showSaveFilePicker({suggestedName:name,types:[{description:'Copia de radios',accept:{'application/json':['.json']}}]});const w=await h.createWritable();await w.write(content);await w.close();}catch(e){if(e?.name!=='AbortError')alert('No se pudo guardar la copia: '+e.message);}})();return;}const b=new Blob([content],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function importarFavoritas(ev){const f=ev.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!Array.isArray(d))throw Error('Formato no válido');favorites=d;saveFavorites();renderFavoritas();alert('✅ '+d.length+' emisoras cargadas');}catch(err){alert('Error: '+err.message);}};r.readAsText(f);ev.target.value='';}

function exportFullBackup(){
  try{
    const data={version:APP_VERSION,build:APP_BUILD,createdAt:new Date().toISOString(),storage:{}};
    for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k!=null)data.storage[k]=localStorage.getItem(k);}
    const content=JSON.stringify(data,null,2);
    const name='radios_viferor_backup_'+new Date().toISOString().slice(0,10)+'.json';
    if(window.Android&&typeof window.Android.saveTextFile==='function'){window.Android.saveTextFile(name,content,'application/json');return;}
    const blob=new Blob([content],{type:'application/json;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(e){alert('No se pudo crear el backup: '+(e?.message||e));}
}
function importFullBackupFile(file){
  const r=new FileReader();
  r.onload=e=>{
    try{
      const d=JSON.parse(e.target.result);
      if(!d||typeof d!=='object'||!d.storage||typeof d.storage!=='object'||Array.isArray(d.storage))throw Error('El archivo no es un backup completo válido de Radios Viferor.');
      if(!confirm('⚠️ Restaurar este backup sustituirá los datos actuales de la aplicación. ¿Continuar?'))return;
      localStorage.clear();
      Object.entries(d.storage).forEach(([k,v])=>{if(typeof k==='string'&&typeof v==='string')localStorage.setItem(k,v);});
      alert('✅ Backup restaurado correctamente. La aplicación se recargará.');
      location.reload();
    }catch(err){alert('❌ No se pudo restaurar el backup: '+(err?.message||err));}
    finally{const f=document.getElementById('fullBackupFile');if(f)f.value='';}
  };
  r.readAsText(file);
}
function mergeCatalogs(base,extra){const map=new Map();for(const s of [...base,...extra]){const key=(s.uuid||s.stationuuid)||((normalizar(s.name)+'|'+normalizar(s.state||'')).replace(/\s+/g,' '));const prev=map.get(key);map.set(key,prev?{...prev,...s,logo:s.logo||prev.logo,options:s.options?.length?s.options:prev.options,url:s.url||prev.url,url_resolved:s.url_resolved||prev.url_resolved}:s);}return [...map.values()].map(s=>({...s,stationuuid:s.stationuuid||s.uuid}));}
function parseTdtDirect(data){const out=[];for(const country of data?.countries||[]){for(const ambit of country?.ambits||[]){const state=ambit?.name||'España';for(const ch of ambit?.channels||[]){const options=(Array.isArray(ch?.options)?ch.options:[]).map(o=>({format:o?.format||'stream',url:o?.url||''})).filter(o=>/^https?:\/\//i.test(o.url));if(!ch?.name||!options.length)continue;const id='tdt-'+normalizar(ch.name).replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')+'-'+normalizar(state).replace(/[^a-z0-9]+/g,'-');const epg_id=ch.epg_id||'';const tdtSlug=ch.slug||ch.id||ch.channel_id||ch.channelId||epg_id.replace(/\.Radio$/i,'');out.push({uuid:id,stationuuid:id,name:ch.name,state,city:'',network:'',tags:'',logo:ch.logo||'',web:ch.web||'',epg_id,tdtSlug,options});}}}return out;}
async function cargarCatalogoNacional(){if(catalogPromise)return catalogPromise;catalogPromise=(async()=>{let nacional=[];let apiError='';try{const r=await fetch('/api/stations',{cache:'no-store'});if(!r.ok)throw new Error('API HTTP '+r.status);const d=await r.json();if(!Array.isArray(d.stations)||d.stations.length<300)throw new Error('API catálogo incompleto: '+(d.stations?.length||0));nacional=d.stations;}catch(e){apiError=e.message||String(e);try{const r=await fetch('https://www.tdtchannels.com/lists/radio.json',{cache:'no-store'});if(!r.ok)throw new Error('TDT HTTP '+r.status);const d=await r.json();nacional=parseTdtDirect(d);if(nacional.length<300)throw new Error('TDT catálogo incompleto: '+nacional.length);}catch(e2){console.warn('Catálogo nacional no disponible',apiError,e2);}}if(nacional.length){stations=mergeCatalogs(stations,nacional);if(currentView==='search')aplicarFiltros();setStatus('');}})();return catalogPromise;}
function init(){configurarGestoRadiosPodcasts();audio.volume=.8;audio.addEventListener('play',()=>{const podcastAudio=document.getElementById('podcastAudio');if(podcastAudio&&!podcastAudio.paused){try{podcastAudio.pause();}catch{}};syncRadioAndroidMedia();});audio.addEventListener('pause',()=>{if(currentStation){try{window.Android?.updateRadioMedia?.(currentStation.name||'Radio',nowPlayingEl?.textContent||'🎵 En directo',false);}catch{};window.__radioMediaStarted=false;}});audio.addEventListener('ended',()=>{if(currentStation){try{window.Android?.stopRadioMedia?.();}catch{};window.__radioMediaStarted=false;}});const vr=document.getElementById('volumeRange'),vb=document.getElementById('btnMute'),vv=document.getElementById('volumeValue');if(vr){vr.addEventListener('input',()=>{const v=Math.max(0,Math.min(100,Number(vr.value)||0));audio.volume=v/100;if(v>0)previousVolume=v/100;if(vb)vb.textContent=v===0?'🔇':v<40?'🔉':'🔊';if(vv)vv.value=v+'%';});}if(vb)vb.addEventListener('click',()=>{if(audio.volume>0){previousVolume=audio.volume;audio.volume=0;if(vr)vr.value=0;if(vv)vv.value='0%';vb.textContent='🔇';}else{audio.volume=previousVolume||.8;const v=Math.round(audio.volume*100);if(vr)vr.value=v;if(vv)vv.value=v+'%';vb.textContent=v<40?'🔉':'🔊';}});stations=(window.RADIO_STATIONS||[]).map(s=>({...s,stationuuid:s.stationuuid||s.uuid}));loadFavorites();document.getElementById('btnViewRadios').addEventListener('click',()=>cambiarVista('fav'));document.getElementById('btnRadioSearch').addEventListener('click',()=>cambiarVista('search'));document.getElementById('btnBackToRadios').addEventListener('click',()=>cambiarVista('fav'));document.getElementById('btnExportar').addEventListener('click',exportarFavoritas);document.getElementById('fileImportar').addEventListener('change',importarFavoritas);const bFullBk=document.getElementById('btnFullBackup');if(bFullBk)bFullBk.addEventListener('click',exportFullBackup);const bFullRes=document.getElementById('btnFullRestore');if(bFullRes)bFullRes.addEventListener('click',()=>document.getElementById('fullBackupFile')?.click());const fFullBk=document.getElementById('fullBackupFile');if(fFullBk)fFullBk.addEventListener('change',e=>{if(e.target.files?.[0])importFullBackupFile(e.target.files[0]);});document.getElementById('btnAplicar').addEventListener('click',aplicarFiltros);['selectNetwork','selectLocation','selectType'].forEach(id=>document.getElementById(id).addEventListener('change',aplicarFiltros));document.getElementById('textSearch').addEventListener('keydown',e=>{if(e.key==='Enter')aplicarFiltros();});document.getElementById('textSearch').addEventListener('input',actualizarChips);actualizarChips();cambiarVista('fav');cargarCatalogoNacional();try{const rs=JSON.parse(localStorage.getItem('radio_resume_state')||'null');if(rs?.station&&rs.playing!==false&&Date.now()-Number(rs.at||0)<86400000){/* Podcasts decide later which active playback is newest. */}}catch{}}
audio.addEventListener('error',()=>{if(currentStation&&audio.paused)scheduleRadioReconnect();});
window.addEventListener('online',()=>{if(currentStation&&audio.paused)scheduleRadioReconnect();});
window.addEventListener('pagehide',()=>{try{if(audio&&!audio.paused&&currentStation){const st={type:'radio',station:currentStation,streamUrl:currentStreamUrl,playing:true,at:Date.now()};localStorage.setItem('radio_resume_state',JSON.stringify(st));localStorage.setItem('radios_viferor_playback_resume_v1',JSON.stringify(st));}}catch{}clearHls();});
window.addEventListener('beforeunload',()=>{try{if(audio&&!audio.paused&&currentStation){const st={type:'radio',station:currentStation,streamUrl:currentStreamUrl,playing:true,at:Date.now()};localStorage.setItem('radio_resume_state',JSON.stringify(st));localStorage.setItem('radios_viferor_playback_resume_v1',JSON.stringify(st));}}catch{}clearHls();});window.addEventListener('error',e=>console.error('UI error',e.error||e.message));window.addEventListener('unhandledrejection',e=>console.error('Unhandled rejection',e.reason));window.addEventListener('load',init);
