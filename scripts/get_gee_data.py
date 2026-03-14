"""
get_gee_data.py - Script lấy dữ liệu từ Google Earth Engine
Bao gồm: Lượng mưa, Nhiệt độ, Độ ẩm đất, NDVI, TVDI
"""

import ee
import pandas as pd
import psycopg2
from datetime import datetime, timedelta
import numpy as np

# ================== CẤU HÌNH ==================
DB_CONFIG = {
    'dbname': 'web_gis',
    'user': 'postgres',
    'password': 'thanhphuong',
    'host': 'localhost',
    'port': 5432
}

PROVINCE = "Quang Tri"
LOCATION_ID = 1
START_DATE = "2020-01-01"
END_DATE = "2020-1-31"

# ===============================================

def initialize_gee():
    """Khởi tạo Google Earth Engine"""
    try:
        try:
            ee.Initialize()
            print("✅ Đã kết nối GEE thành công! (No project)")
            return True
        except:
            ee.Initialize(project='where-earthengine')
            print("✅ Đã kết nối GEE thành công! (With project)")
            return True
    except Exception as e:
        print(f"❌ Lỗi khi khởi tạo GEE: {e}")
        print("\n🔧 Chạy: earthengine authenticate")
        return False

def get_region_geometry(province_name):
    """Lấy geometry của tỉnh từ GADM"""
    try:
        gadm = ee.FeatureCollection("FAO/GAUL/2015/level1")
        region = gadm.filter(ee.Filter.eq('ADM1_NAME', province_name))
        
        count = region.size().getInfo()
        if count == 0:
            print(f"⚠️ Không tìm thấy '{province_name}'")
            return None
        
        print(f"✅ Đã tìm thấy khu vực: {province_name}")
        return region.geometry()
    except Exception as e:
        print(f"❌ Lỗi khi lấy geometry: {e}")
        return None

# ==================== RAINFALL ====================
def get_rainfall_data(geometry, start_date, end_date, location_id):
    """Lấy dữ liệu lượng mưa từ CHIRPS"""
    print(f"\n🌧️ Đang lấy dữ liệu LƯỢNG MƯA...")
    
    try:
        collection = (
            ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
        )
        
        size = collection.size().getInfo()
        print(f"   Tìm thấy {size} ngày dữ liệu")
        
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
        data = []
        
        for i in range(size):
            try:
                result = extract(ee.Image(images.get(i)))
                data.append(result)
                if (i + 1) % 30 == 0:
                    print(f"   ⏳ {i + 1}/{size} ({((i+1)/size*100):.1f}%)")
            except Exception as e:
                print(f"   ⚠️ Lỗi ngày {i}: {e}")
        
        print(f"✅ Hoàn thành! {len(data)} bản ghi")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        return pd.DataFrame()

# ==================== TEMPERATURE ====================
def get_temperature_data(geometry, start_date, end_date, location_id):
    """Lấy dữ liệu nhiệt độ từ ERA5"""
    print(f"\n🌡️ Đang lấy dữ liệu NHIỆT ĐỘ...")
    
    try:
        collection = (
            ee.ImageCollection("ECMWF/ERA5/DAILY")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['mean_2m_air_temperature', 'minimum_2m_air_temperature', 
                     'maximum_2m_air_temperature'])
        )
        
        size = collection.size().getInfo()
        print(f"   Tìm thấy {size} ngày dữ liệu")
        
        if size == 0:
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            stats = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=25000,
                maxPixels=1e13
            )
            
            t_mean = stats.get('mean_2m_air_temperature')
            t_min = stats.get('minimum_2m_air_temperature')
            t_max = stats.get('maximum_2m_air_temperature')
            
            return {
                'location_id': location_id,
                'date': date,
                'temp_mean': round(t_mean.getInfo() - 273.15, 2) if t_mean else None,
                'temp_min': round(t_min.getInfo() - 273.15, 2) if t_min else None,
                'temp_max': round(t_max.getInfo() - 273.15, 2) if t_max else None,
                'source': 'ERA5'
            }
        
        images = collection.toList(size)
        data = []
        
        for i in range(size):
            try:
                result = extract(ee.Image(images.get(i)))
                data.append(result)
                if (i + 1) % 30 == 0:
                    print(f"   ⏳ {i + 1}/{size} ({((i+1)/size*100):.1f}%)")
            except Exception as e:
                print(f"   ⚠️ Lỗi ngày {i}: {e}")
        
        print(f"✅ Hoàn thành! {len(data)} bản ghi")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        return pd.DataFrame()

