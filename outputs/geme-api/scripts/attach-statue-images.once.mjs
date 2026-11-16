import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
const root='import-data/tuong-confirmed-20261114';
const plan=JSON.parse(fs.readFileSync(`${root}/plan.json`,'utf8'));
if(!['host.docker.internal','127.0.0.1','localhost'].includes(new URL(process.env.DATABASE_URL).hostname))throw new Error('Local DB only');
process.env.POS365_ENABLED='false';
const p=new PrismaService(),pos=new Pos365Service(p),storage=new MediaStorageService(),media=new MediaAssetsService(p,storage),commerce=new CommerceService(p,pos,media,new LoyaltyService(p));
try{
 await p.$connect(); if(!storage.usesR2)throw new Error('R2 provider unavailable');
 const admin=await p.adminUser.findFirst({where:{isActive:true},orderBy:{createdAt:'asc'},select:{id:true}}); if(!admin)throw new Error('No active admin actor');
 const products=await p.product.findMany({where:{sku:{in:plan.products.map(x=>x.sku)}},include:{images:true}}); if(products.length!==42)throw new Error(`Expected 42 imported products, got ${products.length}`);
 const outcomes=[];
 for(let i=0;i<plan.products.length;i+=3){
  const batch=plan.products.slice(i,i+3);
  await Promise.all(batch.map(async row=>{
   const local=path.join(root,'images',row.image);
   if(!fs.existsSync(local)){outcomes.push({sku:row.sku,image:row.image,state:'MISSING_FTP'});return;}
   const bytes=fs.readFileSync(local); const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const webp=bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!jpeg&&!png&&!webp)throw new Error(`Invalid image ${row.image}`);
   const asset=await media.save({filename:row.image,sourceKey:`legacy-statues/${row.legacyId}/${row.image}`,mimeType:jpeg?'image/jpeg':png?'image/png':'image/webp',bytes,alt:row.name});
   if(asset.storageProvider!=='r2'||!asset.objectKey||(await storage.headPublicObject(asset.objectKey)).status!==200)throw new Error(`R2 verify failed ${row.sku}`);
   const saved=await commerce.updateProductFieldsBySku(row.sku,{gallery:[asset.url]},{id:admin.id});
   if(!saved.images.some(image=>image.url===asset.url))throw new Error(`Gallery verify failed ${row.sku}`);
   outcomes.push({sku:row.sku,image:row.image,objectKey:asset.objectKey,state:'ATTACHED'});
  }));
  console.log(`ATTACHED ${Math.min(i+batch.length,plan.products.length)}/${plan.products.length}`,true);
 }
 const result={products:42,attached:outcomes.filter(x=>x.state==='ATTACHED').length,missing:outcomes.filter(x=>x.state==='MISSING_FTP').length,failures:outcomes.filter(x=>x.state!=='ATTACHED'&&x.state!=='MISSING_FTP'),details:outcomes};
 fs.writeFileSync(`${root}/image-attachment-result.json`,JSON.stringify(result,null,2)); console.log('STATUE_IMAGE_RESULT '+JSON.stringify({...result,details:undefined}));
}finally{media.onModuleDestroy();pos.onModuleDestroy();await p.$disconnect();}

\n