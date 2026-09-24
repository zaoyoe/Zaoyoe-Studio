const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

function response() { const s={status:200,body:''}; return {status(c){s.status=c;return this},setHeader(){return this},end(b=''){s.body=String(b);},get statusCode(){return s.status},json(){return JSON.parse(s.body)}}; }
const ADMIN='11111111-1111-4111-8111-111111111111';
const ORDER='22222222-2222-4222-8222-222222222222';
async function load(state, cb) {
 const hp=path.resolve(__dirname,'../server/api-handlers/admin/payments/shop-refund-reconcile.js'); const orig=Module._load;
 state={rpc:[],audit:[],...state};
 Module._load=function(req,parent,isMain){ if(req==='../../../../api/_lib/admin') return {
   normalizeAdminSite:v=>String(v||'').toLowerCase(),
   parseJsonBody:async req=>req.body,
   requireAdmin:async()=>{if(state.authError)throw state.authError; const adminSupabase={from(t){const b={select(){return b},eq(){return b},maybeSingle:async()=>t==='guest_shop_orders'?{data:state.order,error:null}:{data:state.payment,error:null}}; return b},rpc:async(n,p)=>{state.rpc.push({n,p});return state.rpcResult||{data:[{order_id:ORDER,refund_status:'succeeded',payment_status:'refunded',fulfillment_status:'delivered',provider_ref:p.p_provider_ref}],error:null}}}; return {adminSupabase,user:{id:ADMIN}}},
   sendJson:(res,status,p)=>{res.status(status).end(JSON.stringify(p))},
   writeAdminAuditLog:async e=>state.audit.push(e)
 }; return orig.call(this,req,parent,isMain)};
 delete require.cache[hp]; let h; try{h=require(hp)}finally{Module._load=orig} try{return await cb(h,state)}finally{delete require.cache[hp]}
}
const base={order:{id:ORDER,order_no:'GS-1',site:'cn',refund_status:'manual_review',payment_status:'confirmed',fulfillment_status:'delivered'},payment:{id:'p',refund_provider_ref:null,status:'review'}};
test('reconcile requires confirmation and manual_review',async()=>{await load(base,async(h,s)=>{let r=response();await h({method:'POST',body:{orderId:ORDER,providerRef:'tx',reason:'已在 provider 后台核对并全额退款'}},r);assert.equal(r.statusCode,400);assert.equal(r.json().code,'guest_admin_confirm_required');r=response();await h({method:'POST',body:{confirm:true,orderId:ORDER,providerRef:'tx',reason:'已在 provider 后台核对并全额退款'}},r);assert.equal(r.statusCode,200);assert.equal(s.rpc.length,1);assert.equal(s.rpc[0].n,'fn_guest_shop_record_refund_result');assert.equal(s.rpc[0].p.p_refund_status,'succeeded');assert.equal(s.audit.length,1)})});
test('reconcile rejects provider reference conflict',async()=>{await load({order:{...base.order},payment:{...base.payment,refund_provider_ref:'other'}},async(h)=>{const r=response();await h({method:'POST',body:{confirm:true,orderId:ORDER,providerRef:'tx',reason:'已在 provider 后台核对并全额退款'}},r);assert.equal(r.statusCode,409);assert.equal(r.json().code,'guest_refund_provider_ref_conflict')})});
test('reconcile is idempotent after succeeded',async()=>{await load({order:{...base.order,refund_status:'succeeded',payment_status:'refunded'},payment:base.payment},async(h,s)=>{const r=response();await h({method:'POST',body:{confirm:true,orderId:ORDER,providerRef:'tx',reason:'已在 provider 后台核对并全额退款'}},r);assert.equal(r.statusCode,200);assert.equal(r.json().idempotent,true);assert.equal(s.rpc.length,0)})});
