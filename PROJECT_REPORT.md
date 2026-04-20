# Project Report: Web GIS Climate Analysis Platform

## 1. Project Overview

### Project name
`Web GIS Climate Analysis Platform`

Tên này được suy ra từ [README.md](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/README.md) và metadata trong [package.json](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/legacy/node-express/package.json) của bản legacy.

### Purpose
Dự án là một ứng dụng WebGIS phục vụ phân tích khí hậu và môi trường. Hệ thống cho phép người dùng:
- đăng ký, đăng nhập và lưu phiên làm việc
- chọn địa điểm hành chính hoặc vùng phân tích tùy chỉnh
- phân tích lượng mưa, nhiệt độ, độ ẩm đất, NDVI và TVDI
- lấy dữ liệu trực tiếp từ Google Earth Engine
- đồng bộ dữ liệu đã phân tích vào PostgreSQL
- thao tác trên bản đồ với boundary hành chính, polygon tự vẽ, GeoJSON tải lên, tìm kiếm text, định tuyến và lớp bản đồ chuyên đề

### Academic context
Từ cấu trúc repo, tài liệu kiến trúc và các tính năng hiện có, đây là một đồ án/hệ thống học thuật theo hướng WebGIS và phân tích khí hậu. Tên học phần hoặc đơn vị đào tạo không được xác định trực tiếp từ source code. Tài liệu [adr-001-django-react-migration.md](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/docs/architecture/adr-001-django-react-migration.md) cho thấy dự án đã được nâng cấp từ Node/Express + static HTML sang Django REST + React/Vite để dễ mở rộng và bảo trì hơn.

### Main goals
- Biến hệ thống từ dashboard biểu đồ thành một WebGIS có phân tích không gian rõ ràng.
- Kết hợp dữ liệu hành chính, hình học tùy chỉnh và bản đồ với các chỉ số khí hậu.
- Hỗ trợ song song hai chế độ: phân tích trực tiếp từ Google Earth Engine và đọc dữ liệu đã đồng bộ vào cơ sở dữ liệu.
- Giữ lại chức năng cũ trong khi hiện đại hóa toàn bộ kiến trúc.

### Problem it solves
Hệ thống giải quyết bài toán chuyển dữ liệu viễn thám và khí hậu thành công cụ phân tích không gian có thể dùng trực tiếp trên web. Thay vì thao tác thủ công với Earth Engine, người dùng có thể:
- chọn địa điểm hoặc vẽ vùng quan tâm
- phân tích chỉ số theo thời gian
- xem kết quả trên biểu đồ và lớp bản đồ chuyên đề
- lưu và tái sử dụng vùng phân tích gần đây

---

## 2. Tech Stack

### Backend

| Technology | Version | Role |
|---|---:|---|
| Python | Chưa xác định từ source code | Ngôn ngữ backend chính |
| Django | 5.1.5 | Backend web chính |
| Django REST Framework | 3.15.2 | REST API |
| django-cors-headers | 4.6.0 | CORS |
| psycopg2-binary | 2.9.10 | Kết nối PostgreSQL |
| PyJWT | 2.10.1 | JWT |
| bcrypt | 4.2.1 | Hash mật khẩu |
| requests | 2.32.3 | HTTP client |
| python-dotenv | 1.0.1 | Load biến môi trường |
| Flask | 3.1.0 | Microservice riêng cho GEE |
| Flask-Cors | 5.0.0 | CORS cho Flask |
| pandas | 2.2.3 | Xử lý bảng dữ liệu |
| earthengine-api | `>=0.1.390` | Google Earth Engine |
| shapely | 2.1.2 | Xử lý hình học |

### Frontend

| Technology | Version | Role |
|---|---:|---|
| JavaScript | ES modules | Ngôn ngữ frontend |
| React | 18.3.1 | UI |
| React DOM | 18.3.1 | Render trình duyệt |
| Vite | 6.1.1 | Dev/build tool |
| React Router DOM | 6.30.1 | Routing SPA |
| Axios | 1.13.2 | API client |
| Chart.js | 4.4.0 | Biểu đồ |
| react-chartjs-2 | 5.2.0 | Binding React cho Chart.js |
| Leaflet | 1.9.4 | Bản đồ GIS |
| react-leaflet | 4.2.1 | Binding React cho Leaflet |
| lucide-react | 0.475.0 | Icon |

### Legacy stack

