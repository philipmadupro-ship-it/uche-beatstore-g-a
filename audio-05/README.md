AUDIO-05 stem overlay, before (main) vs after, at 1440 and 390 wide (dsf 2).
States: processing, failed, ready. API responses are mocked in the browser.
Before: a failure is a transient toast and the overlay closes; no retry.
After: server-driven states; failed shows the stored error and Retry.
