# 03 — Design system: Knee Review

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Chuẩn hóa metadata tài liệu; design system sáng hiện hành được giữ nguyên.  
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)

Tên làm việc: **Knee Review**. Đây là đề xuất UI cho prototype, không phải thương hiệu đã chốt. Xem [design board](templates/design-board.html) và [CSS tokens](templates/design-tokens.css).

Phạm vi 05/10/2026: trang đầu có một sample study card + study upload; không account/login hoặc AI panel. Trong workspace, React phải bám visual contract của `templates/design-board.html`: tabs hướng, viewer 4 ô, panel Study information và ingest pipeline. Nút chính là “Import study”; Analyze có nhãn “Coming soon”, nhưng chưa có score/result/endpoint. MPR/3D để sau; display preview dùng Contrast/Brightness/Invert và Window Center/Width khi DICOM có metadata.

## Định hướng

Giao diện sáng theo yêu cầu người dùng: nền xám rất nhạt, header/sidebar/panel trắng, chữ xanh đậm, accent xanh y tế. Cả nền viewport 3D và các ô 2D dùng xám sáng. Thay theme không đổi pixel hoặc window/level: vùng tối bên trong ảnh MRI vẫn tối theo dữ liệu. Khi triển khai WebGL, cấu hình background của renderer theo canvas token, không chỉ đổi CSS của container. Ảnh là trung tâm, text rõ, màu tiết chế. Không gradient trang trí, glow, glassmorphism, ảnh MRI giả hoặc chart không có dữ liệu. Lỗi và trạng thái import có text/icon, không chỉ màu. Panel thông tin thu gọn được để tăng diện tích ảnh.

## Font và typography

- UI: **Noto Sans**, self-host WOFF2 có glyph tiếng Việt và Latin, weight 400/500/600/700. Lưu license cùng asset; kiểm tra dấu tiếng Việt trước phát hành.
- Fallback: Segoe UI, Arial, sans-serif. Design board chưa kèm font binary, sẽ dùng font đã có trên máy.
- UID/thông số: ui-monospace, Consolas, monospace; số dùng tabular-nums.
- Font loading không gọi Google Fonts/CDN runtime. Dùng font-display: swap khi thêm @font-face.

| Vai trò | Size / line-height | Weight |
|---|---|---|
| Tên study / tiêu đề chính | 20 / 28 px | 600 |
| Tiêu đề panel | 16 / 24 px | 600 |
| Body, nút, dropdown | 14 / 20 px | 400 / 500 |
| Metadata phụ, badge | 12 / 18 px | 400 / 500 |
| Số slice / thông số | 12 / 18 px | 500, tabular |

Không đặt thông tin quyết định thao tác dưới 12 px. UID dài truncate trong list, có nút copy và vùng xem đầy đủ; không chỉ tooltip hover.

## Palette

| Token | HEX | Dùng cho |
|---|---|---|
| bg | #F4F7FB | Nền toàn app xám nhạt |
| surface | #FFFFFF | Header, sidebar, panel trắng |
| raised | #EDF3F8 | Control, phần nổi |
| selection | #E0F2FE | Nền series đang chọn |
| canvas | #F8FAFC | Nền sáng viewport 3D/2D, không thay giá trị pixel ảnh |
| canvas-text / canvas-muted | #102A43 / #52657A | Chữ chính/phụ trên nền viewport sáng |
| canvas-border / canvas-accent | #CBD5E1 / #0369A1 | Viền phân cách / selection và focus trong viewport |
| border | #D7E1EC | Phân cách trang trí, không dùng một mình cho focus |
| control-border | #64748B | Viền control cần nhận biết |
| text | #102A43 | Text chính xanh đậm |
| muted | #52657A | Metadata phụ trên nền sáng |
| accent | #0369A1 | Selection, link, nút chính xanh |
| on-accent | #FFFFFF | Text trắng trên nút xanh |
| success | #166534 | Job hoàn thành, không mang nghĩa “không bệnh” |
| warning | #92400E | Thiếu input, giới hạn geometry |
| danger | #B91C1C | Job lỗi, không dùng để tự kết luận bệnh |
| axis-sag / axis-cor / axis-ax | #B91C1C / #166534 / #1D4ED8 | Nhãn SAG/COR/AX trên canvas sáng |

Badge trạng thái: nền surface/raised, text màu đậm tương ứng. Nút accent dùng text trắng. Crosshair màu phải có nhãn vì màu không đủ diễn đạt hướng. Label đặt trên pixel MRI cần nền đệm tương phản (ví dụ nền sáng đục với chữ đậm), không dựa vào màu nền canvas để bảo đảm dễ đọc trên ảnh. Crosshair trên ảnh cần outline/halo để không mất trên vùng cùng màu/tín hiệu.

