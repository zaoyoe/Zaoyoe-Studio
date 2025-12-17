import { supabase } from './supabase-client.js';

async function testConnection() {
    console.log('Testing Supabase connection...');

    // Try to select from a table that might not exist yet
    // If we get "relation does not exist" error, it means we CONNECTED successfully!
    // If we get "FetchError" or timeout, it means connection failed.
    const { data, error } = await supabase.from('profiles').select('*').limit(1);

    if (error) {
        if (error.code === '42P01') { // undefined_table
            console.log('✅ Connection SUCCESS! (Database is reachable, but tables are missing as expected)');
        } else {
            console.log('⚠️ Connection reached Supabase, but returned error:', error.message);
            console.log('Error Code:', error.code);
        }
    } else {
        console.log('✅ Connection SUCCESS! (Tables might already exist)');
    }
}

testConnection();
