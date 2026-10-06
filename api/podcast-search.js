const cache = globalThis.__podcastSearchCache || (globalThis.__podcastSearchCache = new Map());
const GENRES = {
  'Todas':'', 'Arte':'1301', 'Negocios':'1321', 'Comedia':'1303', 'Educación':'1304', 'Ficción':'1483',
  'Gobierno':'1511', 'Salud':'1512', 'Historia':'1487', 'Niños y familia':'1305', 'Música':'1310',
  'Noticias':'1489', 'Religión y espiritualidad':'1437', 'Ciencia':'1533', 'Sociedad y cultura':'1324',
  'Deportes':'1545', 'Tecnología':'1318', 'TV y cine':'1309', 'Ocio':'1320'
};
async function getJson(url){
  const r=await fetch(url,{headers:{'User-Agent':'Radios-Viferor/1.3 Podcast'} });
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
function clean(x){return String(x||'').trim();}
function textNorm(v){return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
const LANGUAGE_ALIASES={es:['es','spa','spanish','espanol','castellano','spanish (spain)'],en:['en','eng','english'],fr:['fr','fra','fre','french','francais'],de:['de','deu','ger','german','deutsch'],it:['it','ita','italian','italiano'],pt:['pt','por','portuguese','portugues'],ca:['ca','cat','catalan','catala']};
const COUNTRY_ALIASES={ES:['es','spain','espana','españa'],US:['us','usa','united states','estados unidos'],GB:['gb','uk','united kingdom','reino unido'],MX:['mx','mexico','méxico'],AR:['ar','argentina']};
function languageAccepted(item,wanted,storefront){
  if(!wanted)return true;
  const vals=[];
  [item.language, ...(Array.isArray(item.languageCodes)?item.languageCodes:[]), ...(Array.isArray(item.languageCodesISO2A)?item.languageCodesISO2A:[])].forEach(v=>{const n=textNorm(v);if(n)vals.push(n);});
  const aliases=LANGUAGE_ALIASES[wanted]||[wanted];
  if(vals.length)return vals.some(raw=>aliases.some(a=>raw===a||raw.startsWith(a+' ')||raw.includes('('+a+')')));
  // Missing Apple language metadata is not enough to accept a result.
  // languageFilter() will inspect the podcast RSS feed when necessary.
  return false;
}
async function feedLanguage(feedUrl){
  const url=clean(feedUrl);
  if(!url)return '';
  const key='lang:'+url;
  const hit=cache.get(key);
  if(hit && Date.now()-hit.t<86400000)return hit.data||'';
  try{
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),2500);
    const r=await fetch(url,{headers:{'User-Agent':'Radios-Viferor/1.4.30'},signal:ctrl.signal});
    clearTimeout(timer);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const xml=(await r.text()).slice(0,300000);
    const m=xml.match(/<language\s*>\s*([^<]+)\s*<\/language>/i);
    const lang=textNorm(m?.[1]||'');
    cache.set(key,{t:Date.now(),data:lang});
    return lang;
  }catch{
    cache.set(key,{t:Date.now(),data:''});
    return '';
  }
}
async function languageFilter(items,wanted,storefront,searchTerm=''){
  if(!wanted)return items;
  const aliases=LANGUAGE_ALIASES[wanted]||[wanted];
  const storefrontLanguages={ES:'es',MX:'es',AR:'es',US:'en',GB:'en'};
  const termNorm=textNorm(searchTerm);
  const isRadioMarcaSearch=wanted==='es' && /radio\s+marca/.test(termNorm);
  const inferred=storefrontLanguages[storefront]||'';
  const hydrated=[];
  for(let i=0;i<items.length;i+=10){
    const batch=items.slice(i,i+10);
    const rows=await Promise.all(batch.map(async item=>{
      if(languageAccepted(item,wanted,storefront))return item;
      if(!item.language && !(item.languageCodes||[]).length && !(item.languageCodesISO2A||[]).length && inferred && aliases.includes(inferred)) return item;
      // Radio MARCA podcasts are sometimes returned by Apple without usable
      // language metadata. When the user explicitly searches Radio MARCA,
      // keep those branded Spanish results instead of dropping them.
      if(isRadioMarcaSearch && /marca/.test(textNorm(item.author||''))) return item;
      const feedLang=await feedLanguage(item.feedUrl);
      if(feedLang && aliases.some(a=>feedLang===a || feedLang.startsWith(a+'-') || feedLang.startsWith(a+'_') || feedLang.startsWith(a+' ')))return item;
      return null;
    }));
    rows.forEach(x=>{if(x)hydrated.push(x);});
  }
  return hydrated;
}

function countryAccepted(item,wanted){
  // The Apple search/RSS endpoint is already scoped to the selected storefront.
  // The per-item `country` field is not the podcast creator's country and is
  // inconsistent across Apple responses, so it must never eliminate a valid
  // result from a selected storefront.
  return true;
}

