# INC-1: checkout answered HTTP 500 to most payments

## Summary

From 10:02 UTC the checkout service failed about 70 % of payments with HTTP 500. The release checkout v2.4.1
(deployed 10:01:30 UTC) changed `PAYMENTS_TIMEOUT_MS` from 2000 to 200, so every call to payments-gw that took longer
than 200 ms timed out.

## Impact

81 failed checkouts in the logs between 10:02 and 10:19 UTC (runbook step 1 counted 83 HTTP 500s; 2 of them came
from the stock service and are unrelated).

## Timeline

- 10:01:30 UTC — checkout v2.4.1 deployed (`PAYMENTS_TIMEOUT_MS 2000 -> 200`).
- 10:02:03 UTC — first `500 … upstream=payments-gw error="timeout after 200ms"`.
- 10:19 UTC — errors continue (end of the log).

## Root cause

The 200 ms payments timeout of release v2.4.1. Evidence: runbook step 2 shows payments-gw as the failing upstream (81
of 83 errors), every one `timeout after 200ms`; before 10:02 the same calls took 180–420 ms and succeeded; step 3
shows v2.4.1 deployed at 10:01:30, just before the first error. The stock 503s (2) and the stock release at 10:30 are
not related.

## Actions

- Roll back checkout to v2.4.0 or restore `PAYMENTS_TIMEOUT_MS=2000` (owner: ).
- Add a config check that rejects a payments timeout below the gateway's p99 (owner: ).
