/* Public browser configuration. This file is intentionally safe to serve.
 * 1. Run supabase/schema.sql in your project's SQL Editor.
 * 2. Copy the project URL and publishable (or legacy anon) key below.
 * NEVER put a secret key or service_role key in browser code.
 * See README.md for email confirmation and redirect URL setup.
 */
window.BASHFORUM_CONFIG = Object.freeze({
  mode: 'supabase', // Use 'demo' explicitly for the old, browser-only sandbox.
  url: '',         // Example: https://your-project.supabase.co
  publishableKey: '', // sb_publishable_... or the legacy anon JWT
});
