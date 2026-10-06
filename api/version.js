export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.status(200).json({version:'1.4.65',build:'1465',name:'Radios Viferor',releasedAt:'2026-09-28'});
}
