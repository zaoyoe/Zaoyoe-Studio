const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
    const { data, error } = await supabase
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'verify_settings')
        .single();

    console.log("Data:", JSON.stringify(data?.config_value, null, 2));
}
check();
