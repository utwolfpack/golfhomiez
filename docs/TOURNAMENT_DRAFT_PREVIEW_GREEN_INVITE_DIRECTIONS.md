# Green Invitation Template and Historical Draft Preview Notes

## Current status

The Green Invitation flyer template remains available as `green-invite` and continues to use the uploaded `DefaultGolfBanner.jpg` fallback behavior introduced with this feature set.

The authenticated **draft flyer preview feature described in the original version of this document has been removed** by the later tournament-template polish update. Hosts and organizers no longer receive `Preview saved draft flyer` or `Open preview` actions, and the public tournament API/QR-code routes no longer accept host or organizer draft-preview query parameters.

Draft tournaments remain non-public until they are published. Published and completed tournament pages continue to use their normal public tournament URLs.

See:

```text
docs/TOURNAMENT_TEMPLATE_POLISH_AND_REGISTRATION_DEADLINE_DIRECTIONS.md
```

for the current implementation and deployment details.

## Green Invitation template

The available template remains a cream-and-green invitation layout inspired by the supplied reference flyer. It uses the same existing tournament data and persists through `tournaments.template_key`; no dedicated schema was added for the template.

The default tournament banner remains:

```text
public/DefaultGolfBanner.jpg
```

The template continues to support host/organizer editing, printing, responsive rendering, built-in image fallbacks, and the light-blue `Auto-create team schedule` action introduced in the same feature sequence.
