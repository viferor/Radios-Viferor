const TIMEOUT_MS = 7000;
const RB_MIRRORS=['https://de1.api.radio-browser.info','https://nl1.api.radio-browser.info','https://at1.api.radio-browser.info'];
function clean(v){return String(v||'').replace(/\0/g,'').replace(/\s+/g,' ').trim();}
function decodeLatin1(u8){let s='';for(let i=0;i<u8.length;i++)s+=String.fromCharCode(u8[i]);try{return decodeURIComponent(escape(s));}catch{return s;}}
function parseIcy(buf){const text=decodeLatin1(buf);const m=text.match(/StreamTitle='([^']*)';/i)||text.match(/StreamTitle="([^"]*)";/i);return clean(m?.[1]||'');}
async function radioBrowserSong(name,state,stationuuid,url){for(const base of RB_MIRRORS){try{if(stationuuid){const r=await fetch(`${base}/json/stations/byuuid/${encodeURIComponent(stationuuid)}`,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(3500)});if(r.ok){const a=await r.json();const x=a?.[0];if(x?.songtitle)return {song:clean(x.songtitle),stationuuid:x.stationuuid||stationuuid};}}}catch{}try{const q=new URLSearchParams({countrycode:'ES',countrycodeexact:'true',hidebroken:'true',limit:'20'});if(name)q.set('name',name);if(state)q.set('state',state);if(url)q.set('url',url);const r=await fetch(`${base}/json/stations/search?${q}`,{headers:{'Accept':'application/json'},signal:AbortSignal.timeout(4500)});if(!r.ok)continue;const a=await r.json();const nl=String(name||'').toLowerCase().trim();const exact=a.find(x=>nl&&String(x.name||'').toLowerCase().trim()===nl)||a.find(x=>stationuuid&&x.stationuuid===stationuuid)||a[0];if(exact?.songtitle)return {song:clean(exact.songtitle),stationuuid:exact.stationuuid||stationuuid||''};}catch{}}return null;}
export default async function handler(req,res){
  const url=String(req.query?.url||'');
  const name=String(req.query?.name||'').trim();
  const state=String(req.query?.state||'').trim();
  if(!/^https?:\/\//i.test(url))return res.status(400).json({error:'URL no válida'});
  const ctl=new AbortController();const timer=setTimeout(()=>ctl.abort(),TIMEOUT_MS);
  try{
    const r=await fetch(url,{headers:{'Icy-MetaData':'1','User-Agent':'RadioEspana/1.2'},redirect:'follow',signal:ctl.signal});
    const headers={};for(const [k,v] of r.headers)headers[k.toLowerCase()]=v;
    const metaInt=Number(headers['icy-metaint']||0);
    const out={song:'',title:clean(headers['icy-name']||''),bitrate:clean(headers['icy-br']||'')};
    if(metaInt>0&&r.body){const reader=r.body.getReader();let data=new Uint8Array(0),target=metaInt+1;while(data.length<target){const {value,done}=await reader.read();if(done)break;const merged=new Uint8Array(data.length+value.length);merged.set(data);merged.set(value,data.length);data=merged;if(data.length>262144)break;}if(data.length>metaInt){const len=data[metaInt]*16;const end=Math.min(data.length,metaInt+1+len);out.song=parseIcy(data.slice(metaInt+1,end));}try{reader.cancel();}catch{}}
    clearTimeout(timer);res.setHeader('Cache-Control','no-store');if(!out.song){const rb=await radioBrowserSong(name,state,req.query?.stationuuid||'',url);if(rb){out.song=rb.song;out.stationuuid=rb.stationuuid;out.source='radio-browser';}}
    return res.status(200).json(out);
  }catch(e){clearTimeout(timer);return res.status(200).json({song:'',error:e.name==='AbortError'?'timeout':'metadata_unavailable'});}
}
