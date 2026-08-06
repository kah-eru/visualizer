# Progressive Activity Audit Feed

## Goal

Make every event selected by the existing Activity Audit Feed reachable without mounting an entire large monthly log in the DOM at once.

The feed currently searches and sorts the full filtered event set but renders only its first 1,500 rows. Real local logs contain more than 73,000 events, so simply removing the cap risks freezing the browser and repeating the performance failure that previously affected PDF export.

## Design

Keep `FEED_CAP` as the batch size rather than a permanent maximum. The first render shows up to 1,500 matching rows. When more remain, show a keyboard-accessible **Load 1,500 more** button below the rows, including the remaining count.

Activating the button increases the visible prefix by another batch and re-renders the same ordered result set while preserving the feed scroll position. The button disappears when every matching row is visible. The feed summary reports the visible and total counts instead of saying “first 1,500.”

This changes only the output limit. Existing behavior remains intact:

- search, filters, sorting, and alarm pinning operate over the full event set;
- duration-marker rows remain hidden unless the existing reveal path adds them;
- a timeline or scrubber jump can still force a row beyond the current batch into the feed immediately;
- row expansion and feed-to-timeline navigation keep their current behavior; and
- the printed report keeps the feed’s fixed-height clipping so loading more rows does not create dozens of print pages.

## Reset behavior

Reset the visible limit to one batch when the ordered result set changes because of:

- a newly loaded file;
- sidebar filters or Reset Filters;
- a feed search; or
- a feed sort change.

Do not reset it for timeline-only pan, zoom, scrubber, or window changes because those do not change the whole-log feed.

## Implementation shape

Add one module-level visible-limit value initialized to `FEED_CAP`. Include it in the feed render signature so requesting another batch cannot be skipped by the existing unchanged-content optimization.

`renderFeed` slices through the current visible limit, preserves the existing forced-reveal exception, renders the load-more control when needed, and updates `feedInfo`. The feed’s existing delegated click listener handles the new button; no per-row listener or dependency is added.

## Empty and edge cases

- Fewer than 1,500 matches render normally with no button.
- An exact multiple of 1,500 removes the button after the final batch.
- No matches keep the existing empty-search message.
- Forced revealed rows beyond the visible prefix are deduplicated when their normal batch is later loaded.
- The button label uses the smaller of 1,500 or the remaining count for its final batch.

## Verification

Extend the existing Playwright coverage with a generated CSV containing more than 1,500 eligible feed events. Verify that:

1. the initial summary and DOM show only the first batch;
2. a later event is initially absent;
3. activating **Load 1,500 more** makes that event available;
4. the visible/total summary advances correctly; and
5. changing search or sort resets the visible limit.

Run the existing Vitest suite and production build as regression checks. Update the in-app guide, `docs/HOW_TO_USE.md`, `docs/DEMO_GUIDE.md`, `NOTES.md`, and `AI_HANDOFF.md` where they describe the feed as permanently capped.

## Out of scope

- Rendering every event simultaneously by default.
- Pagination.
- Virtualization or variable-height row measurement.
- Changing which event types qualify for the feed.
