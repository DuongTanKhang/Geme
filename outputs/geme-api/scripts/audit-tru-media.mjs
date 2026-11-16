import fs from 'node:fs';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
const root='import-data/tru-confirmed-20261114';
const plan=JSON.parse(fs.readFileSync(`${root}/plan.json`,'utf8'));
const storage=new MediaStorageService();
const rows=plan.groups.flatMap(g=>g.rows);const result=[];
for(let i=0;i<rows.length;i+=5){
 const part=await Promise.all(rows.slice(i,i+5).map(async row=>{
  const key=`legacy-product-images/${row.image}`;
  try { const r=await storage.headPublicObject(key); return {id:row.legacyId,image:row.image,key,status:r.status}; }
  catch { return {id:row.legacyId,image:row.image,key,status:'connection-error'}; }
 }));result.push(...part);
 console.log(`Checked ${result.length}/${rows.length}`);
}
fs.writeFileSync(`${root}/media-audit.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({found:result.filter(r=>r.status===200).length,missing:result.filter(r=>r.status!==200).length}));
