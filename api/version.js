export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.status(200).json({version:'1.6.0',build:'1600',name:'Radios Viferor',releasedAt:'2026-10-06'});
}