| Technology | Version | Role |
|---|---:|---|
| Node.js | Chưa xác định từ source code | Runtime cũ |
| Express | 4.18.2 | Backend cũ |
| pg | 8.11.3 | Kết nối PostgreSQL cũ |
| jsonwebtoken | 9.0.2 | JWT cũ |
| bcryptjs | 3.0.3 | Hash mật khẩu cũ |
| nodemon | 3.0.1 | Dev server cũ |

### GIS-specific libraries and services

| Tool | Role |
|---|---|
| Leaflet / react-leaflet | Hiển thị và tương tác bản đồ |
| Shapely | Tính toán hình học, centroid, representative point |
| Google Earth Engine | Xử lý dữ liệu viễn thám và khí hậu |
| Nominatim | Geocoding và reverse geocoding |
| OSRM | Tính tuyến đường |
| PostgreSQL JSONB | Lưu hình học dạng GeoJSON-like |
| `thanglequoc/vietnamese-provinces-database` | Dữ liệu chuẩn đơn vị hành chính |

### GIS tools not used in runtime
Các công nghệ sau không xuất hiện như một phần runtime hiện tại:
- PostGIS
- GeoPandas
- OpenLayers
- QGIS integration code

---

## 3. Project Structure

```text
.
├── README.md
├── PROJECT_REPORT.md
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── apps/
│   │   ├── accounts/              # Xác thực, user model, login/register/logout
│   │   ├── activity/              # Ghi log hoạt động người dùng
│   │   ├── climate/               # API khí hậu, boundary, geometry analysis, map API
│   │   ├── common/                # JWT auth, helpers, response envelope
│   │   └── gee/                   # Django proxy sang Flask GEE service
│   ├── config/                    # Django settings, root URLs, ASGI/WSGI
│   ├── scripts/
│   │   ├── api_server.py          # Flask GEE service
│   │   ├── bootstrap_thanglequoc_admin_data.py
│   │   ├── import_vn_admin_boundaries.py
│   │   └── get_gee_data.py
│   └── sql/
│       ├── bootstrap_schema.sql
│       ├── bootstrap_admin_boundaries.sql
│       └── bootstrap_analysis_area_history.sql
├── frontend/
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── App.jsx                # Route tree
│       ├── main.jsx               # React entry point
│       ├── api/client.js          # Axios client
│       ├── components/            # Layout, route guard, stat card, sync modal
│       ├── context/AuthContext.jsx
│       ├── pages/
│       │   ├── HomePage.jsx
│       │   ├── ActivityPage.jsx
│       │   ├── MapPage.jsx
│       │   ├── RainfallPage.jsx
│       │   ├── TemperaturePage.jsx
│       │   ├── SoilMoisturePage.jsx
│       │   ├── NdviPage.jsx
│       │   ├── TvdiPage.jsx
│       │   ├── LoginPage.jsx
│       │   ├── RegisterPage.jsx
│       │   └── NotFoundPage.jsx
│       ├── styles/theme.css
│       └── utils/
│           ├── analysisScope.js
│           ├── geometryAnalysis.js
│           ├── locationSelection.js
│           ├── mapGeometry.js
│           ├── spatial.js
│           └── viText.js
├── docs/
│   └── architecture/adr-001-django-react-migration.md
├── legacy/
│   └── node-express/              # Bản cũ để tham chiếu
└── logs/                          # Log local, không phải logic hệ thống
```

### Notes about source layout
- [backend/manage.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/manage.py) là entry point của Django.
- [backend/scripts/api_server.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/api_server.py) là Flask service xử lý toàn bộ logic Earth Engine.
- [frontend/src/pages/MapPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/MapPage.jsx) là trung tâm WebGIS của giao diện.
- [backend/sql/bootstrap_schema.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_schema.sql), [bootstrap_admin_boundaries.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_admin_boundaries.sql) và [bootstrap_analysis_area_history.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_analysis_area_history.sql) là các file schema chính.
- `external/` không có trong snapshot source hiện tại, nhưng [bootstrap_thanglequoc_admin_data.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/bootstrap_thanglequoc_admin_data.py) kỳ vọng dữ liệu `external/vietnamese-provinces-database` tồn tại để bootstrap hành chính chuẩn.

---

## 4. Architecture & Data Flow

## High-level architecture

Hệ thống đang chạy theo mô hình 3 thành phần:
1. React/Vite frontend
2. Django REST backend
3. Flask Earth Engine service

### Interaction flow

```text
Browser (React)
  -> Django REST API
     -> PostgreSQL cho dữ liệu ứng dụng và dữ liệu khí hậu đã sync
     -> Flask GEE service cho các thao tác Earth Engine
        -> Google Earth Engine datasets
     -> Nominatim / OSRM cho geocode, reverse geocode, routing
```