function filterItems(items,{genre,language,country}){
  let out=items;
  if(genre && GENRES[genre]) out=out.filter(x=>categoryAccepted(x,genre));
  out=out.filter(x=>countryAccepted(x,country));
  // Language is applied in languageFilter(), because Apple often omits it.
  return out;
}

function dedupeItems(items){
  const seen=new Set();
  return items.filter(x=>{const k=x.feedUrl||('id:'+x.id)||('title:'+textNorm(x.title));if(seen.has(k))return false;seen.add(k);return true;});
}

function genreNorm(v){
  return clean(v).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ' ).trim();
}
const GENRE_ALIASES={
  'deportes':['deportes','sports'], 'comedia':['comedia','comedy'], 'ciencia':['ciencia','science'],
  'arte':['arte','arts'], 'negocios':['negocios','business'], 'educacion':['educacion','education'],
  'ficcion':['ficcion','fiction'], 'gobierno':['gobierno','government'], 'salud':['salud','health'],
  'historia':['historia','history'], 'ninos y familia':['ninos y familia','kids family','kids'],
  'musica':['musica','music'], 'noticias':['noticias','news'], 'religion y espiritualidad':['religion y espiritualidad','religion spirituality','religion'],
  'sociedad y cultura':['sociedad y cultura','society culture'], 'tecnologia':['tecnologia','technology'],
  'tv y cine':['tv y cine','tv film','film'], 'ocio':['ocio','leisure','hobbies']
};
function genreMatches(item,wanted){
  const aliases=GENRE_ALIASES[wanted]||[wanted];
  const vals=[item.genre,...(item.genres||[])].map(genreNorm).filter(Boolean);
  return vals.some(v=>aliases.some(a=>v===a||v.startsWith(a+' ')||v.includes(' '+a+' ')));
}
function mapItem(x){
  const gs=Array.isArray(x.genres)?x.genres.map(g=>clean(typeof g==='string'?g:g?.name||g?.genreName||g?.genre||'' )).filter(Boolean):[];
  const genreIds=Array.isArray(x.genreIds)?x.genreIds.map(v=>String(v)):[];
  return {catalogStorefront:clean(x.__storefront||''),id:String(x.collectionId||x.trackId||x.id||''),title:clean(x.collectionName||x.trackName||x.name||x.title),author:clean(x.artistName||x.artist||x.author||''),artwork:x.artworkUrl600||x.artworkUrl100||x.artworkUrl60||x.artwork||'',feedUrl:clean(x.feedUrl),webUrl:clean(x.collectionViewUrl||x.trackViewUrl||x.url||x.link),genre:clean(x.primaryGenreName||x.genre||(gs[0]||'')),genres:gs,genreIds,country:clean(x.country),language:clean(x.language),languageCodes:Array.isArray(x.languageCodes)?x.languageCodes.map(String):[],languageCodesISO2A:Array.isArray(x.languageCodesISO2A)?x.languageCodesISO2A.map(String):[],episodeCount:Number(x.trackCount||0),releaseDate:x.releaseDate||''};
}
function categoryAccepted(item, wantedGenre){
  if(!wantedGenre || !GENRES[wantedGenre]) return true;
  const gid=String(GENRES[wantedGenre]);
  const ids=Array.isArray(item.genreIds)?item.genreIds.map(String):[];
  const vals=[item.genre,...(item.genres||[])].map(genreNorm).filter(Boolean);
  // Accept an explicit ID match OR a clear name match. Apple/RSS responses
  // are inconsistent about which of these fields they populate.
  if(ids.includes(gid)) return true;
  if(vals.length && genreMatches(item,genreNorm(wantedGenre))) return true;
  // If the source endpoint was already category-scoped and supplied no
  // contradictory metadata, keep the item instead of producing false zeros.
  return !ids.length && !vals.length;
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=900');
  try{
    const u=new URL(req.url,'http://localhost');
    const mode=u.searchParams.get('mode')||'search';
    const term=clean(u.searchParams.get('q'));
    const country=clean(u.searchParams.get('country')||'ALL').toUpperCase();
    const language=clean(u.searchParams.get('language')||'').toLowerCase();
    const genre=u.searchParams.get('genre')||'';
    const limit=Math.min(100,Math.max(1,Number(u.searchParams.get('limit')||50)));
    const storefronts=country==='ALL'?['ES','US','GB','MX','AR']:[country];
    const key=mode+'|'+term+'|'+genre+'|'+country+'|'+language+'|'+limit;
    const cached=cache.get(key); if(cached && Date.now()-cached.t<300000) return res.status(200).json(cached.data);

    // Radio MARCA mantiene podcasts activos en Omny. No dependemos exclusivamente
    // de Apple para que la marca aparezca en los resultados de búsqueda.
    const marcaFallback=[
      {id:'omny-marcador',title:'MARCADOR',author:'Radio MARCA',artwork:'',feedUrl:'https://omny.fm/shows/marcador/playlists/podcast.rss',webUrl:'https://omny.fm/shows/marcador',genre:'Deportes',genres:['Deportes'],genreIds:['1545'],country:'ES',language:'es',languageCodes:['es'],languageCodesISO2A:['es'],episodeCount:0},
      {id:'omny-radio-marca-sevilla',title:'Radio MARCA Sevilla',author:'Radio MARCA Sevilla',artwork:'',feedUrl:'https://omny.fm/shows/radio-marca-sevilla/playlists/podcast.rss',webUrl:'https://omny.fm/shows/radio-marca-sevilla',genre:'Deportes',genres:['Deportes'],genreIds:['1545'],country:'ES',language:'es',languageCodes:['es'],languageCodesISO2A:['es'],episodeCount:0},
      {id:'omny-radio-marca-valencia',title:'Radio MARCA Valencia',author:'Radio MARCA Valencia',artwork:'',feedUrl:'https://omny.fm/shows/radio-marca-valencia/playlists/podcast.rss',webUrl:'https://omny.fm/shows/radio-marca-valencia',genre:'Deportes',genres:['Deportes'],genreIds:['1545'],country:'ES',language:'es',languageCodes:['es'],languageCodesISO2A:['es'],episodeCount:0},
      {id:'omny-tu-plan',title:'Tu Plan',author:'Radio MARCA',artwork:'',feedUrl:'https://omny.fm/shows/tu-plan/playlists/podcast.rss',webUrl:'https://omny.fm/shows/tu-plan',genre:'Ocio',genres:['Ocio'],genreIds:['1320'],country:'ES',language:'es',languageCodes:['es'],languageCodesISO2A:['es'],episodeCount:0}
    ];
    const isMarcaQuery=/\bmarca\b/i.test(textNorm(term));

    async function queryStore(store){
      let url;
      if(mode==='popular'){
        const gid=GENRES[genre]||'';
        url=`https://itunes.apple.com/${store.toLowerCase()}/rss/toppodcasts/limit=${Math.max(limit,80)}${gid?`/genre=${gid}`:''}/json`;
      }else{
        const params=new URLSearchParams({term:term||'podcast',country:store,media:'podcast',entity:'podcast',limit:String(Math.max(limit,80))});
        if(genre && GENRES[genre]) params.set('genreId',GENRES[genre]);
        url='https://itunes.apple.com/search?'+params.toString();
      }
      try{
        const d=await getJson(url);
        let items=(mode==='popular'?(d.feed?.results||[]):(d.results||[])).map(x=>mapItem({...x,__storefront:store})).filter(x=>x.title);
        // Apple can return no exact matches for the Radio MARCA brand name.
        // Retry the same storefront with the broader MARCA term and merge it.
        if(mode!=='popular' && textNorm(term).includes('radio marca') && !items.length){
          const fallbackParams=new URLSearchParams({term:'Marca',country:store,media:'podcast',entity:'podcast',limit:String(Math.max(limit,100))});
          const fd=await getJson('https://itunes.apple.com/search?'+fallbackParams.toString());
          items=(fd.results||[]).map(x=>mapItem({...x,__storefront:store})).filter(x=>x.title);
        }
        if(mode==='popular' && !items.length){
          const params=new URLSearchParams({term:'podcast',country:store,media:'podcast',entity:'podcast',limit:'100'});
          if(genre && GENRES[genre]) params.set('genreId',GENRES[genre]);
          const fd=await getJson('https://itunes.apple.com/search?'+params.toString());
          items=(fd.results||[]).map(x=>mapItem({...x,__storefront:store})).filter(x=>x.title);
        }
        let filtered=filterItems(items,{genre,country:store,language:''});
        if(language)filtered=await languageFilter(filtered,language,store,term);
        return filtered;
      }catch(err){
        return [];
      }
    }

    const chunks=await Promise.all(storefronts.map(queryStore));
    let items=dedupeItems(chunks.flat());
    if(mode!=='popular' && country==='ES' && isMarcaQuery){
      items=dedupeItems([...marcaFallback,...items]);
      if(language) items=await languageFilter(items,language,'ES',term);
    }
    if(mode==='popular') items.sort((a,b)=>(b.episodeCount||0)-(a.episodeCount||0));
    items=items.slice(0,limit);
    const data={items,source:'itunes+rss-language',mode,query:term,genre,country,language};
    cache.set(key,{t:Date.now(),data});
    return res.status(200).json(data);
  }catch(e){ return res.status(502).json({error:'No se pudo consultar el catálogo de podcasts',detail:e.message}); }
}
