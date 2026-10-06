export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    const u=new URL(req.url,'http://localhost');
    const audioUrl=u.searchParams.get('url');
    if(!audioUrl || !/^https?:\/\//i.test(audioUrl)) return res.status(400).json({error:'URL de audio no válida'});
    const target=new URL(audioUrl);
    const host=target.hostname.toLowerCase();
    const allowed=/((^|\.)traffic\.omny\.fm$|(^|\.)omny\.fm$|(^|\.)omnycontent\.com$|(^|\.)tritondigital\.com$|(^|\.)omny-us\.pdn\.tritondigital\.com$)/i.test(host);
    if(!allowed) return res.status(400).json({error:'Fuente de audio no permitida'});
    const r=await fetch(audioUrl,{method:'GET',redirect:'manual',headers:{'User-Agent':'Radios-Viferor/1.4.24','Accept':'audio/mpeg,audio/*,*/*','Range':'bytes=0-1'}});
    if(r.body)try{await r.body.cancel();}catch{}
    if(r.status>=300 && r.status<400){
      const loc=r.headers.get('location');
      if(!loc) return res.status(502).json({error:'La fuente de audio no devolvió destino'});
      return res.status(200).json({url:new URL(loc,audioUrl).toString(),source:'redirect'});
    }
    if(r.ok) return res.status(200).json({url:audioUrl,source:'direct'});
    return res.status(502).json({error:'Audio HTTP '+r.status});
  }catch(e){return res.status(502).json({error:'No se pudo resolver el audio',detail:e.message});}
}
