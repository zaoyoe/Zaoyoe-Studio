import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
    console.log('Missing env variables');
    process.exit();
}

const supabaseAdmin = createClient(url, key);

async function testGuestbookRPC() {
    const { data, error } = await supabaseAdmin.rpc('fn_load_guestbook', {
        p_site: 'cn',
        p_limit: 5
    });
    console.log('RPC Result:', typeof data, Array.isArray(data));
    console.log('Data structure:', Object.keys(data || {}));
    if (error) console.error('Error:', error);
}

testGuestbookRPC();
