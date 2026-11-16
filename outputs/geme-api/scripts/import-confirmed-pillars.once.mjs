/** Local only. Default: dry run. --execute imports once; reruns verify stock and retry media only. */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';
import { usesPhysicalItemInventory } from '../dist/commerce/physical-item-inventory.js';

const root='import-data/tru-confirmed-20261114';
const plan=JSON.parse(fs.readFileSync(`${root}/plan.json`,'utf8'));
const execute=process.argv.includes('--execute');
const imagesOnly=process.argv.includes('--images-only');
const allowedHosts=new Set(['host.docker.internal','127.0.0.1','localhost']);
if(!allowedHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only the local database is authorized');
process.env.POS365_ENABLED='false';
const p=new PrismaService();const pos=new Pos365Service(p);const storage=new MediaStorageService();
const media=new MediaAssetsService(p,storage);const commerce=new CommerceService(p,pos,media,new LoyaltyService(p));
const grams=rows=>rows.reduce((s,r)=>s+Math.round(Number(r.weightKg)*1000),0);
const all=plan.groups.flatMap(g=>g.rows);
const skus=plan.groups.map(g=>g.sku);
if(all.length!==100||new Set(all.map(r=>r.legacyId)).size!==100||grams(all)!==156855||skus.length!==12||new Set(skus).size!==12) throw new Error('Plan totals/identities mismatch');
for(const g of plan.groups){
 if(!g.quality||g.quality==='Chưa ghi cấp'||grams(g.rows)!==Math.round(g.totalKg*1000)||!usesPhysicalItemInventory({sku:g.sku})) throw new Error(`Invalid group ${g.sku}`);
 for(const r of g.rows) if(!/^[\w.-]+$/.test(r.image)) throw new Error(`Unsafe filename for ${r.legacyId}`);
}
async function readProducts(){return p.product.findMany({where:{sku:{in:skus}},include:{sphereItems:true,images:true,sphereStoneType:{include:{group:true}}}});}
function verify(products,categoryId){
 if(products.length!==12) throw new Error('Partial or conflicting import; no stock was added');
 for(const g of plan.groups){
  const product=products.find(r=>r.sku===g.sku);
  if(!product||product.categoryId!==categoryId||product.kind!=='OTHER'||Math.round(Number(product.stockKg)*1000)!==Math.round(g.totalKg*1000)||product.sphereItems.length!==g.rows.length||grams(product.sphereItems)!==grams(g.rows)||product.sphereQuality!==g.quality||product.sphereStoneType?.name!==g.typeName||product.sphereStoneType?.group.name!==g.groupName) throw new Error(`Verification failed ${g.sku}; no reimport`);
  for(const r of g.rows) if(!product.sphereItems.some(item=>item.label?.endsWith(`SQL #${r.legacyId}`)&&Math.round(Number(item.weightKg)*1000)===Math.round(r.weightKg*1000))) throw new Error(`Missing physical item SQL #${r.legacyId}`);
 }
}
try{
 await p.$connect();
 if(!storage.usesR2||!storage.publicUrl('media/probe.jpg')) throw new Error('R2 not configured');
 const parent=await p.category.findUnique({where:{slug:'vat-pham'}});
 if(parent?.kind!=='OTHER'||parent.status!=='ACTIVE') throw new Error('Missing active Vật Phẩm root');
 let category=await p.category.findUnique({where:{slug:'tru'}});
 if(category&&(category.kind!=='OTHER'||category.parentId!==parent.id||category.level!==2)) throw new Error('Existing Trụ category conflicts');
 const admin=await p.adminUser.findFirst({where:{isActive:true},orderBy:{createdAt:'asc'},select:{id:true}});
 if(!admin) throw new Error('Missing audit actor');
 const existing=await readProducts();
 const priorReceipt=await p.inventoryReceipt.findFirst({where:{note:{contains:plan.batch}},include:{items:true}});
 if(existing.length||priorReceipt){
  if(!category||!priorReceipt||priorReceipt.items.length!==12||priorReceipt.status!=='COMPLETED') throw new Error('Pre-existing data is not this complete batch');
  verify(existing,category.id);
 }
 const rulesSetting=await p.siteSetting.findUnique({where:{key:'inventory.skuRules'}});
 const priorRules=Array.isArray(rulesSetting?.value)?rulesSetting.value:[];
 const rule=category?priorRules.find(r=>r.categoryId===category.id):null;
 if(rule&&rule.prefix!=='TRU') throw new Error('Existing SKU prefix conflicts');
 const sourceAssets=await p.mediaAsset.findMany({where:{filename:{in:all.map(r=>r.image)},storageProvider:'r2',isPrivate:false},select:{id:true,filename:true,objectKey:true,sourceKey:true}});
 const preflight={mode:execute?'EXECUTE':'DRY_RUN',alreadyImported:!!priorReceipt,groups:plan.groups.map(g=>({sku:g.sku,quality:g.quality,items:g.rows.length,kg:g.totalKg})),totalItems:100,totalKg:156.855,pendingSourceRows:plan.pending.length,category:'Vật Phẩm → Trụ',localOnly:true,posWrites:false,existingR2Assets:sourceAssets.length,pricing:'Not inferred; legacy per-piece prices retained in plan, product remains draft'};
 console.log('PILLAR_PREFLIGHT '+JSON.stringify(preflight));
 if(!execute) process.exit(0);
 if(imagesOnly&&!priorReceipt) throw new Error('No existing receipt for images-only');
 if(!priorReceipt){
  const backup=`${root}/before-import.json`;
  if(!fs.existsSync(backup)) fs.writeFileSync(backup,JSON.stringify({at:new Date().toISOString(),categories:await p.category.findMany({where:{kind:'OTHER'}}),rules:rulesSetting,existingProducts:existing,existingSphereProducts:await p.product.findMany({where:{sku:{startsWith:'CAU-'}},select:{id:true,sku:true,stockKg:true,_count:{select:{sphereItems:true}}}})},null,2));
  await p.$transaction(async tx=>{
   category=await tx.category.upsert({where:{slug:'tru'},create:{name:'Trụ',slug:'tru',parentId:parent.id,kind:'OTHER',usage:'PRODUCT_CATEGORY',level:2,status:'ACTIVE',pricingMode:'FIXED',sortOrder:2},update:{}});
   const current=await tx.siteSetting.findUnique({where:{key:'inventory.skuRules'}});
   const rules=Array.isArray(current?.value)?current.value:[];
   if(!rules.some(r=>r.categoryId===category.id)) await tx.siteSetting.upsert({where:{key:'inventory.skuRules'},create:{key:'inventory.skuRules',value:[{categoryId:category.id,prefix:'TRU',skuFormat:'SEQUENTIAL',materialOptionIds:[],materialPrefixes:[]}]},update:{value:[...rules,{categoryId:category.id,prefix:'TRU',skuFormat:'SEQUENTIAL',materialOptionIds:[],materialPrefixes:[]}]}});
  });
  const receipt=await commerce.createInventoryReceipt({receivedAt:'2026-11-14T06:00:00.000Z',supplierName:'Đối chiếu SQL cũ',receiver:'Admin',warehouseName:'Kho chính',paymentMethod:'Không phát sinh',note:`${plan.batch}: 100 trụ, 12 SKU chất lượng, 156.855 kg. Nhập local theo từng trụ. Giá nhập 0; chưa chốt giá bán/kg. Giữ 70 hồ sơ chưa rõ ngoài phiếu. Không đồng bộ POS.`,items:plan.groups.map(g=>({quantity:0,quantityKg:g.totalKg,unitCost:0,sphereStoneGroupName:g.groupName,sphereStoneTypeName:g.typeName,sphereQuality:g.quality,sphereItems:g.rows.map((r,i)=>({label:`Trụ ${i+1} · ${r.weightKg.toFixed(3)} kg · SQL #${r.legacyId}`,weightKg:r.weightKg})),newProduct:{name:g.name,kind:'OTHER',categoryId:category.id,sku:g.sku,legacySku:g.sku,allowLegacySku:true,price:null}}))});
  fs.writeFileSync(`${root}/receipt.json`,JSON.stringify(receipt,null,2));
  console.log('RECEIPT_CREATED '+receipt.receiptNo);
 }
 const imported=await readProducts();verify(imported,category.id);
 const failures=[];const attachments=[];
 for(const g of plan.groups){
  const gallery=[];
  for(const row of g.rows){
   try{
    let bytes=null;
    const local=path.join(root,'images',row.image);
    if(fs.existsSync(local)) bytes=fs.readFileSync(local);
    else{
     const matches=sourceAssets.filter(a=>a.filename===row.image&&a.objectKey);
     const keys=[...new Set(matches.map(a=>a.objectKey))];
     if(keys.length>1) throw new Error('Multiple R2 sources; requires verification');
     const key=keys[0]||`legacy-product-images/${row.image}`;
     if((await storage.headPublicObject(key)).status===200) bytes=await storage.getPublicObject(key);
    }
    if(!bytes) throw new Error('Source image unavailable; FTP connection timed out');
    const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if(!jpeg&&!png) throw new Error('Source is not a verified JPEG/PNG');
    const asset=await media.save({filename:row.image,sourceKey:`legacy-pillars/${row.legacyId}/${row.image}`,mimeType:jpeg?'image/jpeg':'image/png',bytes,alt:row.name});
    if(asset.storageProvider!=='r2'||!asset.objectKey||(await storage.headPublicObject(asset.objectKey)).status!==200) throw new Error('R2 verification failed');
    gallery.push(asset.url);attachments.push({legacyId:row.legacyId,sku:g.sku,image:row.image,url:asset.url,objectKey:asset.objectKey});
   }catch(error){failures.push({legacyId:row.legacyId,sku:g.sku,image:row.image,reason:error.message});}
  }
  if(gallery.length){
   const saved=await commerce.updateProductFieldsBySku(g.sku,{gallery:[...new Set([...imported.find(p=>p.sku===g.sku).images.map(i=>i.url),...gallery])]},{id:admin.id});
   if(gallery.some(url=>!saved.images.some(img=>img.url===url))) throw new Error(`Gallery verification failed ${g.sku}`);
  }
 }
 const verified=await readProducts();verify(verified,category.id);
 const savedReceipt=await p.inventoryReceipt.findFirst({where:{note:{contains:plan.batch}},select:{receiptNo:true,id:true,pos365SyncStatus:true}});
 const summary={receipt:savedReceipt,products:verified.length,items:verified.reduce((s,p)=>s+p.sphereItems.length,0),kg:verified.reduce((s,p)=>s+Math.round(Number(p.stockKg)*1000),0)/1000,imagesAttached:attachments.length,imagesMissing:failures.length,attachments,failures,pendingLegacyRows:70,localOnly:true,posWrites:false};
 fs.writeFileSync(`${root}/result.json`,JSON.stringify(summary,null,2));
 console.log('PILLAR_IMPORT_RESULT '+JSON.stringify({...summary,attachments:undefined,failures:undefined}));
}finally{media.onModuleDestroy();pos.onModuleDestroy();await p.$disconnect();}
