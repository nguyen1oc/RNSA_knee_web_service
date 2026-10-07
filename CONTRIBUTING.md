# Contributing — Knee Review

> **Cập nhật gần nhất:** 2026-10-07
> **Thay đổi gần nhất:** Feature mới tạo branch từ dev và PR vào dev; chỉ merge dev vào main khi deploy.
> **Lịch sử:** [knee-service-blueprint/CHANGELOG.md](knee-service-blueprint/CHANGELOG.md)

## 1. Branch và cách push

Dùng hai nhánh dài hạn: `main` là nhánh deploy; `dev` là nhánh tích hợp, nhận các feature/fix đã review và chạy CI trên mỗi lần push. Nhánh công việc ngắn được tạo từ `dev`, rồi PR vào `dev`. Sau khi kiểm thử tích hợp, review và merge `dev` vào `main` để deploy.

```text
main (deploy source; protected)
  └── dev (integration + CI on push; protected)
       ├── feat/native-dicom-mpr
       ├── test/volume-geometry
       └── docs/dev-main-flow
```

Với feature mới, luôn tạo branch từ `dev`, push branch đó và mở PR vào `dev`; không push feature trực tiếp vào `dev` hoặc `main`. Chỉ merge `dev → main` khi chuẩn bị deploy. Bật branch protection: require CI, review và disallow force-push cho hai nhánh dài hạn.

```powershell
git switch dev
git pull --ff-only
git switch -c feat/short-description

git add <files>
git commit -m "feat(viewer): add native MPR"
git push -u origin feat/short-description
```

Review/merge feature PR vào `dev`; sau smoke test, tạo PR `dev → main` khi cần deploy. Merge vào `main` là tín hiệu cho deployment workflow khi registry và môi trường deploy đã cấu hình.

`gf` không phải tên một loại commit. Nếu đang nói tới **Git Flow**, đó là một branch strategy có `feature/*`, `release/*` và `hotfix/*`. Với service này, `main`/`dev` cùng feature branches giữ luồng review gọn; chỉ thêm `release/*` khi quản lý staging/production riêng.

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

Workflow ở [.github/workflows/ci.yml](.github/workflows/ci.yml) chạy CI khi push lên `dev`/ `main` và trên PR. Pull Request chạy đủ checks backend (Ruff, Mypy, pytest, compileall), frontend (`npm ci`, build) và Docker build. Bật ruleset yêu cầu CI xanh trước merge.

## 4. CD/autodeploy sau này

`main` là nguồn deploy đã thống nhất. Repo local hiện chưa có registry, target runtime hoặc secrets nên workflow chỉ chạy CI; deployment được kích hoạt sau khi cấu hình environment. Trình tự là:

1. CI pass trên PR vào `dev`, merge và smoke test integration;
2. CI pass cho PR `dev → main`, review và merge vào `main`;
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
