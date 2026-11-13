/**
 * Email templates for MySetlists notifications.
 *
 * Since 5.59.6 every template lives with the server, which is the only
 * place emails are built: the browser sends send-email a type and the ids
 * (lib/email.js), never HTML. This module re-exports them so app code that
 * previews an email (the admin Welcome card) renders the very same HTML.
 *
 *   netlify/functions/lib/notificationTemplates.js  tags, invites, nudges, …
 *   netlify/functions/lib/welcomeEmailTemplate.js   the welcome email
 *   netlify/functions/lib/yearRecapEmail.js         Year in Review
 */

export {
  inviteEmail,
  friendJoinedEmail,
  tagByEmailNotification,
  showTagNotification,
  tagAcceptedEmail,
  suggestionNudgeEmail,
  engagementNotificationEmail,
  venueVerificationSubmittedEmail,
  venueVerificationApprovedEmail,
  venueVerificationRejectedEmail,
} from '@/netlify/functions/lib/notificationTemplates';

export { welcomeEmail, SAMPLE as WELCOME_SAMPLE, SAMPLES as WELCOME_SAMPLES } from '@/netlify/functions/lib/welcomeEmailTemplate';
