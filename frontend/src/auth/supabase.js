import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabaseConfigMissing = !supabaseUrl || !supabaseAnonKey;
if (import.meta.env.DEV && supabaseConfigMissing) {
	console.error('Supabase frontend configuration is missing. Expected VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
}
export const supabase = supabaseConfigMissing ? null : createClient(supabaseUrl, supabaseAnonKey);
