# Test report — ngày / release

Status: NOT_RUN. Người chạy: … Reviewer: … Phase: LOCAL_VIEWER (hiện hành) / AI (sau).

## Environment

FE/API/worker image version: …; browser/OS: …; Docker version/volume: …; RAM/browser GPU: …; fixture IDs/checksums/source_kind: …; model/GCP: NOT_APPLICABLE trong phase local.

## Kết quả

| Test ID | Fixture | Expected | Actual | PASS/FAIL/NOT_RUN | Evidence | Owner |
|---|---|---|---|---|---|---|
| L01 | Chưa điền | Một sample study mở được `series_1`/`series_2` | Chưa chạy | NOT_RUN | Chưa có | Người 1 |

## Parity AI — NOT_APPLICABLE cho phase local

Offline reference/version: …; số case: …; atol/rtol: …; series/frame/mask match: …; max tensor difference: …; max score difference: …; target order: …; aggregation semantics: …

## Hiệu năng

Tách cold/warm, upload/index/decode/preprocess/infer, queue wait. Ghi số mẫu và p50/p95 khi đủ mẫu; không gọi một lần chạy là p95.

| Metric | Dataset/machine | n | Result | Target | Ghi chú |
|---|---|---|---|---|---|
| Cached slice switch | Chưa điền | 0 | NOT_RUN | p95 ≤100ms | … |

## Restart / backup / examples

Kịch bản kill/restart: …; recovery: …; backup/restore: …; seed rerun không nhân bản: …; sample mở được hai series: …; delete upload/sample read-only: …; chỉ localhost port: …; không auth gate: …

## Known issues và quyết định bàn giao

Issue/severity/owner/impact/workaround. Kết luận: BLOCKED / READY_FOR_DEMO / READY_WITH_LIMITATIONS; reviewer xác nhận bằng chứng. Không dùng kết luận này để tuyên bố sẵn sàng lâm sàng.
