/**
 * passwordRules — the one statement of what a MySetlists password must be
 * (5.60.0). The sign-up form, the reset page and complete-password-reset
 * all check with validatePassword(), so a password the browser accepts is
 * one the server accepts.
 *
 * CommonJS so functions can require it; the app imports it through
 * lib/passwordRules.js (webpack takes CommonJS, as with emailLayout.js).
 *
 * These are the rules SignupForm.js has enforced since email sign-up
 * shipped. Changing them is a product decision, not a refactor.
 */

const MIN_LENGTH = 8;
// Firebase Auth refuses longer passwords on some paths, and nothing
// legitimate needs more. Also bounds the work a hostile request can cause.
const MAX_LENGTH = 128;

/** An error message, or null when the password is acceptable. */
function validatePassword(pwd) {
  if (typeof pwd !== 'string') return 'Enter a password';
  if (pwd.length < MIN_LENGTH) return `Password must be at least ${MIN_LENGTH} characters`;
  if (pwd.length > MAX_LENGTH) return `Password must be at most ${MAX_LENGTH} characters`;
  if (!/[A-Z]/.test(pwd)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(pwd)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain a number';
  return null;
}

module.exports = { validatePassword, MIN_LENGTH, MAX_LENGTH };
