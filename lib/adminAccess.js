// lib/adminAccess.js — who sees admin UI (5.59.12).
//
// UX ONLY. It decides whether admin links, tabs and moderation buttons are
// shown; it protects nothing. Every admin action is enforced on the server
// (isAdmin in netlify/functions/lib/firebaseAdmin.js) and in the rules
// (isAdmin() in firestore.rules), which also accept the `admin` custom
// claim. This mirrors their email half: the allowlisted address, verified.

import { ADMIN_EMAILS } from '@/lib/constants';

export function isAdminUser(user) {
  return !!user && user.emailVerified === true && ADMIN_EMAILS.includes(user.email);
}
