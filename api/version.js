export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, no-cache, must-revalidate, max-age=0');
  res.status(200).json({version:'1.5.0',build:'1500',name:'Radios Viferor',releasedAt:'2026-10-06'});
}