# ==================== SOIL MOISTURE ====================
def get_soil_moisture_data(geometry, start_date, end_date, location_id):
    """Lấy dữ liệu độ ẩm đất từ NASA SMAP hoặc ERA5-Land"""
    print(f"\n💧 Đang lấy dữ liệu ĐỘ ẨM ĐẤT...")
    
    try:
        # Sử dụng ERA5-Land cho độ ẩm đất (có sẵn và ổn định hơn)
        collection = (
            ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select([
                'volumetric_soil_water_layer_1',  # 0-7cm
                'volumetric_soil_water_layer_2',  # 7-28cm
                'volumetric_soil_water_layer_3',  # 28-100cm
                'volumetric_soil_water_layer_4'   # 100-289cm
            ])
        )
        
        size = collection.size().getInfo()
        print(f"   Tìm thấy {size} ngày dữ liệu (ERA5-Land)")
        
        if size == 0:
            # Fallback to SMAP
            print("   Thử NASA SMAP...")
            collection = (
                ee.ImageCollection("NASA/SMAP/SPL4SMGP/007")
                .filterBounds(geometry)
                .filterDate(start_date, end_date)
                .select(['sm_surface', 'sm_rootzone', 'sm_profile'])
            )
            size = collection.size().getInfo()
            print(f"   Tìm thấy {size} ngày dữ liệu (SMAP)")
            
            if size == 0:
                return pd.DataFrame()
            
            source = 'SMAP'
            bands = ['sm_surface', 'sm_rootzone', 'sm_profile']
        else:
            source = 'ERA5-Land'
            bands = ['volumetric_soil_water_layer_1', 
                     'volumetric_soil_water_layer_2', 
                     'volumetric_soil_water_layer_3']
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            stats = img.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=10000,
                maxPixels=1e13
            )
            
            if source == 'SMAP':
                sm_surf = stats.get('sm_surface')
                sm_root = stats.get('sm_rootzone')
                sm_prof = stats.get('sm_profile')
            else:
                sm_surf = stats.get('volumetric_soil_water_layer_1')
                sm_root = stats.get('volumetric_soil_water_layer_2')
                sm_prof = stats.get('volumetric_soil_water_layer_3')
            
            return {
                'location_id': location_id,
                'date': date,
                'sm_surface': round(sm_surf.getInfo(), 4) if sm_surf else None,
                'sm_rootzone': round(sm_root.getInfo(), 4) if sm_root else None,
                'sm_profile': round(sm_prof.getInfo(), 4) if sm_prof else None,
                'source': source
            }
        
        images = collection.toList(size)
        data = []
        
        for i in range(size):
            try:
                result = extract(ee.Image(images.get(i)))
                data.append(result)
                if (i + 1) % 30 == 0:
                    print(f"   ⏳ {i + 1}/{size} ({((i+1)/size*100):.1f}%)")
            except Exception as e:
                print(f"   ⚠️ Lỗi ngày {i}: {e}")
        
        print(f"✅ Hoàn thành! {len(data)} bản ghi")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        return pd.DataFrame()

