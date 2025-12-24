// Supabase Client - Browser Compatible Version
// This file is loaded directly in HTML without module bundler

// Supabase configuration
const SUPABASE_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

// Initialize Supabase client (using global supabase from CDN)
if (typeof supabase !== 'undefined' && supabase.createClient) {
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    console.log('✅ Supabase client initialized');
} else {
    console.error('❌ Supabase library not loaded. Make sure to include the CDN script first.');
}
