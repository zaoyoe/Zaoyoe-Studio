import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
    console.log('Missing env variables');
    process.exit();
}

const supabaseAdmin = createClient(url, key);

async function checkConfig() {
    const { data, error } = await supabaseAdmin.from('system_config').select('*').eq('config_key', 'rewards');
    console.log('Result:', JSON.stringify(data, null, 2));
    if (error) console.error('Error:', error);
}

checkConfig();
