# Profile Email Display

## Overview

The golfer profile page displays the email address associated with the authenticated Golf Homiez account directly above the Phone field.

## Behavior

`src/pages/Profile.tsx` loads the email from the profile response and uses the authenticated session email as a fallback. The Email value is rendered as a non-editable text label rather than an input field. The golfer can view and copy the account address without presenting it as an editable profile attribute or changing the authentication identity from the profile form.

The profile save payload remains unchanged and does not include an email attribute. Email changes must continue to use the application's account/authentication workflow rather than the editable profile endpoint.

## Logging

The frontend emits `profile_email_displayed_read_only` with the transaction correlation ID, whether an email value was available, and whether the displayed value came from the profile response or session fallback. The actual email address is not written to the frontend event data.

## Deployment

Copy `src/pages/Profile.tsx` and `src/index.css` to the same relative paths and deploy using the normal application workflow. No database migration, environment variable, port change, or npm dependency is required.