## Layout và component

- Spacing scale: 4, 8, 12, 16, 24, 32 px. Control height 36–40 px, icon target tối thiểu 32×32 px trong desktop.
- Radius: control 6 px, card 8 px. Viewer grid gap 4 px; không bo quá lớn làm mất diện tích ảnh.
- Header 56–76 px, tabs/toolbar khoảng 44 px. Sidebar 248–286 px, panel Study information 276–304 px; collapse ở màn nhỏ.
- Active viewport: viền canvas-accent 2 px + nhãn “Đang chọn”. Focus keyboard ngoài canvas: outline accent 2 px với offset 2 px; trong canvas dùng canvas-accent.
- Sidebar tree: Study → Series → một vài slice filename và tổng số lát; caret để expand/collapse, click label để chọn. Selection có icon/text, không chỉ nền.
- Viewer tabs: Overview, Sagittal, Coronal, Axial, Images / Series. Overview là snapshot 4 ô có kích thước đủ xem nhanh, ảnh fit theo aspect ratio gốc; tab hướng chuyển acquisition tương ứng thành viewport lớn và fit trọn ảnh; Images / Series là browser chọn acquisition, không lặp lại Overview.
- Viewport interaction: fit hiển thị trọn ảnh theo đúng tỉ lệ và căn giữa theo cả hai trục; footer card hiển thị `current / total`; click vùng ảnh trong Overview chọn active series nhưng không đổi tab; `Open` đổi sang tab hướng. Chỉ viewport active nhận Slice toolbar, wheel/pinch zoom, pointer/touch drag pan và Reset view; click viewport khác chỉ đổi selection. Wheel/pinch zoom bắt đầu từ 100% (fit mặc định), chỉ tăng lên và không có max zoom nhân tạo; ảnh zoomed giữ nguyên fit box làm nền để tránh nhảy/lùi vị trí, chỉ scale nội dung bên trong. Zoom out bị disable ở 100%; khi quay về 100% tự trả fit/pan về mặc định. Mỗi image card có `Reset view`, toolbar có `Reset`; cả hai đưa zoom/pan về fit. Overview ưu tiên scan nhanh, focused direction ưu tiên đọc ảnh.
- Panel Study information: source, input type, count, UID rút gọn và các stage validate/metadata/group/sort/preview.
- Progress upload có bytes/total; job dùng stage nếu không có tiến độ thực, không giả phần trăm.
- Panel thông tin: loại nguồn → số series/ảnh → sort/geometry → cảnh báo. Example còn thiếu source ghi “Chưa có dữ liệu mẫu”.
- Nút chính: “Nhập study” hoặc “Mở ảnh”; đang index ghi trạng thái và ngăn submit trùng.
- Không score/result hoặc AI panel trong local; Analyze chỉ mở notice rằng AI/Triton chưa kết nối. Thiết kế score chỉ thực hiện khi bắt đầu phase inference.

## Accessibility và ngôn ngữ

- Text thường đạt contrast ≥4.5:1, text lớn ≥3:1; control/focus cần ≥3:1 với nền liên quan. Đo trên màu thật của component, không chỉ bảng token.
- Toolbar button có aria-label; slider có label, min/max/value và keyboard; tooltip không chứa thông tin duy nhất.
- Không cướp phím scroll khi focus ở input. Loading/error công bố qua live region phù hợp.
- UI sản phẩm hiện dùng tiếng Anh: “Study”, “Series”, “Slice”, “Analyze”, “Coming soon”, “No axial series”. Tài liệu này có thể dùng tiếng Việt để giải thích, nhưng không được suy ra rằng UI runtime phải dịch sang tiếng Việt.
- Window/level điều chỉnh ảnh y khoa tách biệt tiêu chí contrast chữ UI. Checklist UI không chứng nhận chất lượng màn hình đọc chẩn đoán.

Nguồn: [WCAG 2.2](https://www.w3.org/TR/WCAG22/). Màu/font là quyết định thiết kế của dự án; không phải yêu cầu do thư viện quy định.

## Tích hợp Tailwind

Import CSS tokens một lần ở app entry; dùng CSS variable trực tiếp hoặc mapping vào theme của phiên bản Tailwind đã pin. Ví dụ `bg-[var(--kr-surface)]`, `text-[var(--kr-text)]`. Không copy giá trị HEX rải rác trong component. CSS đính kèm là template dùng chung, không phải file cấu hình Tailwind đã kiểm thử với repo frontend.
