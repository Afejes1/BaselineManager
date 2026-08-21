# Synthetic Lockheed daily delivery

These files exercise the governed multi-file intake at `/intake/lockheed-daily`.
They are synthetic demonstration data, not program data.

1. Load all four files in `day-01` with source date `2026-08-20`.
2. Review the detected dataset for each file and apply the delivery.
3. Load all four files in `day-02` with source date `2026-08-21`.
4. Inspect `A2O-401838` and `MCP-122` to see schedule, ROM, completion,
   status, and dependency changes.

Loading the same files again with the same source date is a no-op. A record
absent from a later file is retained in history and is not treated as deleted.
