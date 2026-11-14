// lib/passwordRules.js
//
// The app's view of the password rules. The rules themselves live with the
// server (netlify/functions/lib/passwordRules.js) so the sign-up form, the
// reset page and complete-password-reset can never disagree.

export { validatePassword, MIN_LENGTH, MAX_LENGTH } from '@/netlify/functions/lib/passwordRules';