# ==================== NDVI ====================
def get_ndvi_data(geometry, start_date, end_date, location_id):
    """Lấy dữ liệu NDVI từ MODIS"""
    print(f"\n🌿 Đang lấy dữ liệu NDVI...")
    
    try:
        # MODIS NDVI 16-day composite
        collection = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI', 'EVI'])
        )
        
        size = collection.size().getInfo()
        print(f"   Tìm thấy {size} ảnh (16-day composite)")
        
        if size == 0:
            return pd.DataFrame()
        
        def extract(img):
            date = ee.Date(img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            
            # MODIS NDVI scale factor = 0.0001
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
            
            # Tính % diện tích có thực vật (NDVI > 0.2)
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
        data = []
        
        for i in range(size):
            try:
                result = extract(ee.Image(images.get(i)))
                data.append(result)
                if (i + 1) % 10 == 0:
                    print(f"   ⏳ {i + 1}/{size} ({((i+1)/size*100):.1f}%)")
            except Exception as e:
                print(f"   ⚠️ Lỗi ảnh {i}: {e}")
        
        print(f"✅ Hoàn thành! {len(data)} bản ghi")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        return pd.DataFrame()

# ==================== TVDI ====================
def get_tvdi_data(geometry, start_date, end_date, location_id):
    """
    Tính TVDI (Temperature Vegetation Dryness Index)
    TVDI = (LST - LSTmin) / (LSTmax - LSTmin)
    Trong đó LSTmax và LSTmin là hàm của NDVI
    """
    print(f"\n🔥 Đang tính TVDI (Temperature Vegetation Dryness Index)...")
    
    try:
        # Lấy MODIS LST và NDVI cùng thời điểm
        # LST từ MOD11A2 (8-day composite)
        lst_collection = (
            ee.ImageCollection("MODIS/061/MOD11A2")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['LST_Day_1km'])
        )
        
        # NDVI từ MOD13Q1 (16-day composite)
        ndvi_collection = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI'])
        )
        
        lst_size = lst_collection.size().getInfo()
        print(f"   LST: {lst_size} ảnh, NDVI: {ndvi_collection.size().getInfo()} ảnh")
        
        if lst_size == 0:
            return pd.DataFrame()
        
        def calculate_tvdi(lst_img):
            date = ee.Date(lst_img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
            
            # Convert LST to Celsius (scale factor = 0.02, offset = -273.15)
            lst = lst_img.select('LST_Day_1km').multiply(0.02).subtract(273.15)
            
            # Lấy NDVI gần nhất
            ndvi_img = ndvi_collection.filterDate(
                ee.Date(lst_img.get('system:time_start')).advance(-16, 'day'),
                ee.Date(lst_img.get('system:time_start')).advance(16, 'day')
            ).mean().select('NDVI').multiply(0.0001)
            
            # Tính LST stats
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
            
            # Tính TVDI đơn giản hóa
            # TVDI = (LST - LSTmin) / (LSTmax - LSTmin)
            lst_range = ee.Number(lst_max).subtract(ee.Number(lst_min))
            tvdi_val = ee.Number(lst_mean).subtract(ee.Number(lst_min)).divide(lst_range)
            
            # TVDI stats cho toàn vùng
            tvdi_img = lst.subtract(ee.Number(lst_min)).divide(lst_range)
            tvdi_stats = tvdi_img.reduceRegion(
                reducer=ee.Reducer.mean()
                    .combine(ee.Reducer.min(), '', True)
                    .combine(ee.Reducer.max(), '', True),
                geometry=geometry,
                scale=1000,
                maxPixels=1e13
            )
            
            # Tính % diện tích khô hạn (TVDI > 0.6)
            drought_mask = tvdi_img.gt(0.6)
            drought_pct = drought_mask.reduceRegion(
                reducer=ee.Reducer.mean(),
                geometry=geometry,
                scale=1000,
                maxPixels=1e13
            ).get('LST_Day_1km')
            
            tvdi_mean_val = tvdi_stats.get('LST_Day_1km_mean')
            tvdi_min_val = tvdi_stats.get('LST_Day_1km_min')
            tvdi_max_val = tvdi_stats.get('LST_Day_1km_max')
            
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
            
            tvdi_val_info = tvdi_mean_val.getInfo() if tvdi_mean_val else None
            
            return {
                'location_id': location_id,
                'date': date,
                'tvdi_mean': round(tvdi_val_info, 4) if tvdi_val_info else None,
                'tvdi_min': round(tvdi_min_val.getInfo(), 4) if tvdi_min_val else None,
                'tvdi_max': round(tvdi_max_val.getInfo(), 4) if tvdi_max_val else None,
                'lst_mean': round(lst_mean.getInfo(), 2) if lst_mean else None,
                'drought_area_pct': round(drought_pct.getInfo() * 100, 2) if drought_pct else None,
                'drought_class': classify_drought(tvdi_val_info),
                'source': 'MODIS-LST-NDVI'
            }
        
        lst_images = lst_collection.toList(lst_size)
        data = []
        
        for i in range(lst_size):
            try:
                result = calculate_tvdi(ee.Image(lst_images.get(i)))
                data.append(result)
                if (i + 1) % 10 == 0:
                    print(f"   ⏳ {i + 1}/{lst_size} ({((i+1)/lst_size*100):.1f}%)")
            except Exception as e:
                print(f"   ⚠️ Lỗi ảnh {i}: {e}")
        
        print(f"✅ Hoàn thành! {len(data)} bản ghi")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"❌ Lỗi: {e}")
        return pd.DataFrame()

