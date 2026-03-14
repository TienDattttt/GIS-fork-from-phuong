"""
api_server.py - Flask API Server để nhận request từ UI và tải dữ liệu GEE
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import ee
import pandas as pd
import psycopg2
from datetime import datetime
import threading

app = Flask(__name__)
CORS(app)

# Database config
DB_CONFIG = {
    'dbname': 'web_gis',
    'user': 'postgres',
    'password': 'thanhphuong',
    'host': 'localhost',
    'port': 5432
}

# Initialize GEE
def initialize_gee():
    try:
        # Ép buộc dùng đúng project
        ee.Initialize(project='healthy-sign-476116-g0')
        print("✅ GEE initialized with project healthy-sign-476116-g0")
        return True
    except Exception as e:
        print(f"❌ GEE Initialize Error: {e}")
        return False

PROVINCE_MAPPING = {
    'Quảng Trị': 'Quang Tri',
    'Quang Tri': 'Quang Tri',
    'Thừa Thiên Huế': 'Thua Thien-Hue',
    'Đà Nẵng': 'Da Nang',
    'Quảng Nam': 'Quang Nam',
    'Quảng Ngãi': 'Quang Ngai',
    'Bình Định': 'Binh Dinh',
    'Hà Nội': 'Ha Noi',
    'Hồ Chí Minh': 'Ho Chi Minh city',
    # Thêm các tỉnh khác nếu cần
}

# Get region geometry
def get_region_geometry(province_name):
    try:
        # Chuyển đổi tên tỉnh sang tên trong GAUL
        gaul_name = PROVINCE_MAPPING.get(province_name, province_name)
        print(f"🔍 Searching for province: {province_name} -> {gaul_name}")
        
        gadm = ee.FeatureCollection("FAO/GAUL/2015/level1")
        
        # Filter Vietnam first
        vietnam = gadm.filter(ee.Filter.eq('ADM0_NAME', 'Viet Nam'))
        
        # Tìm tỉnh
        region = vietnam.filter(ee.Filter.eq('ADM1_NAME', gaul_name))
        count = region.size().getInfo()
        
        if count == 0:
            # Thử tìm với tên gốc
            region = vietnam.filter(ee.Filter.eq('ADM1_NAME', province_name))
            count = region.size().getInfo()
        
        if count == 0:
            # In ra danh sách tỉnh để debug
            all_names = vietnam.aggregate_array('ADM1_NAME').getInfo()
            print(f"❌ Province not found. Available provinces in Vietnam:")
            for name in sorted(all_names):
                print(f"   - {name}")
            return None
            
        print(f"✅ Found province: {gaul_name}")
        return region.geometry()
    except Exception as e:
        print(f"Error: {e}")
        return None

# RAINFALL
def get_rainfall_data(geometry, start_date, end_date, location_id):
    try:
        collection = (
            ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
        )
        
        size = collection.size().getInfo()
        if size == 0:
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            mean_val = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=5000,
                maxPixels=1e13
            ).get('precipitation')
            
            rainfall = mean_val.getInfo() if mean_val else 0
            return {
                'location_id': location_id,
                'date': date,
                'rainfall_mm': round(rainfall, 2) if rainfall else 0,
                'source': 'CHIRPS'
            }
        
        images = collection.toList(size)
        data = [extract(ee.Image(images.get(i))) for i in range(size)]
        return pd.DataFrame(data)
    except Exception as e:
        print(f"Rainfall error: {e}")
        return pd.DataFrame()

# TEMPERATURE
def get_temperature_data(geometry, start_date, end_date, location_id):
    try:
        # Thử ERA5_LAND trước (có dữ liệu mới hơn)
        collection = (
            ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['temperature_2m', 'temperature_2m_min', 'temperature_2m_max'])
        )
        
        size = collection.size().getInfo()
        print(f"📊 Temperature collection size: {size}")
        
        if size == 0:
            print("❌ No temperature data found for this period")
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            stats = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=10000,
                maxPixels=1e13
            )
            
            t_mean = stats.get('temperature_2m')
            t_min = stats.get('temperature_2m_min')
            t_max = stats.get('temperature_2m_max')
            
            return {
                'location_id': location_id,
                'date': date,
                'temp_mean': round(t_mean.getInfo() - 273.15, 2) if t_mean else None,
                'temp_min': round(t_min.getInfo() - 273.15, 2) if t_min else None,
                'temp_max': round(t_max.getInfo() - 273.15, 2) if t_max else None,
                'source': 'ERA5-Land'
            }
        
        images = collection.toList(size)
        data = [extract(ee.Image(images.get(i))) for i in range(size)]
        return pd.DataFrame(data)
    except Exception as e:
        print(f"Temperature error: {e}")
        return pd.DataFrame()
    
# SOIL MOISTURE
def get_soil_moisture_data(geometry, start_date, end_date, location_id):
    try:
        collection = (
            ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select([
                'volumetric_soil_water_layer_1',
                'volumetric_soil_water_layer_2',
                'volumetric_soil_water_layer_3'
            ])
        )
        
        size = collection.size().getInfo()
        if size == 0:
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            stats = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=10000,
                maxPixels=1e13
            )
            
            sm_surf = stats.get('volumetric_soil_water_layer_1')
            sm_root = stats.get('volumetric_soil_water_layer_2')
            sm_prof = stats.get('volumetric_soil_water_layer_3')
            
            return {
                'location_id': location_id,
                'date': date,
                'sm_surface': round(sm_surf.getInfo(), 4) if sm_surf else None,
                'sm_rootzone': round(sm_root.getInfo(), 4) if sm_root else None,
                'sm_profile': round(sm_prof.getInfo(), 4) if sm_prof else None,
                'source': 'ERA5-Land'
            }
        
        images = collection.toList(size)
        data = [extract(ee.Image(images.get(i))) for i in range(size)]
        return pd.DataFrame(data)
    except Exception as e:
        print(f"Soil moisture error: {e}")
        return pd.DataFrame()

# NDVI
def get_ndvi_data(geometry, start_date, end_date, location_id):
    try:
        collection = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI'])
        )
        
        size = collection.size().getInfo()
        if size == 0:
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            ndvi_img = img.select('NDVI').multiply(0.0001)
            
            stats = ndvi_img.reduceRegion(
                reducer=ee.Reducer.mean()
                    .combine(ee.Reducer.min(), '', True)
                    .combine(ee.Reducer.max(), '', True)
                    .combine(ee.Reducer.stdDev(), '', True),
                geometry=geometry,
                scale=250,
                maxPixels=1e13
            )
            
            veg_mask = ndvi_img.gt(0.2)
            veg_area = veg_mask.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=250,
                maxPixels=1e13
            ).get('NDVI')
            
            ndvi_mean = stats.get('NDVI_mean')
            ndvi_min = stats.get('NDVI_min')
            ndvi_max = stats.get('NDVI_max')
            ndvi_std = stats.get('NDVI_stdDev')
            
            return {
                'location_id': location_id,
                'date': date,
                'ndvi_mean': round(ndvi_mean.getInfo(), 4) if ndvi_mean else None,
                'ndvi_min': round(ndvi_min.getInfo(), 4) if ndvi_min else None,
                'ndvi_max': round(ndvi_max.getInfo(), 4) if ndvi_max else None,
                'ndvi_stddev': round(ndvi_std.getInfo(), 4) if ndvi_std else None,
                'vegetation_area_pct': round(veg_area.getInfo() * 100, 2) if veg_area else None,
                'source': 'MODIS'
            }
        
        images = collection.toList(size)
        data = [extract(ee.Image(images.get(i))) for i in range(size)]
        return pd.DataFrame(data)
    except Exception as e:
        print(f"NDVI error: {e}")
        return pd.DataFrame()

# TVDI
# TVDI CHUẨN (Sandholt, 2002)
# TVDI - Phiên bản đơn giản hóa và sửa lỗi
def get_tvdi_data(geometry, start_date, end_date, location_id):
    try:
        # Lấy LST từ MOD11A2
        lst_col = (
            ee.ImageCollection("MODIS/061/MOD11A2")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['LST_Day_1km'])
        )
        
        # Lấy NDVI từ MOD13Q1
        ndvi_col = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI'])
        )
        
        lst_size = lst_col.size().getInfo()
        print(f"📊 LST collection size: {lst_size}")
        
        if lst_size == 0:
            print("❌ No LST data found")
            return pd.DataFrame()
        
        data = []
        lst_list = lst_col.toList(lst_size)
        
        for i in range(lst_size):
            try:
                lst_img = ee.Image(lst_list.get(i))
                date = ee.Date(lst_img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
                print(f"  Processing: {date}")
                
                # Chuyển đổi LST sang độ C
                lst = lst_img.select('LST_Day_1km').multiply(0.02).subtract(273.15)
                
                # Tính thống kê LST
                lst_stats = lst.reduceRegion(
                    reducer=ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', True)
                        .combine(ee.Reducer.max(), '', True),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                )
                
                lst_mean = lst_stats.get('LST_Day_1km_mean')
                lst_min = lst_stats.get('LST_Day_1km_min')
                lst_max = lst_stats.get('LST_Day_1km_max')
                
                lst_mean_val = lst_mean.getInfo() if lst_mean else None
                lst_min_val = lst_min.getInfo() if lst_min else None
                lst_max_val = lst_max.getInfo() if lst_max else None
                
                if lst_min_val is None or lst_max_val is None:
                    print(f"    ⚠️ Skip {date}: No LST data")
                    continue
                
                # Tính TVDI đơn giản: (LST - LST_min) / (LST_max - LST_min)
                lst_range = lst_max_val - lst_min_val
                if lst_range <= 0:
                    print(f"    ⚠️ Skip {date}: LST range = 0")
                    continue
                
                tvdi_img = lst.subtract(lst_min_val).divide(lst_range)
                
                # Thống kê TVDI
                tvdi_stats = tvdi_img.reduceRegion(
                    reducer=ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', True)
                        .combine(ee.Reducer.max(), '', True),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                )
                
                tvdi_mean = tvdi_stats.get('LST_Day_1km_mean')
                tvdi_min = tvdi_stats.get('LST_Day_1km_min')
                tvdi_max = tvdi_stats.get('LST_Day_1km_max')
                
                tvdi_mean_val = tvdi_mean.getInfo() if tvdi_mean else None
                tvdi_min_val = tvdi_min.getInfo() if tvdi_min else None
                tvdi_max_val = tvdi_max.getInfo() if tvdi_max else None
                
                # Tính diện tích hạn (TVDI > 0.6)
                drought_mask = tvdi_img.gt(0.6)
                drought_pct = drought_mask.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                ).get('LST_Day_1km')
                drought_pct_val = drought_pct.getInfo() if drought_pct else 0
                
                # Phân loại hạn
                def classify_drought(tvdi):
                    if tvdi is None:
                        return 'unknown'
                    if tvdi < 0.2:
                        return 'wet'
                    elif tvdi < 0.4:
                        return 'normal'
                    elif tvdi < 0.6:
                        return 'moderate'
                    elif tvdi < 0.8:
                        return 'severe'
                    else:
                        return 'extreme'
                
                record = {
                    'location_id': location_id,
                    'date': date,
                    'tvdi_mean': round(tvdi_mean_val, 4) if tvdi_mean_val else None,
                    'tvdi_min': round(tvdi_min_val, 4) if tvdi_min_val else None,
                    'tvdi_max': round(tvdi_max_val, 4) if tvdi_max_val else None,
                    'lst_mean': round(lst_mean_val, 2) if lst_mean_val else None,
                    'drought_area_pct': round(drought_pct_val * 100, 2) if drought_pct_val else 0,
                    'drought_class': classify_drought(tvdi_mean_val),
                    'source': 'MODIS-LST-TVDI'
                }
                
                data.append(record)
                print(f"    ✅ {date}: TVDI={tvdi_mean_val:.4f}, LST={lst_mean_val:.2f}°C")
                
            except Exception as e:
                print(f"    ❌ Error processing image {i}: {e}")
                continue
        
        print(f"📊 Total records: {len(data)}")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"TVDI error: {e}")
        return pd.DataFrame()

# Save to database
def save_to_database(df, table_name):
    if df.empty:
        return 0
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        saved = 0
        
        for _, row in df.iterrows():
            try:
                if table_name == 'rainfall_data':
                    cur.execute("""
                        INSERT INTO rainfall_data (location_id, date, rainfall_mm, source)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET rainfall_mm = EXCLUDED.rainfall_mm, source = EXCLUDED.source
                    """, (row['location_id'], row['date'], row['rainfall_mm'], row['source']))
                
                elif table_name == 'temperature_data':
                    cur.execute("""
                        INSERT INTO temperature_data 
                        (location_id, date, temp_min, temp_max, temp_mean, source)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max,
                            temp_mean = EXCLUDED.temp_mean, source = EXCLUDED.source
                    """, (row['location_id'], row['date'], row['temp_min'], 
                          row['temp_max'], row['temp_mean'], row['source']))
                
                elif table_name == 'soil_moisture_data':
                    cur.execute("""
                        INSERT INTO soil_moisture_data 
                        (location_id, date, sm_surface, sm_rootzone, sm_profile, source)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET sm_surface = EXCLUDED.sm_surface, sm_rootzone = EXCLUDED.sm_rootzone,
                            sm_profile = EXCLUDED.sm_profile, source = EXCLUDED.source
                    """, (row['location_id'], row['date'], row['sm_surface'], 
                          row['sm_rootzone'], row['sm_profile'], row['source']))
                
                elif table_name == 'ndvi_data':
                    cur.execute("""
                        INSERT INTO ndvi_data 
                        (location_id, date, ndvi_mean, ndvi_min, ndvi_max, ndvi_stddev, 
                         vegetation_area_pct, source)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET ndvi_mean = EXCLUDED.ndvi_mean, ndvi_min = EXCLUDED.ndvi_min,
                            ndvi_max = EXCLUDED.ndvi_max, ndvi_stddev = EXCLUDED.ndvi_stddev,
                            vegetation_area_pct = EXCLUDED.vegetation_area_pct, source = EXCLUDED.source
                    """, (row['location_id'], row['date'], row['ndvi_mean'], row['ndvi_min'],
                          row['ndvi_max'], row['ndvi_stddev'], row['vegetation_area_pct'], row['source']))
                
                elif table_name == 'tvdi_data':
                    cur.execute("""
                        INSERT INTO tvdi_data 
                        (location_id, date, tvdi_mean, tvdi_min, tvdi_max, lst_mean,
                         drought_area_pct, drought_class, source)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET tvdi_mean = EXCLUDED.tvdi_mean, tvdi_min = EXCLUDED.tvdi_min,
                            tvdi_max = EXCLUDED.tvdi_max, lst_mean = EXCLUDED.lst_mean,
                            drought_area_pct = EXCLUDED.drought_area_pct, 
                            drought_class = EXCLUDED.drought_class, source = EXCLUDED.source
                    """, (row['location_id'], row['date'], row['tvdi_mean'], row['tvdi_min'],
                          row['tvdi_max'], row['lst_mean'], row['drought_area_pct'], 
                          row['drought_class'], row['source']))
                
                saved += 1
            except Exception as e:
                print(f"Save error: {e}")
        
        conn.commit()
        cur.close()
        conn.close()
        return saved
    except Exception as e:
        print(f"DB error: {e}")
        return 0

# API Endpoints
@app.route('/fetch-data', methods=['POST'])
def fetch_data():
    try:
        data = request.json
        province = data.get('province')
        location_id = data.get('location_id')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        data_types = data.get('data_types', [])
        
        if not all([province, location_id, start_date, end_date]):
            return jsonify({'error': 'Missing required parameters'}), 400
        
        # Initialize GEE
        if not initialize_gee():
            return jsonify({'error': 'Failed to initialize Google Earth Engine'}), 500
        
        # Get geometry
        geometry = get_region_geometry(province)
        if geometry is None:
            return jsonify({'error': f'Province not found: {province}'}), 404
        
        results = {}
        
        # Fetch data based on selected types
        if 'rainfall' in data_types:
            df = get_rainfall_data(geometry, start_date, end_date, location_id)
            saved = save_to_database(df, 'rainfall_data')
            results['rainfall'] = {'records': saved}
        
        if 'temperature' in data_types:
            df = get_temperature_data(geometry, start_date, end_date, location_id)
            saved = save_to_database(df, 'temperature_data')
            results['temperature'] = {'records': saved}
        
        if 'soil_moisture' in data_types:
            df = get_soil_moisture_data(geometry, start_date, end_date, location_id)
            saved = save_to_database(df, 'soil_moisture_data')
            results['soil_moisture'] = {'records': saved}
        
        if 'ndvi' in data_types:
            df = get_ndvi_data(geometry, start_date, end_date, location_id)
            saved = save_to_database(df, 'ndvi_data')
            results['ndvi'] = {'records': saved}
        
        if 'tvdi' in data_types:
            df = get_tvdi_data(geometry, start_date, end_date, location_id)
            saved = save_to_database(df, 'tvdi_data')
            results['tvdi'] = {'records': saved}
        
        return jsonify({
            'success': True,
            'province': province,
            'location_id': location_id,
            'period': f'{start_date} to {end_date}',
            'results': results
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    return jsonify({
        'status': 'online',
        'gee_initialized': initialize_gee()
    })

if __name__ == '__main__':
    print("=" * 70)
    print("     🌍 Data Fetcher API Server")
    print("=" * 70)
    print("  Running on: http://localhost:3001")
    print("  UI: Open data_fetcher.html in browser")
    print("=" * 70)
    app.run(host='0.0.0.0', port=3001, debug=True)