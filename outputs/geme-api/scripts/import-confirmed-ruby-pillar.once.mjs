/** Local-only import of the clarified Trụ Ruby Nam Phi batch. */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';
import { usesPhysicalItemInventory } from '../dist/commerce/physical-item-inventory.js';

const root='import-data/tru-ruby-nam-phi-20261114';
const plan=JSON.parse(fs.readFileSync(`${root}/plan.json`,'utf8'));
const execute=process.argv.includes('--execute');
const allowedHosts=new Set(['host.docker.internal','127.0.0.1','localhost']);
if(!allowedHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only local database is authorized');
if(plan.sku!=='TRU-RB01S20'||plan.quality!=='Thường'||plan.groupName!=='Ruby Nam Phi'||plan.typeName!=='Ruby Nam Phi') throw new Error('Plan mapping differs from user-confirmed values');
if(plan.rows.length!==24||new Set(plan.rows.map(r=>r.legacyId)).size!==24||new Set(plan.rows.map(r=>r.image)).size!==24||Math.round(plan.rows.reduce((s,r)=>s+r.weightKg,0)*1000)!==23490) throw new Error('Ruby plan item/count/kg mismatch');
for(const row of plan.rows){if(!/^[\w.-]+$/.test(row.image)||!Number.isFinite(row.weightKg)||row.weightKg<=0)throw new Error(`Invalid source item ${row.legacyId}`);}
process.env.POS365_ENABLED='false';
const p=new PrismaService();const pos=new Pos365Service(p);const storage=new MediaStorageService();const media=new MediaAssetsService(p,storage);const commerce=new CommerceService(p,pos,media,new LoyaltyService(p));
const grams=items=>items.reduce((s,r)=>s+Math.round(Number(r.weightKg)*1000),0);
async function products(){return p.product.findMany({where:{sku:plan.sku},include:{sphereItems:true,images:true,sphereStoneType:{include:{group:true}},category:true}});}
try{
 await p.$connect();
 if(!storage.usesR2) throw new Error('R2 is not configured; refusing to attach local-only image paths');
 const parent=await p.category.findUnique({where:{slug:'vat-pham'}});const category=await p.category.findUnique({where:{slug:'tru'}});
 if(!parent||!category||category.parentId!==parent.id||category.kind!=='OTHER'||category.status!=='ACTIVE')throw new Error('Expected active category Vật Phẩm → Trụ');
 const stoneGroup=await p.sphereStoneGroup.findUnique({where:{slug:'ruby-nam-phi'}});
 if(!stoneGroup||stoneGroup.name!=='Ruby Nam Phi')throw new Error('Existing Ruby Nam Phi stone group does not match');
 const exact=await products();
 const receipt=await p.inventoryReceipt.findFirst({where:{note:{contains:plan.batch}},include:{items:true}});
 if(exact.length||receipt){
  if(exact.length!==1||!receipt||receipt.status!=='COMPLETED'||receipt.items.length!==1)throw new Error('Conflicting or incomplete pre-existing import; no stock will be added');
  const x=exact[0];if(x.categoryId!==category.id||x.kind!=='OTHER'||x.sphereQuality!=='Thường'||x.sphereStoneType?.name!=='Ruby Nam Phi'||x.sphereStoneType.group.name!=='Ruby Nam Phi'||Math.round(Number(x.stockKg)*1000)!==23490||x.sphereItems.length!==24||grams(x.sphereItems)!==23490)throw new Error('Existing Ruby import differs from expected batch');
 }
 const admin=await p.adminUser.findFirst({where:{isActive:true},orderBy:{createdAt:'asc'},select:{id:true}});if(!admin)throw new Error('No active admin to record image update');
 const filesMissing=plan.rows.filter(r=>!fs.existsSync(path.join(root,'images',r.image)));
 if(filesMissing.length)throw new Error(`${filesMissing.length} source images are missing locally`);
 console.log('RUBY_TRU_PREFLIGHT '+JSON.stringify({mode:execute?'EXECUTE':'DRY_RUN',sku:plan.sku,quality:plan.quality,type:plan.typeName,items:plan.rows.length,totalKg:plan.totalKg,ftpImages:plan.rows.length,category:'Vật Phẩm → Trụ',r2:storage.usesR2,alreadyImported:!!receipt,price:'Unconfirmed; product must remain draft',localOnly:true,posWrites:false}));
 if(!execute) process.exit(0);
 if(!receipt){
  const backup=`${root}/before-import.json`;if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify({at:new Date().toISOString(),category,stoneGroup,existingProduct:exact,existingReceipts:await p.inventoryReceipt.findMany({where:{note:{contains:plan.batch}},include:{items:true}})},null,2));
  const stoneType=await p.sphereStoneType.upsert({where:{groupId_slug:{groupId:stoneGroup.id,slug:'ruby-nam-phi'}},create:{groupId:stoneGroup.id,name:'Ruby Nam Phi',slug:'ruby-nam-phi',sortOrder:1,isActive:true},update:{name:'Ruby Nam Phi',isActive:true}});
  const saved=await commerce.createInventoryReceipt({receivedAt:'2026-11-14T06:00:00.000Z',supplierName:'Đối chiếu SQL cũ',receiver:'Admin',warehouseName:'Kho chính',paymentMethod:'Không phát sinh',note:`${plan.batch}: 24 Trụ Ruby Nam Phi chất lượng Thường, tổng 23.490 kg; mỗi trụ ghi riêng kg và SQL ID. Giá nhập 0 do nguồn không có; giá bán chưa xác nhận, để nháp. Ảnh lưu R2. Chỉ local, không đồng bộ POS.`,items:[{quantity:0,quantityKg:plan.totalKg,unitCost:0,sphereStoneGroupName:plan.groupName,sphereStoneTypeName:plan.typeName,sphereQuality:plan.quality,sphereItems:plan.rows.map((r,i)=>({label:`Trụ ${i+1} · ${r.weightKg.toFixed(3)} kg · SQL #${r.legacyId}`,weightKg:r.weightKg})),newProduct:{name:plan.name,kind:'OTHER',categoryId:category.id,sku:plan.sku,legacySku:plan.sku,allowLegacySku:true,price:null}}]});
  fs.writeFileSync(`${root}/receipt.json`,JSON.stringify(saved,null,2));console.log('RECEIPT_CREATED '+saved.receiptNo);
 }
 let found=await products();if(found.length!==1)throw new Error('Expected exactly one product after receipt');
 const product=found[0];if(product.status!=='DRAFT'||product.sphereQuality!=='Thường'||product.sphereStoneType?.id!== (await p.sphereStoneType.findUnique({where:{groupId_slug:{groupId:stoneGroup.id,slug:'ruby-nam-phi'}},select:{id:true}}))?.id||Math.round(Number(product.stockKg)*1000)!==23490||product.sphereItems.length!==24||grams(product.sphereItems)!==23490)throw new Error('Imported Ruby product failed inventory verification');
 const attachments=[];const failures=[];const gallery=[];
 for(const row of plan.rows){try{const bytes=fs.readFileSync(path.join(root,'images',row.image));const jpeg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));if(!jpeg&&!png)throw new Error('Invalid image bytes');const asset=await media.save({filename:row.image,sourceKey:`legacy-tru-ruby-nam-phi/${row.legacyId}/${row.image}`,mimeType:jpeg?'image/jpeg':'image/png',bytes,alt:`${plan.name} · ${row.weightKg.toFixed(3)} kg · SQL #${row.legacyId}`});if(asset.storageProvider!=='r2'||!asset.objectKey||(await storage.headPublicObject(asset.objectKey)).status!==200)throw new Error('R2 public object verification failed');gallery.push(asset.url);attachments.push({legacyId:row.legacyId,weightKg:row.weightKg,image:row.image,url:asset.url,objectKey:asset.objectKey});}catch(e){failures.push({legacyId:row.legacyId,image:row.image,reason:e.message});}}
 if(failures.length)throw new Error(`Only ${attachments.length}/24 images reached verified R2; details saved in report`);
 const updated=await commerce.updateProductFieldsBySku(plan.sku,{gallery:[...new Set([...product.images.map(i=>i.url),...gallery])]},{id:admin.id});
 if(gallery.some(url=>!updated.images.some(i=>i.url===url)))throw new Error('Product gallery did not retain all uploaded images');
 found=await products();const savedReceipt=await p.inventoryReceipt.findFirst({where:{note:{contains:plan.batch}},select:{id:true,receiptNo:true,status:true,pos365SyncStatus:true}});
 const result={receipt:savedReceipt,sku:plan.sku,productStatus:found[0].status,quality:found[0].sphereQuality,stoneType:found[0].sphereStoneType.name,items:found[0].sphereItems.length,totalKg:Number(found[0].stockKg),imagesAttached:found[0].images.length,imagesUploaded:attachments.length,localOnly:true,posWrites:false,attachments};
 fs.writeFileSync(`${root}/result.json`,JSON.stringify(result,null,2));console.log('RUBY_TRU_IMPORT_RESULT '+JSON.stringify({...result,attachments:undefined}));
}finally{media.onModuleDestroy();pos.onModuleDestroy();await p.$disconnect();}
