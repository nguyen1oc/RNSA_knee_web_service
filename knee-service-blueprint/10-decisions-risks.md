# 10 — Quyết định, giả định và nguồn

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; các quyết định hiện hành được giữ nguyên.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

## Quyết định hiện hành 05/10/2026

Các quyết định này ưu tiên hơn bảng lịch sử bên dưới. Scope local được yêu cầu trực tiếp: không tạo tài khoản, không auth, chưa làm model/GCP.

| ID | Quyết định | Tác động |
|---|---|---|
| ADR-15 | Local Docker trước: web/api/index worker/seed | Thay lịch AI/cloud tại ADR-14; dùng file 11–12 hiện hành |
| ADR-16 | Không auth/IAP/dev identity, catalog chung | Thay ADR-13; không principals/owner checks, chỉ publish localhost |
| ADR-17 | DICOM `.dcm` files/folders for local P0; ZIP deferred | Validate header/pixel; không giả geometry/FS/fluid |
| ADR-18 | Một sample study có `series_1`/`series_2` qua seed idempotent | Source read-only ngoài image, DB/raw trong named volume |
| ADR-19 | Checkpoint, aggregation, Triton, GCP hoãn | ADR-04/05/10 không còn blocker phase local |
| ADR-20 | Study giữ đến khi xóa, staging incomplete 24h | Thay TTL study 7 ngày tại ADR-11 |

### Rủi ro cần giải quyết trong phase local

| Vấn đề | Bằng chứng / quyết định | Owner |
|---|---|---|
| Sample chưa seed đúng | 64 files ở hai folder thuộc một StudyInstanceUID; phải giữ thành một study có hai series | Người 1 |
| Raster mất geometry | Group/sort theo file13, UNKNOWN metadata, không MPR/thước mm | Người 1+2 |
| Codec chưa decode được | Single-frame LE là baseline; chỉ thêm format sau fixture render test | Người 2 |
| SQLite trong OneDrive | Dùng named volume, không DB trong workspace sync | Người 1 |
| Crash/duplicate seed | Unique version/checksum, transactional index, restart test | Người 1 |

## Bản ghi trước 05/10 — lịch sử/tham khảo phase sau

Các trạng thái “đã chốt” và owner cloud/model bên dưới là quyết định tại thời điểm cũ, không yêu cầu triển khai local hiện hành.

## Decision log

“Đề xuất” chưa có nghĩa người dùng đã duyệt hay code đã tồn tại. Người phụ trách điền ngày và bằng chứng khi chốt. Ownership hiện hành theo file 11.

| ID | Quyết định | Trạng thái | Owner / hạn |
|---|---|---|---|
| ADR-01 | React + Tailwind, FastAPI, Triton, GCP | Yêu cầu người dùng | Người 1+2 |
| ADR-02 | 2 người, mục tiêu ≤2 tuần | Yêu cầu người dùng; lịch giả định full-time | Người 1+2 D1 |
| ADR-03 | Cornerstone3D cho ảnh; custom React shell | Đề xuất | Người 2 D1 |
| ADR-04 | Checkpoint và schema 4/6 slot | **Chưa chốt, blocker inference** | Người 2 D1 |
| ADR-05 | Quy tắc aggregate score single-study | **Chưa chốt, blocker score** | Người 2 D2 |
| ADR-06 | SQLite + persistent disk + single worker | Đề xuất cho demo một VM | Người 1 D1 |
| ADR-07 | Native 4 ô P0; MPR/locator P1 conditional; volume 3D nâng cao P2 | Đề xuất phạm vi; cần xác nhận nếu 3D bắt buộc | Người 1+2 D2 |
| ADR-08 | Light theme trắng/xám nhạt, accent xanh y tế; nền viewport 3D/2D xám sáng, Noto Sans | Theme sáng cả viewport theo phản hồi người dùng; không sửa pixel MRI | Người 2 D1 |
| ADR-09 | Codec/multi-frame supported matrix | Chưa chốt, dựa fixture thật | Người 1+2 D2 |
| ADR-10 | GPU VM/region/budget/domain | Chưa chốt, cần quyền/quota | Người 1 D1–2 |
| ADR-11 | Study TTL 7 ngày, upload tạm 24h | Đề xuất demo | Người 1 D1 |
| ADR-12 | Viewer tham chiếu | Chưa có link đích; Safe Links không phải viewer | Người 2 khi có link |
| ADR-13 | Cloud auth dùng IAP; local dev bypass chỉ localhost; không custom password/token | Đã chốt trong kế hoạch thực thi 11 | Người 1 D1/D7 |
| ADR-14 | Ownership/lịch file 11 thay thế file 07; chia Study Platform và Viewer & Inference | Đã rà soát 30/09/2026 | Người 1+2 |

