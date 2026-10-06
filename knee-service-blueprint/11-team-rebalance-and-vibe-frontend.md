# 11 — Hai người build local viewer

**Cập nhật 05/10/2026:** thay kế hoạch ngày 30/09 bằng local Docker, upload + viewer + một sample study gồm hai series, không auth và chưa AI/GCP. Scope ở [01](01-product-scope.md), trình tự kỹ thuật ở [12](12-local-docker-build-steps.md).

## 1. Ownership

| Người | Own | Người còn lại review |
|---|---|---|
| Người 1 — Data & Local Platform | FastAPI, upload/DICOM index, SQLite/worker, sample seed, Docker/storage/delete/recovery | Manifest, grouping, API và thao tác vận hành |
| Người 2 — Web & Viewer | React/Tailwind, Study list/upload dialog, Cornerstone DICOM viewer, layout/controls/error states | UI, đúng ảnh/hướng, lifecycle/memory |

Người 2 không còn đồng thời gánh checkpoint/Triton. Người 1 không cần dựng GCP/IAP. Cả hai có thể hỗ trợ task UI/contract nhỏ khi một lane bị chặn; không đổi owner mơ hồ giữa sprint.

## 2. Giả định và ngân sách

Hai người gần full-time, mỗi người 6 giờ tập trung/ngày × 10 ngày. Planned 50h/người, buffer 10h/người. Estimate là mục tiêu ban đầu, cần sửa sau spike D2; không giả định AI code nhanh 3–4 lần.

| Người | Phân bổ planned | Tổng |
|---|---|---:|
| Người 1 | Skeleton/DB/Compose 8h; DICOM upload/index/API 14h; seed/delete/storage/recovery 12h; QA/docs 10h; buffer 6h | 50h |
| Người 2 | Shell/list/upload 10h; DICOM stack/adapter 16h; layout/controls 14h; delete/error states/QA/docs 10h | 50h |

Buffer dành cho lỗi P0, không mặc định dùng thêm MPR/3D. Sample study cần được chốt sớm; `series_1` và `series_2` không phải hai study.

## 3. Lịch đề xuất

| Ngày | Người 1 | Người 2 | Gate |
|---|---|---|---|
| D1 | API/schema/Compose skeleton; inventory example; thống nhất format | React/Tailwind shell; API fixtures; supported renderer matrix | Freeze API v0.2, input policy; sample thiếu được ghi rõ |
| D2 | Upload DICOM/index/manifest một fixture | Cornerstone render một series thật, codec/lifecycle spike | Có stack đúng; nếu chưa đạt tập trung sửa adapter |
| D3 | Files API + import report + receipts/retry | Study list/upload nối thật; sidebar | Demo upload → 1 study/2 series của fixture → lướt ảnh |
| D4 | Seed manifest/version/checksum + example endpoint | Sample card + status; mở `series_1`/`series_2` | Sample study có thật render được; seed rerun không nhân bản |
| D5 | Duplicate/conflict/delete/metadata hoàn thiện | Delete confirmation/error states; DICOM controls | Upload xóa được; sample bị khóa; viewer P0 thao tác được |
| D6 | Recovery/limits; API error states | Study tree; 4 ô; zoom/pan/display preview; Analyze notice | Workflow xem ảnh P0 đầy đủ |
| D7 | Seed/restart/backup evidence | Empty/partial/unsupported states; keyboard/accessibility QA | Không mất dữ liệu, không ảnh sai nhãn |
| D8 | Restart recovery, disk cleanup; backup/restore | Cache/memory/orientation QA | Không mất dữ liệu, không treo job; không ảnh sai nhãn |
| D9 | Compose từ môi trường mới + seed rerun + fix | E2E DICOM/folder + build assets + fix | Sample study và upload đều chạy; RC |
| D10 | README local/runbook/version manifest | User guide và report/screenshots | Bàn giao local theo checklist 08 |

Mỗi ngày demo ngắn và review nằm trong ngân sách planned. Nếu D3 stack chưa đúng, ưu tiên dữ liệu/renderer trước nhân lên bốn ô. ZIP, MPR/3D và AI không được chen vào trước khi P0 local ổn định.

## 4. AI hỗ trợ code

Dùng để tạo shell/components, typed client, mock/error states, boilerplate. Review thủ công grouping/sort/geometry, file paths/ZIP limits, transaction/retry, viewer lifecycle. Typecheck/lint/build và fixture tests có ý nghĩa phải qua trước khi merge.

Giữ React StrictMode; init/cleanup đối xứng, unsubscribe và release resources thuộc viewport/study. Không gọi global cache purge khi còn viewport khác. Không nhúng DICOM/checkpoint vào bundle hoặc giả score để trang trông đầy đủ.

## 5. Điều kiện hoàn thành

- Có một đường upload → lưu → mở ảnh thật từ D3.
- Có một sample study thật gồm `series_1` và `series_2` trước nghiệm thu; không tách hai series thành hai ca.
- Chạy Compose không cần account/auth/GCP/model.
- Render và grouping được kiểm chứng, raw data/catalog qua restart và seed rerun không nhân bản.
- P1 MPR/3D/so đôi chỉ được nhận sau P0 và còn thời gian; không là lời hứa ngầm trong 10 ngày.
