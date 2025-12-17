import { createClient } from '@supabase/supabase-js';

// ⚠️ REPLACE WITH YOUR ACTUAL KEYS FROM SUPABASE DASHBOARD
const SUPABASE_URL = 'https://mmkugdibsaeoevliebzk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lwkiF-sQ80z8e9oMcejFPQ_j7oezjcF';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log('Supabase client initialized');