# ==================== DATABASE ====================
def save_to_database(df, table_name):
    """Lưu DataFrame vào PostgreSQL"""
    if df.empty:
        print(f"⚠️ Không có dữ liệu để lưu vào {table_name}")
        return
    
    print(f"\n💾 Đang lưu {len(df)} bản ghi vào {table_name}...")
    
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        saved = 0
        errors = 0
        
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
                errors += 1
                if errors <= 3:
                    print(f"   ⚠️ Lỗi: {e}")
        
        conn.commit()
        cur.close()
        conn.close()
        
        print(f"✅ Đã lưu {saved}/{len(df)} bản ghi")
        if errors > 0:
            print(f"⚠️ Có {errors} lỗi")
            
    except Exception as e:
        print(f"❌ Lỗi kết nối database: {e}")

# ==================== MAIN ====================
def main():
    print("=" * 70)
    print("     🌍 GOOGLE EARTH ENGINE - DATA EXTRACTION")
    print("     Rainfall | Temperature | Soil Moisture | NDVI | TVDI")
    print("=" * 70)
    
    if not initialize_gee():
        return
    
    print(f"\n📍 Khu vực: {PROVINCE}")
    print(f"📅 Thời gian: {START_DATE} → {END_DATE}")
    
    geometry = get_region_geometry(PROVINCE)
    if geometry is None:
        return
    
    # 1. Lượng mưa
    print("\n" + "=" * 70)
    rainfall_df = get_rainfall_data(geometry, START_DATE, END_DATE, LOCATION_ID)
    if not rainfall_df.empty:
        save_to_database(rainfall_df, 'rainfall_data')
    
    # 2. Nhiệt độ
    print("\n" + "=" * 70)
    temp_df = get_temperature_data(geometry, START_DATE, END_DATE, LOCATION_ID)
    if not temp_df.empty:
        save_to_database(temp_df, 'temperature_data')
    
    # 3. Độ ẩm đất
    print("\n" + "=" * 70)
    sm_df = get_soil_moisture_data(geometry, START_DATE, END_DATE, LOCATION_ID)
    if not sm_df.empty:
        save_to_database(sm_df, 'soil_moisture_data')
    
    # 4. NDVI
    print("\n" + "=" * 70)
    ndvi_df = get_ndvi_data(geometry, START_DATE, END_DATE, LOCATION_ID)
    if not ndvi_df.empty:
        save_to_database(ndvi_df, 'ndvi_data')
    
    # 5. TVDI
    print("\n" + "=" * 70)
    tvdi_df = get_tvdi_data(geometry, START_DATE, END_DATE, LOCATION_ID)
    if not tvdi_df.empty:
        save_to_database(tvdi_df, 'tvdi_data')
    
    # Tổng kết
    print("\n" + "=" * 70)
    print("                    ✅ HOÀN THÀNH!")
    print("=" * 70)
    print(f"  🌧️  Lượng mưa:    {len(rainfall_df)} bản ghi")
    print(f"  🌡️  Nhiệt độ:     {len(temp_df)} bản ghi")
    print(f"  💧 Độ ẩm đất:    {len(sm_df)} bản ghi")
    print(f"  🌿 NDVI:         {len(ndvi_df)} bản ghi")
    print(f"  🔥 TVDI:         {len(tvdi_df)} bản ghi")
    print("=" * 70)

if __name__ == "__main__":
    main()