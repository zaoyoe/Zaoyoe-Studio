const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const userId = '11111111-1111-4111-8111-111111111111';
const sourceId = '22222222-2222-4222-8222-222222222222';
const grantId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://www.fatherkey.com';
const jwt = () => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({sub:userId,session_id:sourceId,exp:Math.floor(Date.now()/1000)+600})).toString('base64url')}.offline`;
function response() {
    return { statusCode:200, headers:{}, body:'', status(c){this.statusCode=c;return this;},
        setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;}, end(v=''){this.body=v;},
        json(){return JSON.parse(this.body);} };
}
async function run(options, callback) {
    const target = path.resolve(__dirname, '../server/api-handlers/admin/access/session.js');
    const original = Module._load;
    const calls = [], audits = [], authOptions = [];
    const store = { async rpc(name, params) {
        calls.push({name, params});
        if (options.rpc) return options.rpc(name, params);
        return {data:true, error:null};
    }};
    const admin = {
        async requireAdmin(req, opts) {
            authOptions.push(opts);
            if(options.authError) throw options.authError;
            return {user:{id:userId}, supabase:store, adminSupabase:store,
                adminSession:{sourceSessionId:sourceId, expiresAt:options.exp || Math.floor(Date.now()/1000)+600}};
        },
        async getAdminStudioCookiePayload(){return options.cookie || null;},
        async getAuthenticatedUser(req, opts){
            assert.equal(opts.bearerOnly, true);
            return options.bearer ? {user:{id:userId},token:jwt()} : {user:null,error:options.bearerError};
        },
        getSupabaseAdmin(){return store;},
        async writeAdminAuditLog(entry){audits.push(entry);return options.audit !== false;},
        sendJson(res, code, payload){res.status(code).end(JSON.stringify(payload));}
    };
    process.env.ADMIN_STUDIO_ACCESS_SECRET = 'offline-handler-secret';
    process.env.ADMIN_STUDIO_ACCESS_TTL_SECONDS = '120';
    const savedEnv = {};
    for(const [k,v] of Object.entries({NODE_ENV:'test', VERCEL_ENV:'', APP_ENV:'', DEPLOYMENT_TIER:'', RAILWAY_ENVIRONMENT_NAME:'', ...options.env})) {
        savedEnv[k]=process.env[k]; process.env[k]=v;
    }
    delete require.cache[target];
    Module._load = function(name, parent, main){
        return name === '../../../../api/_lib/admin' ? admin : original.call(this,name,parent,main);
    };
    let handler;
    try {handler = require(target);} finally {Module._load = original;}
    try {await callback(handler, {calls,audits,authOptions});}
    finally {
        delete require.cache[target];
        for(const [k,v] of Object.entries(savedEnv)) {if(v===undefined) delete process.env[k]; else process.env[k]=v;}
    }
}
function request(method='POST', headers={}) {return {method, headers:{origin,...headers}, socket:{remoteAddress:'127.0.0.1'}};}
test('session issuance persists a grant and audit before a bounded secure cookie', async () => {
    await run({}, async (handler, state) => {
        const res=response(); await handler(request('POST',{'user-agent':'offline-test',host:'verify-api.fatherkey.com'}),res);
        assert.equal(res.statusCode,200); assert.equal(res.json().expiresInSeconds,120);
        assert.match(res.headers['set-cookie'],/HttpOnly; Secure; SameSite=Strict/);
        assert.match(res.headers['set-cookie'],/Max-Age=120/);
        assert.equal(res.headers['cache-control'],'no-store');
        assert.equal(state.authOptions[0].bearerOnly,true);
        assert.equal(state.calls[0].name,'admin_studio_session_create');
        const token=decodeURIComponent(res.headers['set-cookie'].split(';')[0].split('=').slice(1).join('='));
        const payload=await (await import('../api/_lib/admin-studio-access.mjs')).verifyAdminStudioToken(token);
        assert.equal(payload.sub,userId); assert.equal(payload.sid,state.calls[0].params.p_id);
        assert.equal(state.audits[0].actionType,'admin.access.session.issue');
        assert.equal(state.audits[0].details.user_agent,'offline-test');
        assert.equal('admin_email' in state.audits[0].details,false);
    });
});
test('session cookie never outlives the verified bearer', async () => {
    await run({exp:Math.floor(Date.now()/1000)+30},async(handler)=>{
        const res=response(); await handler(request(),res);
        assert.equal(res.statusCode,200); assert.ok(res.json().expiresInSeconds<=30);
    });
});
test('failed grant creation or unavailable RPC never emits a cookie',async()=>{
    for(const result of [{data:false}, {error:{message:'private DB details'}}, null]) {
        await run({rpc:async()=>result},async(handler)=>{
            const res=response(); await handler(request(),res);
            assert.equal(res.statusCode,result?.data===false?401:503);
            assert.equal(res.headers['set-cookie'],undefined);
            assert.doesNotMatch(res.body,/private DB details/);
        });
    }
});
test('failed audit discards only the new grant and refuses issuance',async()=>{
    await run({audit:false},async(handler,state)=>{
        const res=response();await handler(request(),res);
        assert.equal(res.statusCode,503);assert.equal(res.headers['set-cookie'],undefined);
        assert.deepEqual(state.calls.map(x=>x.name),['admin_studio_session_create','admin_studio_session_discard']);
        assert.equal(state.calls[0].params.p_id,state.calls[1].params.p_id);
    });
});
test('DELETE revokes both cookie and bearer sources before clearing cookie',async()=>{
    await run({cookie:{sub:userId,sid:grantId},bearer:true},async(handler,state)=>{
        const res=response();await handler(request('DELETE'),res);
        assert.equal(res.statusCode,200);assert.match(res.headers['set-cookie'],/Max-Age=0/);
        assert.equal(state.calls.length,2);
        assert.deepEqual(state.calls[0],{name:'admin_studio_session_revoke',params:{p_user_id:userId,p_id:grantId,p_source_session_id:null}});
        assert.deepEqual(state.calls[1],{name:'admin_studio_session_revoke',params:{p_user_id:userId,p_id:null,p_source_session_id:sourceId}});
        assert.equal(state.authOptions.length,0);
    });
});
test('DELETE reports failed revocation and unavailable Auth instead of false success',async()=>{
    for(const options of [
        {cookie:{sub:userId,sid:grantId},rpc:async()=>({data:false})},
        {bearerError:{statusCode:503}}
    ]) await run(options,async(handler)=>{
        const res=response();await handler(request('DELETE'),res);
        assert.equal(res.statusCode,503);assert.equal(res.headers['set-cookie'],undefined);
    });
});
test('DELETE with no usable credentials can clear an already invalid cookie',async()=>{
    await run({},async(handler)=>{
        const res=response();await handler(request('DELETE'),res);
        assert.equal(res.statusCode,200);assert.equal(res.json().cleared,true);
    });
});
test('session mutations reject absent, malformed and untrusted origins',async()=>{
    for(const method of ['POST','DELETE']) for(const untrusted of ['', 'null','https://www.fatherkey.com.evil.test','http://localhost.evil.test:8000','https://www.fatherkey.com/']) {
        await run({},async(handler,state)=>{
            const res=response();await handler(request(method,{origin:untrusted,host:'localhost.evil.test:8000'}),res);
            assert.equal(res.statusCode,403);assert.equal(state.calls.length,0);
        });
    }
});
test('TG canonical admin origin can issue and revoke sessions',async()=>{
    await run({env:{NODE_ENV:'production'}},async(handler)=>{
        for(const method of ['POST','DELETE']) {
            const res=response();
            await handler(request(method,{origin:'https://tg-adm.fatherkey.com',host:'tg-adm.fatherkey.com'}),res);
            assert.equal(res.statusCode,200);
            assert.match(res.headers['set-cookie'],/Secure/);
        }
    });
});
test('retired and lookalike TG admin origins cannot mutate sessions',async()=>{
    for(const origin of ['https://tg.adm.fatherkey.com','https://tg-adm.fatherkey.com.evil.test','https://tg-adm.fatherkey.com/','http://tg-adm.fatherkey.com']) {
        await run({env:{NODE_ENV:'production'}},async(handler,state)=>{
            for(const method of ['POST','DELETE']) {
                const res=response();
                await handler(request(method,{origin,host:'tg-adm.fatherkey.com'}),res);
                assert.equal(res.statusCode,403);
            }
            assert.equal(state.calls.length,0);
        });
    }
});
test('only exact same-origin local preview HTTP gets a nonsecure cookie',async()=>{
    await run({},async(handler)=>{
        for(const method of ['POST','DELETE']) {
            const res=response();await handler(request(method,{host:'127.0.0.1:8000',origin:'http://127.0.0.1:8000'}),res);
            assert.equal(res.statusCode,200);assert.doesNotMatch(res.headers['set-cookie'],/Secure/);
        }
        const res=response();await handler(request('POST',{host:'127.0.0.1:8001',origin:'http://127.0.0.1:8000'}),res);
        assert.equal(res.statusCode,403);
    });
    await run({env:{NODE_ENV:'production'}},async(handler)=>{
        const res=response();await handler(request('POST',{host:'127.0.0.1:8000',origin:'http://127.0.0.1:8000'}),res);
        assert.equal(res.statusCode,403);
    });
});
test('forbidden admins are denied and only POST/DELETE are accepted',async()=>{
    await run({authError:Object.assign(new Error('Admin access required'),{statusCode:403})},async(handler)=>{
        const res=response();await handler(request(),res);assert.equal(res.statusCode,403);assert.equal(res.headers['set-cookie'],undefined);
        const get=response();await handler(request('GET'),get);assert.equal(get.statusCode,405);assert.equal(get.headers.allow,'POST, DELETE');
    });
});