## Risk register

| Rủi ro | Dấu hiệu sớm | Cách xử lý trong scope | Owner |
|---|---|---|---|
| Gộp sai slot/series | Viewer dùng FS-only nhưng checkpoint dùng fluid/T1 | Version model contract riêng, không theo UI grid | Người 2 |
| Dữ liệu không dựng volume tốt | Lát dày/gap/geometry lẫn | Gate D2, native viewer + lý do, fixture phù hợp cho MPR | Người 1+2 |
| Rank aggregation phụ thuộc cohort | Score ca thay đổi khi thêm ca khác | Xác minh serving semantics, version và đánh giá lại | Người 2 |
| DICOM ngoài codec hỗ trợ | Decode fail trên fixture | Pin codec, test matrix, unsupported rõ | Người 1+2 |
| Quota/cloud trễ | Không tạo được GPU D1 | Ưu tiên xin quota; có GPU local thì kiểm tra model local, không hứa cloud xong | Người 1 |
| Người 2 quá tải model + viewer | Model parity hoặc vertical slice chưa đạt gate D3 | Người 1 giữ API/manifest ổn định; bỏ P1/P2, dùng buffer và review chéo | Người 1+2 |
| Metadata bệnh viện khác dataset | Không có CSV FS/fluid | Nullable + rule provenance/manual selection; chặn model khi không đủ căn cứ | Người 1+2 |
| Memory browser quá cao | Nhiều volume đồng thời | Cache cap, lazy decode, release, fallback stack | Người 2 |
| Kết quả bị hiểu thành chẩn đoán | UI ghi “xác suất bệnh” chưa calibration | model_score + giới hạn; không tạo lesion overlay giả | Người 1+2 |

## Hiện trạng đã đọc, không phải thẩm định code

- [Viewer local README](../dicom-viewer/README.md): import local, không server inference; uncompressed grayscale, chưa hỗ trợ compressed/multi-frame theo tài liệu.
- [Slot insights](../slides/SLOT_INSIGHTS.md): sáu nhóm plane × FS, một slot có nhiều candidate.
- [Overview](../RSNA_Knee_Overview.md): còn schema recovered tách fluid/non-fluid; tên T1 trong tài liệu không đủ để suy từ non-FS.
- [Inference ResNet34 2.5D](../resnet34_baseline_clean/inference_resnet34_25d_4slot22181616/README.md): bốn slot và fold rank averaging; chưa kiểm tra đầy đủ notebook trong lượt lập docs này.
- [Kế hoạch viewer EDA cũ](../problem/DICOM_VIEWER_PLAN.md): có chi tiết sort/geometry/crop; mục tiêu local EDA khác service upload/AI hiện tại.

## Nguồn kỹ thuật để triển khai

Tra cứu ngày 29/09/2026. Pin phiên bản khi bắt đầu, không coi docs latest là version runtime đã chọn.

1. [Cornerstone viewports](https://www.cornerstonejs.org/docs/concepts/cornerstone-core/viewports/) — stack/MPR/3D.
2. [OHIF viewport](https://docs.ohif.org/user-guide/viewer/viewport/) và [hanging protocol](https://docs.ohif.org/platform/extensions/modules/hpmodule/) — reference workflow, không bắt buộc dùng OHIF.
3. [DICOM information objects](https://dicom.nema.org/medical/Dicom/2024d/output/html/part03.html) — study/series/instance/frame, metadata.
4. [ACR MRI MSK parameters](https://accreditationsupport.acr.org/support/solutions/articles/11000061021-mri-exam-specific-parameters-msk-module-revised-3-5-2025-) — phân biệt contrast và fat suppression; không dùng làm chứng nhận app.
5. [NVIDIA Python backend](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/python_backend/README.html) — model wrapper.
6. [FastAPI background tasks](https://fastapi.tiangolo.com/tutorial/background-tasks/) — phân biệt task nhẹ và heavy worker.
7. [GCP GPU machine types](https://docs.cloud.google.com/compute/docs/gpus) — lựa chọn tài nguyên.
8. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) — accessibility UI.

## Mẫu ghi quyết định mới

ID / ngày / owner / vấn đề / lựa chọn / lý do / bằng chứng / tác động API-data-model / task cần đổi / reviewer. Những thay đổi ảnh hưởng model snapshot hoặc output semantics phải tăng version, không chỉ sửa text UI.
