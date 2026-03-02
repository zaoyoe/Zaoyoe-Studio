const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
    const { data, error } = await supabase.rpc('get_all_system_config');

    console.log("Keys:", data?.map(d => d.config_key));
    const verify = data?.find(d => d.config_key === 'verify_settings');
    console.log("Verify settings:", JSON.stringify(verify?.config_value, null, 2));
}
check();
