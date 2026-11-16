/** Local-only guarded import. Creates standard-count statue SKUs from verified legacy rows. */
import fs from 'node:fs';
import { PrismaService } from '../dist/prisma/prisma.service.js';
import { CommerceService } from '../dist/commerce/commerce.service.js';
import { Pos365Service } from '../dist/pos365/pos365.service.js';
import { MediaAssetsService } from '../dist/media/media-assets.service.js';
import { MediaStorageService } from '../dist/media/media-storage.service.js';
import { LoyaltyService } from '../dist/loyalty/loyalty.service.js';

const root='import-data/tuong-confirmed-20261114';
const plan=JSON.parse(fs.readFileSync(`${root}/plan.json`,'utf8'));
const execute=process.argv.includes('--execute');
const allowedHosts=new Set(['host.docker.internal','127.0.0.1','localhost']);
if(!allowedHosts.has(new URL(process.env.DATABASE_URL).hostname)) throw new Error('Only the local database is authorized');
process.env.POS365_ENABLED='false';
const prisma=new PrismaService();
const pos=new Pos365Service(prisma);
const storage=new MediaStorageService();
const media=new MediaAssetsService(prisma,storage);
const commerce=new CommerceService(prisma,pos,media,new LoyaltyService(prisma));
const normalizeSlug=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,170);
const skus=plan.products.map(item=>item.sku);
const expectedCost=sale=>Math.round(sale/3);
if(plan.expectedCount!==42||plan.products.length!==42||new Set(skus).size!==42||plan.products.some(item=>!item.sku||!Number.isSafeInteger(item.sellPrice)||item.sellPrice<=0||item.unitCost!==expectedCost(item.sellPrice))) throw new Error('Invalid Tượng import plan');
if(plan.products.some(item=>/^(?:CAU|TRU|H)(?:-|\s|$)/i.test(item.sku))) throw new Error('A statue SKU matched weight-inventory prefixes');
try{
 await prisma.$connect();
 const rootCategory=await prisma.category.findUnique({where:{slug:'vat-pham'}});
 if(!rootCategory||rootCategory.kind!=='OTHER'||rootCategory.level!==1||rootCategory.status!=='ACTIVE') throw new Error('Missing active Vật Phẩm root');
 let category=await prisma.category.findUnique({where:{slug:'tuong'}});
 if(category&&(category.kind!=='OTHER'||category.parentId!==rootCategory.id||category.level!==2||category.status!=='ACTIVE')) throw new Error('Existing Tượng category conflicts');
 const existing=await prisma.product.findMany({where:{sku:{in:skus}},include:{category:true}});
 const priorReceipt=await prisma.inventoryReceipt.findFirst({where:{note:{contains:plan.batch}},include:{items:true}});
 if(existing.length||priorReceipt){
  if(existing.length!==42||!category||!priorReceipt||priorReceipt.status!=='COMPLETED'||priorReceipt.items.length!==42) throw new Error('Partial/conflicting statue import; stopping to avoid duplicate stock');
  for(const item of plan.products){const product=existing.find(row=>row.sku===item.sku);if(!product||product.categoryId!==category.id||product.kind!=='OTHER'||Number(product.price)!==item.sellPrice||product.stock!==1||product.status!=='DRAFT')throw new Error(`Existing record differs from expected ${item.sku}`)}
  console.log('STATUE_IMPORT_ALREADY_COMPLETE '+JSON.stringify({receipt:priorReceipt.receiptNo,products:existing.length,stock:existing.reduce((sum,row)=>sum+row.stock,0)}));
  process.exit(0);
 }
 const actor=await prisma.adminUser.findFirst({where:{isActive:true},orderBy:{createdAt:'asc'},select:{id:true}});
 if(!actor) throw new Error('Missing active admin audit actor');
 const filenameSet=[...new Set(plan.products.map(item=>item.image).filter(Boolean))];
 const mediaRows=await prisma.mediaAsset.findMany({where:{filename:{in:filenameSet},storageProvider:'r2',isPrivate:false},select:{filename:true,objectKey:true}});
 const preflight={mode:execute?'EXECUTE':'DRY_RUN',products:plan.products.length,uniqueSkus:new Set(skus).size,priced:plan.products.filter(item=>item.sellPrice>0).length,salePriceTotal:plan.products.reduce((sum,item)=>sum+item.sellPrice,0),purchaseCostTotal:plan.products.reduce((sum,item)=>sum+item.unitCost,0),missingSkuRows:11,category:'Vật Phẩm → Tượng',categoryWillBeCreated:!category,inventory:'1 cái mỗi SKU',salePrice:'legacy SQL Gia',purchaseCost:'round(Gia / 3) to nearest VND',imagesFoundInR2:mediaRows.length,publication:'DRAFT until images/review',posWrites:false,localOnly:true};
 console.log('STATUE_PREFLIGHT '+JSON.stringify(preflight));
 if(!execute) process.exit(0);
 if(!category){
  const max=await prisma.category.aggregate({where:{parentId:rootCategory.id},_max:{sortOrder:true}});
  category=await prisma.category.create({data:{name:'Tượng',slug:'tuong',parentId:rootCategory.id,kind:'OTHER',usage:'PRODUCT_CATEGORY',level:2,status:'ACTIVE',pricingMode:'FIXED',sortOrder:(max._max.sortOrder||0)+1,description:'Tượng phong thủy GEME.'}});
 }
 const before=`${root}/before-import.json`;
 if(!fs.existsSync(before)) fs.writeFileSync(before,JSON.stringify({createdAt:new Date().toISOString(),category,skus},null,2));
 const created=await prisma.$transaction(async tx=>{
  const records=[];
  for(const item of plan.products){
   records.push(await tx.product.create({data:{sku:item.sku,name:item.name,slug:`${normalizeSlug(item.name)}-${item.sku.toLowerCase()}`,kind:'OTHER',categoryId:category.id,status:'DRAFT',publicationHistoryKnown:true,description:item.description||null,price:item.sellPrice,pos365PriceSyncStatus:'DISABLED',stock:0,stockKg:0}}));
  }
  return records;
 });
 try{
  const receipt=await commerce.createInventoryReceipt({receivedAt:'2026-11-14T06:00:00.000Z',supplierName:'Đối chiếu SQL cũ',receiver:'Admin',warehouseName:'Kho chính',paymentMethod:'Không phát sinh',note:`${plan.batch}: Nhập ${created.length} tượng có SKU; mỗi SKU tồn 1 cái. Giá bán lấy theo cột Gia SQL cũ; giá nhập = giá bán / 3, làm tròn đến đồng. 11 hồ sơ thiếu SKU để chờ. Chưa đăng bán vì ảnh chưa có trên R2. Chỉ local, không đồng bộ POS.`,items:plan.products.map(item=>({productId:created.find(row=>row.sku===item.sku).id,quantity:1,unitCost:item.unitCost}))});
  const saved=await prisma.product.findMany({where:{sku:{in:skus}},select:{id:true,sku:true,name:true,price:true,stock:true,stockKg:true,status:true,categoryId:true,images:{select:{url:true}}}});
  const bad=saved.filter(row=>row.categoryId!==category.id||Number(row.price)!==plan.products.find(item=>item.sku===row.sku).sellPrice||row.stock!==1||Number(row.stockKg)!==0||row.status!=='DRAFT');
  if(saved.length!==42||bad.length) throw new Error(`Post-import verification failed: products=${saved.length}, bad=${bad.length}`);
  const summary={receiptNo:receipt.receiptNo,products:saved.length,stock:saved.reduce((sum,row)=>sum+row.stock,0),salePriceTotal:saved.reduce((sum,row)=>sum+Number(row.price),0),purchaseCostTotal:plan.products.reduce((sum,row)=>sum+row.unitCost,0),imagesAttached:saved.filter(row=>row.images.length).length,publication:'DRAFT',localOnly:true,posWrites:false,pendingSkuRows:11};
  fs.writeFileSync(`${root}/result.json`,JSON.stringify(summary,null,2));
  console.log('STATUE_IMPORT_RESULT '+JSON.stringify(summary));
 }catch(error){
  await prisma.product.deleteMany({where:{id:{in:created.map(row=>row.id)},stock:0,stockKg:0}});
  if(!await prisma.product.count({where:{categoryId:category.id}})) await prisma.category.delete({where:{id:category.id}});
  throw error;
 }
}finally{media.onModuleDestroy();pos.onModuleDestroy();await prisma.$disconnect();}