## Main data sources

| Source | Type | Used for |
|---|---|---|
| PostgreSQL | relational DB + JSONB | users, logs, locations, boundaries, climate data, history |
| Google Earth Engine | remote API | rainfall, temperature, soil moisture, NDVI, TVDI |
| CHIRPS Daily | GEE dataset | lượng mưa |
| ERA5-Land Daily Aggregated | GEE dataset | nhiệt độ và độ ẩm đất |
| MODIS MOD13Q1 | GEE dataset | NDVI |
| MODIS MOD11A2 | GEE dataset | LST dùng cho TVDI |
| Nominatim | HTTP API | geocoding và reverse geocoding |
| OSRM | HTTP API | route calculation |
| Uploaded GeoJSON | user input | vùng phân tích tùy chỉnh |
| `thanglequoc/vietnamese-provinces-database` | external dataset | bootstrap đơn vị hành chính chuẩn |
| GIS SQL/WKT từ dataset đó | external dataset | sinh representative point và boundary records |

## Runtime data flow patterns

### A. Location-based climate analysis
- Frontend gọi các endpoint như `GET /api/rainfall`, `GET /api/temperature`, `GET /api/ndvi`, `GET /api/tvdi`.
- Django xử lý theo 2 chế độ:
  - `source=db`: đọc từ PostgreSQL
  - `source=gee`: proxy sang Flask GEE service
- Kết quả được chuẩn hóa và trả về frontend để hiển thị chart/stat cards.

### B. Geometry-based climate analysis
- Frontend lưu vùng phân tích vào `localStorage` qua [analysisScope.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/analysisScope.js).
- Các page như rainfall/temperature/NDVI/TVDI đọc geometry mode và gửi `POST` với `geometry`, `area_name`, `province`, `source_type`.
- Django ở [geometry_analysis.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/geometry_analysis.py) validate rồi proxy sang GEE service.
- Nếu user đã đăng nhập, vùng được lưu vào `analysis_area_history`.

### C. Sync from GEE into DB
- Frontend gọi `POST /api/gee/fetch`.
- Django validate payload qua [backend/apps/gee/services.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/gee/services.py).
- Django forward sang Flask `/fetch-data`.
- Flask query Earth Engine, chuyển kết quả thành pandas DataFrame rồi save vào các bảng khí hậu.
- Django bọc response và có thể ghi lại lịch sử vùng phân tích.

### D. WebGIS map flow
- [MapPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/MapPage.jsx) load:
  - `/api/boundaries`
  - `/api/standard/wards`
  - `/api/analysis-areas/history`
- Page hỗ trợ:
  - click bản đồ
  - current location
  - reverse geocode
  - context hành chính của điểm
  - text search qua Nominatim
  - polygon vẽ tay
  - upload GeoJSON
  - tạo vùng bán kính
  - route calculation
  - thematic layers qua `/api/map/layer`
  - point sampling qua `/api/map/point-sample`
  - hotspot search qua `/api/map/hotspots`

### E. Standard admin dataset bootstrap flow
- [bootstrap_thanglequoc_admin_data.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/bootstrap_thanglequoc_admin_data.py) đọc SQL và zipped GIS SQL từ dataset ngoài.
- Script import dữ liệu chuẩn `provinces`, `wards`, `administrative_units`, `administrative_regions`.
- Script parse WKT bằng `shapely`, tính representative point, rồi sync vào `locations` và `admin_boundaries`.

## Spatial data processing pipelines
- GeoJSON normalization và geometry center trong [analysis_areas.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/analysis_areas.py)
- Import boundary và representative point trong [bootstrap_thanglequoc_admin_data.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/bootstrap_thanglequoc_admin_data.py)
- Import GeoJSON tổng quát trong [import_vn_admin_boundaries.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/import_vn_admin_boundaries.py)
- Tạo vùng bán kính phía frontend trong [spatial.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/spatial.js)
- Chọn và lưu geometry trên map trong [MapPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/MapPage.jsx)

---

## 5. Features Implemented

## Authentication and user session
- Đăng ký tài khoản mới
- Đăng nhập
- Đăng xuất
- Lấy thông tin user hiện tại
- Lưu token và user vào `localStorage`
- Sử dụng bảng `users` riêng thay vì phụ thuộc trực tiếp vào `auth_user` của Django cho nghiệp vụ chính

