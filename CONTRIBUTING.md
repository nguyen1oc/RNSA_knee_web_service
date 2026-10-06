# Contributing — Knee Review

> **Cập nhật gần nhất:** 2026-10-06  
> **Thay đổi gần nhất:** Thêm quy ước commit, branch, push, Pull Request và quan hệ CI/CD.  
> **Lịch sử:** [knee-service-blueprint/CHANGELOG.md](knee-service-blueprint/CHANGELOG.md)

## 1. Branch và cách push

Trong giai đoạn hiện tại dùng GitHub Flow đơn giản:

```text
main (PR target; nên bật branch protection)
  └── feat/viewer-selection
  └── fix/dicom-window-level
  └── docs/ci-cd-guide
  └── ci/add-backend-checks
```

Không push trực tiếp vào `main` khi đã làm việc theo nhóm. Tạo branch ngắn, mở Pull Request, chờ CI pass và người còn lại review rồi mới merge.

```powershell
git switch main
git pull --ff-only
git switch -c feat/short-description

git add <files>
git commit -m "feat(viewer): add selected-card slice navigation"
git push -u origin feat/short-description
```

`gf` không phải tên một loại commit. Nếu đang nói tới **Git Flow**, đó là một branch strategy có `feature/*`, `release/*` và `hotfix/*`. Với service local hiện tại, GitHub Flow ở trên đủ đơn giản; chỉ thêm `release/*` khi bắt đầu quản lý staging/production riêng.

## 2. Conventional Commits

Format:

```text
<type>(<scope>): <imperative summary>
```

Các type dùng trong repo:

| Type | Dùng khi | Ví dụ |
|---|---|---|
| `feat` | Thêm khả năng mới cho user/API | `feat(viewer): add axial tab` |
| `fix` | Sửa bug | `fix(dicom): preserve slice order` |
| `docs` | Chỉ sửa tài liệu | `docs(ci): document deployment gates` |
| `refactor` | Đổi cấu trúc code, không đổi behavior | `refactor(frontend): split viewer components` |
| `test` | Thêm hoặc sửa test | `test(api): cover study deletion` |
| `ci` | Workflow/check/cache của CI | `ci: add mypy check` |
| `build` | Docker, package, dependency, build artifact | `build(docker): pin runtime base` |
| `chore` | Việc bảo trì không thuộc nhóm trên | `chore(repo): update ignore rules` |
| `perf` | Cải thiện hiệu năng | `perf(viewer): cache preview requests` |
| `revert` | Hoàn tác commit trước | `revert: revert axial tab` |

Nên dùng scope ngắn như `viewer`, `dicom`, `api`, `frontend`, `docker`, `ci`, `docs`. Không cần thêm dấu chấm cuối summary.

## 3. CI hiện tại

Workflow ở [.github/workflows/ci.yml](.github/workflows/ci.yml) chạy trên Pull Request và push vào `main`:

- backend: Ruff, Mypy, `compileall`;
- frontend: `npm ci` và `npm run build`;
- Docker: build production image.

CI không cần DICOM thật, GPU, Triton, GCP hoặc secrets. Mypy/Ruff là static checks, chưa thay thế test hành vi. Khi fixture DICOM ổn định, thêm `pytest` cho upload, grouping, geometry, slice ordering, delete và PNG rendering.

## 4. CD/autodeploy sau này

Chưa autodeploy từ `main` ở giai đoạn local. Trình tự nên là:

1. CI pass trên Pull Request;
2. merge vào `main`;
3. build image immutable theo commit SHA;
4. push image vào registry;
5. deploy staging;
6. gọi readiness/health và smoke test;
7. production cần approval hoặc tag release, có rollback image và migration an toàn.

Không đặt DICOM, database, checkpoint hoặc secret vào Git/Docker image. Chi tiết xem [15 — CI/CD plan](knee-service-blueprint/15-ci-cd-plan.md).

## 5. Quy ước cập nhật tài liệu

Mỗi tài liệu thuộc `knee-service-blueprint/` và tài liệu vận hành chính phải có block:

```markdown
> **Cập nhật gần nhất:** YYYY-MM-DD
> **Thay đổi gần nhất:** Mô tả ngắn.
> **Lịch sử:** [CHANGELOG](CHANGELOG.md)
```

Khi sửa nội dung quan trọng, cập nhật ngày và mô tả trong block; đồng thời thêm entry vào [CHANGELOG.md](knee-service-blueprint/CHANGELOG.md). Không xóa các quyết định cũ: đánh dấu là `historical`, `superseded` hoặc `deferred`.
