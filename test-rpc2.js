import { createClient } from '@supabase/supabase-js';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local'), override: false });

function readFirstEnv(names) {
    for (const name of names) {
        const value = String(process.env[name] || '').trim();
        if (value) return value;
    }
    return '';
}

const url = readFirstEnv([
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'PUBLIC_SUPABASE_URL'
]);
const key = readFirstEnv([
    'SUPABASE_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY'
]);

if (!url || !key) {
    console.log('Missing SUPABASE_URL or publishable key in .env.local');
    process.exit();
}

const supabaseAdmin = createClient(url, key);

async function testGuestbookRPC() {
    const { data, error } = await supabaseAdmin.rpc('fn_load_guestbook', {
        p_site: 'cn',
        p_limit: 5
    });
    console.log('RPC Result Type:', typeof data);
    console.log('Is Array?', Array.isArray(data));
    console.log('Data Object Keys:', Object.keys(data || {}));
    if (data?.messages) {
        console.log('Messages count:', data.messages.length);
    }
    if (data?.comments) {
        console.log('Comments count:', data.comments.length);
    }
    if (error) console.error('Error details:', error);
}

testGuestbookRPC();