## User activity tracking
- Ghi log hoạt động người dùng
- Xem lịch sử hoạt động gần đây
- Xem thống kê hoạt động theo khoảng thời gian
- Frontend tự gọi `logActivity()` qua [AuthContext.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/context/AuthContext.jsx)

## Climate analytics
- Phân tích lượng mưa theo khoảng ngày
- Thống kê lượng mưa theo tháng
- Thống kê lượng mưa theo năm
- So sánh lượng mưa giữa hai giai đoạn
- So sánh lượng mưa giữa hai địa điểm
- Phân tích nhiệt độ theo khoảng ngày
- Thống kê nhiệt độ theo tháng
- Phân tích độ ẩm đất theo khoảng ngày
- Thống kê độ ẩm đất theo tháng
- Phân tích NDVI theo khoảng ngày
- Thống kê NDVI theo tháng
- Thống kê NDVI theo năm
- Phân tích TVDI theo khoảng ngày
- Thống kê TVDI theo tháng
- Tổng hợp hạn hán theo TVDI
- Liệt kê đợt hạn nghiêm trọng
- Dashboard tổng quan
- Dashboard timeseries

## Geometry-based analysis
- Phân tích lượng mưa trực tiếp trên geometry tùy chỉnh
- Phân tích nhiệt độ trực tiếp trên geometry tùy chỉnh
- Phân tích NDVI trực tiếp trên geometry tùy chỉnh
- Phân tích TVDI trực tiếp trên geometry tùy chỉnh
- Lưu vùng phân tích gần đây vào `analysis_area_history`

## GEE integration
- Kiểm tra trạng thái GEE service
- Lấy dữ liệu các chỉ số từ GEE
- Sync lượng mưa từ GEE
- Sync nhiệt độ từ GEE
- Sync toàn bộ các data type hợp lệ từ GEE
- Phân tích geometry trực tiếp từ GEE mà không cần lưu DB
- Tạo thematic raster layer từ GEE
- Lấy giá trị pixel tại một điểm từ GEE

## WebGIS map features
- Hiển thị ranh giới tỉnh/thành và phường/xã nếu có
- Chọn tỉnh và ward từ dữ liệu hành chính
- Chuyển boundary đang chọn thành analysis scope
- Click map để lấy điểm
- Reverse geocode điểm đang chọn
- Tìm kiếm địa điểm bằng text rồi lấy tọa độ
- Hiển thị vị trí hiện tại từ trình duyệt
- Vẽ polygon trực tiếp trên bản đồ
- Upload GeoJSON để làm vùng phân tích
- Tạo vùng bán kính quanh điểm
- Lưu vùng phân tích gần đây theo tài khoản
- Tính route từ current location tới điểm hoặc hotspot
- Bật lớp chuyên đề cho rainfall, temperature, soil moisture, NDVI, TVDI
- Điều chỉnh opacity lớp bản đồ
- Tìm hotspot TVDI gần nhất

## UI/dashboard features
- Dashboard tổng quan với chart và stat card
- Trang riêng cho rainfall, temperature, soil moisture, NDVI, TVDI
- Trang activity
- Protected route cho user đã đăng nhập
- Modal hiển thị tiến trình đồng bộ GEE

## Legacy compatibility
- Legacy Express/static implementation vẫn còn trong `legacy/node-express/`
- ADR migration trong [adr-001-django-react-migration.md](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/docs/architecture/adr-001-django-react-migration.md) cho thấy việc giữ tương thích chức năng là chủ đích thiết kế

---

## 6. Key Functions & Modules

## Backend core modules

### [backend/config/settings.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/config/settings.py)
Vai trò:
- cấu hình Django trung tâm
- database
- auth/CORS
- URL của GEE service, geocoder, reverse geocoder, router

Logic quan trọng:
- `PYTHON_GEE_API_URL` để Django gọi Flask GEE service
- `GEOCODER_*` và `ROUTING_API_URL` cho tính năng GIS phụ trợ
- cấu hình custom JWT authentication từ `apps.common.auth.JWTAuthentication`

### [backend/config/urls.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/config/urls.py)
Vai trò:
- router gốc của API
- healthcheck
- mount các route `auth`, `activity`, `climate`, `gee`

### [backend/apps/common/auth.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/common/auth.py)
Vai trò:
- hash và verify password
- tạo/verify JWT
- DRF authentication adapter

Hàm chính:
- `hash_password`
- `verify_password`
- `generate_token`
- `verify_token`
- `JWTAuthentication.authenticate`

