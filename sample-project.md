# PRD — Phase P0: Onboarding & Identity

## Overview
We need a trustworthy entry path that verifies a user’s phone number, onboards their identity, and seeds default privacy and notification preferences before exposing the main app shell. Until this funnel is reliable, downstream features lack a vetted identity graph.

## Goals & Success Metrics
- **OTP conversion:** ≥90% of attempted signups complete phone verification within 2 minutes.
- **Profile completion:** ≥85% of verified accounts finish name + avatar + nickname setup in one session.
- **Settings coverage:** 100% of activated users write `users/{uid}/settings` before entering the main navigator.
- **Error clarity:** <2% of OTP failures lack a localized, user-readable explanation logged with an error code.

## Target Users & Jobs-to-be-Done
- New invitees who must verify their phone number to start using Audyo.
- Returning power users expecting their profile/preferences to hydrate automatically.
- Support agents who need auditability of verification attempts.

## In Scope
- Phone auth flows across `app/(auth)/signup.tsx` and `verifyotp.tsx` using Firebase auth + reCAPTCHA.
- Profile creation UI + Cloud Function (`functions/userController`) that persists name, avatar, nickname.
- Default privacy/notification capture in `welcome.tsx`, stored under `users/{uid}/settings`.
- Error handling + retry UX, including blocked numbers or throttled attempts.

## Out of Scope
- Contact syncing beyond validating the primary phone number.
- Voice tag recordings (handled by P0-05 Voice Tag epic).
- Admin tooling for manual account creation.

## Feature Slices
1. **Phone-auth signup & OTP verification**
   - Requirements: Input validation, reCAPTCHA, resend throttling, analytics events for each attempt.
   - Acceptance: Verification tokens create Firebase users; failures surface actionable copy; retry available after cooldown.
2. **Profile creation service**
   - Requirements: Upload avatar, capture name/nickname, call `userController` to persist; handle partial state.
   - Acceptance: `users/{uid}` documents populated atomically; subsequent launches read profile without prompts.
3. **Default settings capture**
   - Requirements: UI toggles for read receipts, tagging permissions, notification categories; writes to `users/{uid}/settings`.
   - Acceptance: Main navigator only unlocks after settings exist; telemetry logs chosen defaults.

## User Flows & States
- Happy path: Phone input → OTP entry (auto-read where allowed) → profile form → avatar upload → nickname → privacy defaults → success screen → home gating.
- Edge cases: Code timeout, invalid OTP, blocked numbers, lost connection mid-profile; flows must support resume.

## Dependencies & Sequencing
- Requires Firebase project + SMS sender configured.
- Downstream epics depend on user documents existing with profile + settings; this epic must ship before contacts or messaging alpha.

## Non-Functional Requirements
- OTP latency P95 <6s, retries limited to 5 per hour per phone.
- Network errors mapped to consistent `AuthError` types; logs emit user ID + timestamp for auditing.
- Accessibility: screens navigable via screen reader, focus order logical.

## Analytics & Experimentation
- Instrument funnel events: `auth_phone_submit`, `auth_otp_success`, `profile_complete`, `settings_seeded`.
- Dashboard monitors drop-off per step; alert if conversion dips >5% day-over-day.
- Run copy tests on OTP error states once baseline is stable.

## Rollout & Launch Criteria
- Internal dogfood with 50 testers; must hit ≥90% OTP success before widening.
- Launch blocked until recovery/resume tested on iOS + Android.
- GA when funnel metrics are stable for 7 consecutive days and support tickets for verification <2/day.

## Open Questions & Risks
- Need final decision on allowable virtual numbers/VOIP.
- Risk of SMS provider throttling in new regions—contingency queue required.
- Should we prefetch contacts during waiting periods to hide latency? Requires privacy review.
