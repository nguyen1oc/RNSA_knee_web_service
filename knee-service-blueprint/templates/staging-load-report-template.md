# Staging load-test report

Status: NOT_RUN
Run date/time (UTC): …
Operator / reviewer: …

## Build and fixture

- Git commit / branch: …
- API Cloud Run revision: …
- Triton Cloud Run revision / image digest: …
- Fixture: `sample-knee` (confirm de-identified); no upload performed
- Region: `asia-southeast1`
- API and Triton configuration (CPU/RAM/GPU, min/max instances, concurrency): …
- k6 version / generator machine and network: …

## Scenario

- Scenario: health / cold Analyze / warm Analyze / concurrency
- Virtual users: …
- Analyze iterations per VU: …
- Start/end UTC: …
- Cold or warm: …
- Gate: staging only; token is not included in this report

## k6 results

| Metric | Value | Notes |
|---|---:|---|
| Requests / iterations | … | |
| Throughput (requests/s) | … | |
| Success / error rate | … | Include HTTP status counts |
| Analyze p50 | … | `analyze_duration` |
| Analyze p95 | … | `analyze_duration`; include sample count |
| Analyze p99 | … | `analyze_duration`; include sample count |
| Timeout / 5xx / 429 | … | |

Attach or link the generated `k6-summary.json`. Do not include cookies, gate tokens, DICOM files, or patient-identifying data.

## Cloud Monitoring observations

Console time range: …; API service: `knee-review-api-staging`; Triton service: `knee-triton-staging`.

| Service | Request latency/count | Instances | CPU | Memory | GPU utilization/memory | Startup latency |
|---|---|---:|---:|---:|---:|---:|
| API staging | … | … | … | … | N/A | … |
| Triton staging | … | … | … | … | … | … |

Logs Explorer findings (timeouts/errors and `analysis_timing` events): …

## Timing breakdown and conclusion

| Timing | p50 | p95 | n | Notes |
|---|---:|---:|---:|---|
| End-to-end Analyze (k6) | … | … | … | Cold and warm reported separately |
| API preprocessing | … | … | … | From `analysis_timing` structured payload |
| Triton round-trip | … | … | … | Includes API→Triton request/response; not pure GPU kernel time |

- Errors / saturation observed: …
- First limiting resource: …
- Decision: keep current limits / investigate / change one setting and repeat
- Evidence links: …

Do not claim a maximum user count from a short test. State the tested workload, success criteria, and observed failure/saturation point.