### [backend/apps/common/helpers.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/common/helpers.py)
Vai trò:
- helper số học
- tính xu hướng

Hàm quan trọng:
- `calculate_trend(...)`
- `fixed(...)`
- `to_float(...)`

### [backend/apps/common/responses.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/common/responses.py)
Vai trò:
- chuẩn hóa envelope response với `ok(data)` và `fail(message, status, code, details)`

## Accounts

### [backend/apps/accounts/models.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/accounts/models.py)
Vai trò:
- unmanaged model cho bảng `users`
- `managed = False`
- `set_password` lưu hash vào `password_hash`
- `check_password` verify plaintext

### [backend/apps/accounts/views.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/accounts/views.py)
Vai trò:
- endpoint auth

Class chính:
- `RegisterView`
- `LoginView`
- `LogoutView`
- `CurrentUserView`

Logic quan trọng:
- kiểm tra trùng username/email
- update `last_login`
- ghi activity log khi register/login/logout

## Activity

### [backend/apps/activity/models.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/activity/models.py)
Vai trò:
- unmanaged model cho `user_activity_logs`

### [backend/apps/activity/views.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/activity/views.py)
Class chính:
- `LogActivityView`
- `ActivityHistoryView`
- `ActivityStatsView`

Logic:
- validate payload log
- hỗ trợ history với `limit` và `offset`
- aggregate theo `activity_type`

## Climate domain

### [backend/apps/climate/models.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/models.py)
Vai trò:
- unmanaged model cho `Location`, `AdminBoundary`, `AdministrativeRegion`, `AdministrativeUnit`, `Province`, `Ward`, `AnalysisAreaHistory`, `RainfallData`, `TemperatureData`, `SoilMoistureData`, `NdviData`, `TvdiData`

### [backend/apps/climate/services.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/services.py)
Vai trò:
- parse date
- phân loại NDVI
- phân loại TVDI
- chuẩn hóa dashboard timeseries

### [backend/apps/climate/views.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/views.py)
Vai trò:
- API khí hậu chính

Nhóm class chính:
- `LocationsView`, `LocationDetailView`
- `AdminBoundariesView`, `AdminBoundaryDetailView`
- `StandardProvincesView`, `StandardWardsView`
- `RainfallRangeView`, `RainfallMonthlyView`, `RainfallYearlyView`, `RainfallComparePeriodsView`, `RainfallCompareLocationsView`
- `TemperatureRangeView`, `TemperatureMonthlyView`
- `SoilMoistureRangeView`, `SoilMoistureMonthlyView`
- `NdviRangeView`, `NdviMonthlyView`, `NdviYearlyView`
- `TvdiRangeView`, `TvdiMonthlyView`, `TvdiDroughtSummaryView`, `TvdiSevereEventsView`
- `DashboardOverviewView`, `DashboardTimeseriesView`

Kỹ thuật:
- hỗ trợ `source=db` và `source=gee`
- khi `source=gee` thì gọi helper fetch sang Flask
- DB mode dùng Django ORM aggregation
- geometry mode dùng các handler ở `geometry_analysis.py`

### [backend/apps/climate/geometry_analysis.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/geometry_analysis.py)
Vai trò:
- wrapper cho geometry mode của rainfall, temperature, NDVI, TVDI
- validate geometry/date
- check GEE service online
- proxy geometry sang GEE service
- ghi lại vùng phân tích nếu user đã đăng nhập

### [backend/apps/climate/analysis_areas.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/analysis_areas.py)
Vai trò:
- normalize geometry upload/custom
- tính center của geometry
- lưu lịch sử vùng phân tích

Hàm/logic đáng chú ý:
- `normalize_geometry_payload`
- `compute_geometry_center`
- `record_analysis_area_usage`
- `AnalysisAreaHistoryView`

### [backend/apps/climate/map_views.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/climate/map_views.py)
Vai trò:
- API GIS phụ trợ cho bản đồ

Class chính:
- `MapGeocodeView`
- `MapReverseGeocodeView`
- `MapRouteView`
- `MapContextView`
- `MapLayerView`
- `MapPointSampleView`
- `MapHotspotsView`

Logic:
- proxy geocoder/router
- xác định boundary chứa một điểm bằng Shapely
- xây request thematic layer cho GEE
- tìm hotspot TVDI gần nhất từ DB và tính khoảng cách

## GEE integration

### [backend/apps/gee/services.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/gee/services.py)
Vai trò:
- check status và fetch dữ liệu từ Flask GEE service
- validate payload fetch

