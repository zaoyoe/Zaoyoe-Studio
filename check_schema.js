
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = 'https://auth.zaoyoe.com';
const SUPABASE_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkSchema() {
    const { data, error } = await supabase
        .from('points_ledger')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Keys:', data && data.length > 0 ? Object.keys(data[0]) : 'No data found');
    }
}

checkSchema();

