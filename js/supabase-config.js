/**
 * supabase-config.js
 * ---------------------------------------------------------------------------
 * Fill these in from your Supabase project: Dashboard → Project Settings →
 * API. "Project URL" and the "anon public" key (NOT the service_role key —
 * that one must never appear in frontend code).
 * ---------------------------------------------------------------------------
 */
const SUPABASE_URL = 'https://uqnarpncyteymeeizxaf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_1TNrQKCIu03m7RT5uBGokg_oRFHfG2l';

const supabaseClient = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