Logic:
- validate province mode vs geometry mode
- whitelist `data_types`
- validate format ngày

### [backend/apps/gee/views.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/apps/gee/views.py)
Vai trò:
- endpoint cho Django phía ngoài gọi tới GEE service

Class chính:
- `GeeStatusView`
- `GeeFetchView`
- `GeeFetchRainfallView`
- `GeeFetchTemperatureView`
- `GeeFetchAllView`

Kỹ thuật:
- geometry-based sync sẽ ghi history vùng phân tích
- có thể update `location_id` về history sau khi save DB thành công

## Flask GEE service

### [backend/scripts/api_server.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/api_server.py)
Vai trò:
- thực thi toàn bộ logic Earth Engine
- resolve region/province
- lấy dữ liệu chỉ số
- lưu vào PostgreSQL
- sinh map layer
- sample giá trị tại điểm

Nhóm logic chính:
- khởi tạo GEE bằng OAuth hoặc service account
- normalize tên tỉnh/thành
- `get_region_geometry(...)`
- các hàm lấy rainfall, temperature, soil moisture, NDVI, TVDI
- tính TVDI dựa trên LST-NDVI và fallback nếu fit không đủ
- `POST /fetch-data`
- `POST /map-layer`
- `POST /sample-point`
- `GET /status`

### [backend/scripts/bootstrap_thanglequoc_admin_data.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/bootstrap_thanglequoc_admin_data.py)
Vai trò:
- import dữ liệu chuẩn hành chính và GIS từ dataset ngoài
- tính representative point và sync vào DB hiện tại

### [backend/scripts/import_vn_admin_boundaries.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/import_vn_admin_boundaries.py)
Vai trò:
- import GeoJSON boundary vào `admin_boundaries`

## Frontend modules

### [frontend/src/context/AuthContext.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/context/AuthContext.jsx)
Vai trò:
- quản lý auth/session ở client
- login/register/logout
- verify token hiện tại
- log activity từ frontend

### [frontend/src/api/client.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/api/client.js)
Vai trò:
- Axios client dùng chung
- hỗ trợ `VITE_API_BASE_URL`
- gắn auth header

### [frontend/src/components/Layout.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/components/Layout.jsx)
Vai trò:
- layout và navigation của app

### [frontend/src/pages/HomePage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/HomePage.jsx)
Vai trò:
- dashboard tổng quan
- gọi `/dashboard/overview` và `/dashboard/timeseries`

### [frontend/src/pages/RainfallPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/RainfallPage.jsx)
Vai trò:
- UI phân tích mưa
- hỗ trợ DB mode, geometry mode, sync từ GEE, compare periods, compare locations

### [frontend/src/pages/TemperaturePage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/TemperaturePage.jsx)
Vai trò:
- UI nhiệt độ
- hỗ trợ DB mode, geometry mode và sync GEE

### [frontend/src/pages/SoilMoisturePage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/SoilMoisturePage.jsx)
Vai trò:
- UI độ ẩm đất

### [frontend/src/pages/NdviPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/NdviPage.jsx)
Vai trò:
- UI NDVI
- hỗ trợ DB mode, geometry mode và sync GEE

### [frontend/src/pages/TvdiPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/TvdiPage.jsx)
Vai trò:
- UI TVDI
- hỗ trợ drought summary và severe events

### [frontend/src/pages/ActivityPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/ActivityPage.jsx)
Vai trò:
- UI lịch sử và thống kê activity

### [frontend/src/pages/MapPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/MapPage.jsx)
Vai trò:
- trung tâm GIS của hệ thống

Kỹ thuật:
- load boundaries và ward list
- click map, reverse geocode, context lookup
- current location
- search text ra tọa độ
- polygon vẽ tay
- upload GeoJSON
- radius/buffer
- recent area history
- thematic layers
- route calculation
- hotspot lookup
- mở các module phân tích với analysis scope hiện tại

### Frontend utilities

| File | Role |
|---|---|
| [analysisScope.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/analysisScope.js) | Lưu analysis scope vào browser |
| [geometryAnalysis.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/geometryAnalysis.js) | Helper tổng hợp monthly cho geometry mode |
| [locationSelection.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/locationSelection.js) | Lưu location được chọn |
| [mapGeometry.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/mapGeometry.js) | Normalize GeoJSON và tính center |
| [spatial.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/spatial.js) | Tạo buffer/bán kính và format distance/duration |
| [viText.js](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/utils/viText.js) | Map label sang tiếng Việt |

---

## 7. Database / Data Schema

## Core tables

