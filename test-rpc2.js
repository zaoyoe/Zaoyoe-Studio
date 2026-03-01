import { createClient } from '@supabase/supabase-js';

const url = 'https://auth.zaoyoe.com';
// Need to find the key
import fs from 'fs';
const fileContent = fs.readFileSync('guestbook.html', 'utf-8');
const keyMatch = fileContent.match(/const SUPABASE_KEY = ['"]([^'"]+)['"]/);

if (!keyMatch) {
    console.log('Failed to parse Supabase Key from guestbook.html');
    process.exit();
}

const supabaseAdmin = createClient(url, keyMatch[1]);

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