Được định nghĩa trong [bootstrap_schema.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_schema.sql):

| Table | Purpose |
|---|---|
| `users` | tài khoản người dùng |
| `locations` | địa điểm và geometry tùy chọn |
| `user_activity_logs` | lịch sử hoạt động |
| `rainfall_data` | dữ liệu lượng mưa theo location/date |
| `temperature_data` | dữ liệu nhiệt độ theo location/date |
| `soil_moisture_data` | dữ liệu độ ẩm đất theo location/date |
| `ndvi_data` | dữ liệu NDVI theo location/date |
| `tvdi_data` | dữ liệu TVDI theo location/date |

## Boundary/history tables

Được định nghĩa trong:
- [bootstrap_admin_boundaries.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_admin_boundaries.sql)
- [bootstrap_analysis_area_history.sql](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/sql/bootstrap_analysis_area_history.sql)

| Table | Purpose |
|---|---|
| `admin_boundaries` | ranh giới hành chính và centroid hoặc geometry |
| `analysis_area_history` | vùng phân tích gần đây của user |

## Imported standard reference tables

Các bảng sau không do project SQL bootstrap trực tiếp tạo, mà được kỳ vọng xuất hiện sau khi import dữ liệu ngoài:
- `administrative_regions`
- `administrative_units`
- `provinces`
- `wards`
- có thể có staging tables như `gis_provinces`, `gis_wards` tùy script bootstrap

## Spatial data formats

| Format | Where used |
|---|---|
| JSONB GeoJSON-like | `locations.geometry`, `admin_boundaries.geometry`, `analysis_area_history.geometry` |
| Earth Engine `ee.Geometry` | Flask GEE service |
| Shapely geometry object | bootstrap, import, context lookup |
| Leaflet layer | frontend map |

## CRS / EPSG
- GIS SQL import trong [bootstrap_thanglequoc_admin_data.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/bootstrap_thanglequoc_admin_data.py) cho thấy SRID là `4326`.
- GeoJSON và Leaflet cũng ngầm dùng WGS84 / EPSG:4326.
- Earth Engine geometry của dự án đang làm việc theo lat/lng.
- Hệ thống hiện chưa lưu metadata CRS một cách tường minh cho mọi geometry JSON.

## Indexing and constraints
- unique username và email
- foreign key từ activity, climate, history, boundaries sang `users` và `locations`
- unique `(location_id, date)` cho nhiều bảng khí hậu
- index cho `admin_boundaries` theo level, parent, location, province
- index cho history theo `(user_id, last_used_at)` và `location_id`

---

## 8. Configuration & Environment

## Backend environment variables

Từ [backend/.env.example](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/.env.example):

| Variable | Purpose |
|---|---|
| `DEBUG` | bật hoặc tắt debug Django |
| `ALLOWED_HOSTS` | host cho Django |
| `DJANGO_SECRET_KEY` | secret của Django |
| `JWT_SECRET` | secret ký JWT |
| `JWT_EXPIRES_DAYS` | thời gian sống token |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME` | kết nối PostgreSQL |
| `PYTHON_GEE_API_URL` | URL Django -> Flask GEE |
| `GEE_PROJECT` | Google Cloud / Earth Engine project |
| `GEE_SERVICE_ACCOUNT` | service account email tùy chọn |
| `GEE_PRIVATE_KEY_FILE` | đường dẫn key JSON tùy chọn |
| `FLASK_DEBUG` | debug cho Flask |
| `GEE_API_PORT` | cổng Flask |
| `CORS_ALLOW_ALL` | bật CORS tự do |
| `CORS_ALLOWED_ORIGINS` | whitelist origin |
| `GEOCODER_SEARCH_URL` | URL geocoding |
| `GEOCODER_REVERSE_URL` | URL reverse geocoding |
| `ROUTING_API_URL` | URL routing |
| `MAP_PROXY_USER_AGENT` | User-Agent cho request ra ngoài |

## Frontend environment variables

Từ [frontend/.env.example](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/.env.example):

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | base URL của Django API |

## Local setup steps

1. Tạo và activate virtual environment cho Python.
2. Cài dependency backend từ [backend/requirements.txt](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/requirements.txt).
3. Cài dependency frontend từ [frontend/package.json](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/package.json).
4. Tạo database PostgreSQL.
5. Chạy các file bootstrap SQL cho domain tables.
6. Chạy `python manage.py migrate` cho các bảng do Django quản lý.
7. Authenticate Earth Engine tại máy local.
8. Chạy Flask GEE service.
9. Chạy Django backend.
10. Chạy Vite frontend.

### Typical local run commands

```powershell
# terminal 1
.\.venv\Scripts\Activate.ps1
python -X utf8 .\backend\scripts\api_server.py

# terminal 2
.\.venv\Scripts\Activate.ps1
cd .\backend
python manage.py runserver 0.0.0.0:8000

# terminal 3
cd .\frontend
npm run dev
```

## Optional admin dataset bootstrap

Nếu dataset ngoài đã có sẵn:

```powershell
python .\backend\scripts\bootstrap_thanglequoc_admin_data.py
```

---

## 9. Known Issues / Limitations

- Nhiều file hiện có lỗi mã hóa hoặc mojibake, ví dụ [README.md](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/README.md), [HomePage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/HomePage.jsx) và [Layout.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/components/Layout.jsx).
- Hệ thống dùng PostgreSQL JSONB để lưu geometry, chưa phải PostGIS.
- Không thấy automated test trong source hiện tại.
- Không thấy CI pipeline hoặc deployment manifest trong repo.
- Các thao tác Earth Engine đang chạy đồng bộ, có thể chậm với request lớn.
- Các model domain chính `managed = False`, nên schema phải tự quản lý bằng SQL và script.
- `MapContextView` kiểm tra point-in-polygon bằng Shapely phía Python trên dữ liệu boundary đã load, không tối ưu bằng spatial index trong DB.
- Geocoding và routing mặc định phụ thuộc vào Nominatim và OSRM public, nên chịu rủi ro rate limit hoặc downtime.
- Script bootstrap hành chính chuẩn đang phụ thuộc vào dataset ngoài nhưng dataset đó không có trong snapshot source hiện tại.
- Frontend bundle khá lớn, build có cảnh báo chunk size.
- CRS được suy ra là EPSG:4326 nhưng chưa được enforce rõ ràng trong mọi geometry JSON.
- Healthcheck route ở [backend/config/urls.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/config/urls.py) chưa phản ánh hết các endpoint map mới.
- Vẫn còn một implementation legacy đầy đủ trong `legacy/node-express/`, làm tăng chi phí bảo trì.
- Flask GEE service trong [api_server.py](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/api_server.py) còn chứa dấu vết logic cũ và một số comment hoặc log chưa sạch.

---

## 10. What Has NOT Been Implemented Yet

Các mục dưới đây không thấy hiện diện trong source code hiện tại:
- Chưa có PostGIS-backed spatial query engine thực sự.
- Chưa có geocoder hoặc routing engine local/offline.
- Chưa có admin dashboard để quản trị người dùng hoặc nội dung.
- Chưa có background job queue cho GEE sync.
- Chưa có cache hoặc retry layer cho geocoding và routing.
- Chưa có export CSV, PDF hoặc report chính thức.
- Chưa có automated test suite.
- Chưa có Docker, Kubernetes hoặc cloud deployment manifests.
- Chưa có UI compare dạng swipe hoặc split-screen cho bản đồ.
- Chưa có trung tâm cảnh báo hoặc notification cho ngưỡng hạn hay thời tiết.
- Chưa thấy mô hình phân quyền chi tiết beyond authenticated vs unauthenticated.
- Chưa có pipeline transform CRS hoặc hỗ trợ multi-CRS.
- Chưa thấy cơ chế cache raster hoặc tile server-side.
- Chưa có mobile hoặc native client riêng.
- Chưa có dataset `external/vietnamese-provinces-database` đi kèm ngay trong repo snapshot này.

---

## Final Notes For A New AI Assistant

Nếu một AI assistant mới vào repo này để chỉnh sửa an toàn, mô hình tinh thần quan trọng nhất là:

1. Django là orchestration layer.
2. Flask `api_server.py` là Earth Engine execution layer.
3. PostgreSQL lưu dữ liệu nghiệp vụ và geometry history, nhưng không phải PostGIS.
4. Frontend React đã hỗ trợ song song:
   - location mode
   - geometry mode
5. [MapPage.jsx](/d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/frontend/src/pages/MapPage.jsx) là trung tâm tương tác GIS chính và là điểm vào quan trọng nhất của feature không gian.
6. Dữ liệu khí hậu có thể đến từ:
   - DB-backed historical sync
   - live GEE analysis
7. Rủi ro kỹ thuật lớn nhất hiện tại là:
   - lỗi encoding
   - thiếu test
   - manual schema management
   - phụ thuộc service ngoài
   - độ trễ của GEE khi chạy đồng bộ
