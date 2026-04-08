"""
api_server.py - Flask API Server Ä‘á»ƒ nháº­n request tá»« UI vÃ  táº£i dá»¯ liá»‡u GEE
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import ee
import pandas as pd
import psycopg2
import json
from datetime import datetime
import threading
import os
import re
import unicodedata
from pathlib import Path
from dotenv import load_dotenv

app = Flask(__name__)
CORS(app)

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

# Database config
DB_CONFIG = {
    'dbname': os.getenv('DB_NAME', 'web_gis'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASS', ''),
    'host': os.getenv('DB_HOST', 'localhost'),
    'port': int(os.getenv('DB_PORT', '5432'))
}

# Initialize GEE
def _initialize_gee_legacy():
    try:
        # Ã‰p buá»™c dÃ¹ng Ä‘Ãºng project
        gee_project = os.getenv('GEE_PROJECT', 'healthy-sign-476116-g0')
        ee.Initialize(project=gee_project)
        print(f"GEE initialized with project {gee_project}")
        return True
    except Exception as e:
        print(f"GEE initialize error: {e}")
        return False

GEE_STATE = {
    "initialized": False,
    "project": os.getenv("GEE_PROJECT", "healthy-sign-476116-g0"),
    "auth_mode": None,
    "last_error": None,
}


def initialize_gee(force=False):
    if GEE_STATE["initialized"] and not force:
        return True

    try:
        gee_project = GEE_STATE["project"]
        service_account = os.getenv("GEE_SERVICE_ACCOUNT", "").strip()
        key_file = os.getenv("GEE_PRIVATE_KEY_FILE", "").strip() or os.getenv(
            "GOOGLE_APPLICATION_CREDENTIALS", ""
        ).strip()

        if service_account and key_file:
            credentials = ee.ServiceAccountCredentials(service_account, key_file)
            ee.Initialize(credentials=credentials, project=gee_project)
            GEE_STATE["auth_mode"] = "service_account"
        else:
            ee.Initialize(project=gee_project)
            GEE_STATE["auth_mode"] = "user_oauth"

        GEE_STATE["initialized"] = True
        GEE_STATE["last_error"] = None
        print(f"GEE initialized with project {gee_project} via {GEE_STATE['auth_mode']}")
        return True
    except Exception as e:
        GEE_STATE["initialized"] = False
        GEE_STATE["auth_mode"] = None
        GEE_STATE["last_error"] = str(e)
        print(f"GEE initialize error: {e}")
        return False

PROVINCE_MAPPING = {
    'Quáº£ng Trá»‹': 'Quang Tri',
    'Quang Tri': 'Quang Tri',
    'Thá»«a ThiÃªn Huáº¿': 'Thua Thien-Hue',
    'ÄÃ  Náºµng': 'Da Nang',
    'Quáº£ng Nam': 'Quang Nam',
    'Quáº£ng NgÃ£i': 'Quang Ngai',
    'BÃ¬nh Äá»‹nh': 'Binh Dinh',
    'HÃ  Ná»™i': 'Ha Noi',
    'Há»“ ChÃ­ Minh': 'Ho Chi Minh city',
    # ThÃªm cÃ¡c tá»‰nh khÃ¡c náº¿u cáº§n
}

PROVINCE_MAPPING = {
    "Quáº£ng Trá»‹": "Quang Tri",
    "Quang Tri": "Quang Tri",
    "Thá»«a ThiÃªn Huáº¿": "Thua Thien - Hue",
    "ÄÃ  Náºµng": "Da Nang City",
    "Da Nang": "Da Nang City",
    "Quáº£ng Nam": "Quang Nam",
    "Quáº£ng NgÃ£i": "Quang Ngai",
    "BÃ¬nh Äá»‹nh": "Binh Dinh",
    "HÃ  Ná»™i": "Ha Noi City",
    "Há»“ ChÃ­ Minh": "Ho Chi Minh City",
    "TP. Há»“ ChÃ­ Minh": "Ho Chi Minh City",
    "ThÃ nh phá»‘ Há»“ ChÃ­ Minh": "Ho Chi Minh City",
    "Cáº§n ThÆ¡": "Can Tho city",
    "Háº£i PhÃ²ng": "Hai Phong City",
}


PROVINCE_ALIASES = {
    "da nang": {"da nang city"},
    "ha noi": {"ha noi city"},
    "ho chi minh": {"ho chi minh city", "thanh pho ho chi minh"},
    "can tho": {"can tho city"},
    "hai phong": {"hai phong city"},
    "thua thien hue": {"thua thien hue", "thua thien-hue", "thua thien - hue"},
    "ba ria vung tau": {"ba ria-vung tau"},
}

ADMIN_NAME_TOKENS = {"city", "province", "tinh", "thanh", "pho", "tp"}


def normalize_province_key(value):
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def simplify_province_key(value):
    tokens = [token for token in normalize_province_key(value).split() if token not in ADMIN_NAME_TOKENS]
    return " ".join(tokens).strip()


def build_province_lookup_keys(value):
    normalized = normalize_province_key(value)
    simplified = simplify_province_key(value)
    keys = {key for key in {normalized, simplified} if key}

    for key in list(keys):
        keys.update(PROVINCE_ALIASES.get(key, set()))

    expanded = set(keys)
    for key in list(keys):
        expanded.add(normalize_province_key(key))
        expanded.add(simplify_province_key(key))

    return {key for key in expanded if key}


def resolve_province_name(province_name, available_names):
    requested_keys = build_province_lookup_keys(province_name)
    if not requested_keys:
        return None

    for available_name in available_names:
        available_keys = build_province_lookup_keys(available_name)
        if requested_keys.intersection(available_keys):
            return available_name

    return None


def geometry_payload_to_ee_geometry(geometry_payload):
    if not isinstance(geometry_payload, dict):
        return None

    geometry_type = geometry_payload.get("type")
    try:
        if geometry_type == "FeatureCollection":
            return ee.FeatureCollection(geometry_payload).geometry()
        if geometry_type == "Feature":
            geometry = geometry_payload.get("geometry")
            return ee.Geometry(geometry) if geometry else None
        if geometry_type in {"Polygon", "MultiPolygon"}:
            return ee.Geometry(geometry_payload)
    except Exception as e:
        print(f"Failed to convert GeoJSON to ee.Geometry: {e}")
        return None
    return None


# Get region geometry
def get_region_geometry(province_name):
    try:
        # Chuyá»ƒn Ä‘á»•i tÃªn tá»‰nh sang tÃªn trong GAUL
        gaul_name = PROVINCE_MAPPING.get(province_name, province_name)
        print(f"ðŸ” Searching for province: {province_name} -> {gaul_name}")
        
        gadm = ee.FeatureCollection("FAO/GAUL/2015/level1")
        
        # Filter Vietnam first
        vietnam = gadm.filter(ee.Filter.eq('ADM0_NAME', 'Viet Nam'))
        
        # TÃ¬m tá»‰nh
        region = vietnam.filter(ee.Filter.eq('ADM1_NAME', gaul_name))
        count = region.size().getInfo()
        
        if count == 0:
            # Thá»­ tÃ¬m vá»›i tÃªn gá»‘c
            region = vietnam.filter(ee.Filter.eq('ADM1_NAME', province_name))
            count = region.size().getInfo()
        
        if count == 0:
            # In ra danh sÃ¡ch tá»‰nh Ä‘á»ƒ debug
            all_names = vietnam.aggregate_array('ADM1_NAME').getInfo()
            print(f"âŒ Province not found. Available provinces in Vietnam:")
            for name in sorted(all_names):
                print(f"   - {name}")
            return None
            
        print(f"âœ… Found province: {gaul_name}")
        return region.geometry()
    except Exception as e:
        print(f"Error: {e}")
        return None

def get_region_geometry(province_name):
    try:
        gaul_name = PROVINCE_MAPPING.get(province_name, province_name)
        print(f"Searching for province: {province_name} -> {gaul_name}")

        gadm = ee.FeatureCollection("FAO/GAUL/2015/level1")
        vietnam = gadm.filter(ee.Filter.eq("ADM0_NAME", "Viet Nam"))

        region = vietnam.filter(ee.Filter.eq("ADM1_NAME", gaul_name))
        count = region.size().getInfo()
        matched_name = gaul_name

        if count == 0:
            region = vietnam.filter(ee.Filter.eq("ADM1_NAME", province_name))
            count = region.size().getInfo()
            if count > 0:
                matched_name = province_name

        all_names = None
        if count == 0:
            all_names = vietnam.aggregate_array("ADM1_NAME").getInfo()
            resolved_name = resolve_province_name(province_name, all_names)
            if resolved_name:
                region = vietnam.filter(ee.Filter.eq("ADM1_NAME", resolved_name))
                count = region.size().getInfo()
                matched_name = resolved_name
                print(f"Fallback matched province: {province_name} -> {resolved_name}")

        if count == 0:
            if all_names is None:
                all_names = vietnam.aggregate_array("ADM1_NAME").getInfo()
            print("Province not found. Available provinces in Vietnam:")
            for name in sorted(all_names):
                print(f"   - {name}")
            return None

        print(f"Found province: {matched_name}")
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
        # Thá»­ ERA5_LAND trÆ°á»›c (cÃ³ dá»¯ liá»‡u má»›i hÆ¡n)
        collection = (
            ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['temperature_2m', 'temperature_2m_min', 'temperature_2m_max'])
        )
        
        size = collection.size().getInfo()
        print(f"ðŸ“Š Temperature collection size: {size}")
        
        if size == 0:
            print("âŒ No temperature data found for this period")
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
# TVDI CHUáº¨N (Sandholt, 2002)
# TVDI - PhiÃªn báº£n Ä‘Æ¡n giáº£n hÃ³a vÃ  sá»­a lá»—i
def get_tvdi_data(geometry, start_date, end_date, location_id):
    try:
        # Láº¥y LST tá»« MOD11A2
        lst_col = (
            ee.ImageCollection("MODIS/061/MOD11A2")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['LST_Day_1km'])
        )
        
        # Láº¥y NDVI tá»« MOD13Q1
        ndvi_col = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI'])
        )
        
        lst_size = lst_col.size().getInfo()
        print(f"ðŸ“Š LST collection size: {lst_size}")
        
        if lst_size == 0:
            print("âŒ No LST data found")
            return pd.DataFrame()
        
        data = []
        lst_list = lst_col.toList(lst_size)
        
        for i in range(lst_size):
            try:
                lst_img = ee.Image(lst_list.get(i))
                date = ee.Date(lst_img.get('system:time_start')).format('YYYY-MM-dd').getInfo()
                print(f"  Processing: {date}")
                
                # Chuyá»ƒn Ä‘á»•i LST sang Ä‘á»™ C
                lst = lst_img.select('LST_Day_1km').multiply(0.02).subtract(273.15)
                
                # TÃ­nh thá»‘ng kÃª LST
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
                    print(f"    âš ï¸ Skip {date}: No LST data")
                    continue
                
                # TÃ­nh TVDI Ä‘Æ¡n giáº£n: (LST - LST_min) / (LST_max - LST_min)
                lst_range = lst_max_val - lst_min_val
                if lst_range <= 0:
                    print(f"    âš ï¸ Skip {date}: LST range = 0")
                    continue
                
                tvdi_img = lst.subtract(lst_min_val).divide(lst_range)
                
                # Thá»‘ng kÃª TVDI
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
                
                # TÃ­nh diá»‡n tÃ­ch háº¡n (TVDI > 0.6)
                drought_mask = tvdi_img.gt(0.6)
                drought_pct = drought_mask.reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                ).get('LST_Day_1km')
                drought_pct_val = drought_pct.getInfo() if drought_pct else 0
                
                # PhÃ¢n loáº¡i háº¡n
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
                print(f"    âœ… {date}: TVDI={tvdi_mean_val:.4f}, LST={lst_mean_val:.2f}Â°C")
                
            except Exception as e:
                print(f"    âŒ Error processing image {i}: {e}")
                continue
        
        print(f"ðŸ“Š Total records: {len(data)}")
        return pd.DataFrame(data)
        
    except Exception as e:
        print(f"TVDI error: {e}")
        return pd.DataFrame()

def classify_drought(tvdi):
    if tvdi is None:
        return 'unknown'
    if tvdi < 0.2:
        return 'wet'
    if tvdi < 0.4:
        return 'normal'
    if tvdi < 0.6:
        return 'moderate'
    if tvdi < 0.8:
        return 'severe'
    return 'extreme'


def fit_linear_edge(points):
    if len(points) < 2:
        return None

    mean_x = sum(point[0] for point in points) / len(points)
    mean_y = sum(point[1] for point in points) / len(points)
    denominator = sum((point[0] - mean_x) ** 2 for point in points)
    if denominator == 0:
        return None

    slope = sum((point[0] - mean_x) * (point[1] - mean_y) for point in points) / denominator
    intercept = mean_y - slope * mean_x
    return slope, intercept


def compute_tvdi_edges(sample_features):
    ndvi_bin_width = 0.02
    grouped = {}

    for feature in sample_features:
        props = feature.get("properties", {})
        ndvi = props.get("ndvi")
        lst = props.get("lst")
        if ndvi is None or lst is None:
            continue
        if ndvi < 0 or ndvi > 1 or lst < -50 or lst > 80:
            continue

        ndvi_bin = int(ndvi / ndvi_bin_width)
        grouped.setdefault(ndvi_bin, []).append((ndvi, lst))

    wet_points = []
    dry_points = []
    for _, values in sorted(grouped.items()):
        if len(values) < 8:
            continue
        ndvi_mean = sum(value[0] for value in values) / len(values)
        lst_values = [value[1] for value in values]
        wet_points.append((ndvi_mean, min(lst_values)))
        dry_points.append((ndvi_mean, max(lst_values)))

    wet_edge = fit_linear_edge(wet_points)
    dry_edge = fit_linear_edge(dry_points)
    if not wet_edge or not dry_edge:
        return None

    return {"wet": wet_edge, "dry": dry_edge, "bins": len(wet_points)}


def _get_tvdi_data_legacy(geometry, start_date, end_date, location_id):
    try:
        lst_col = (
            ee.ImageCollection("MODIS/061/MOD11A2")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['LST_Day_1km'])
        )

        ndvi_col = (
            ee.ImageCollection("MODIS/061/MOD13Q1")
            .filterBounds(geometry)
            .filterDate(start_date, end_date)
            .select(['NDVI'])
        )

        lst_size = lst_col.size().getInfo()
        print(f"LST collection size: {lst_size}")

        if lst_size == 0:
            print("No LST data found")
            return pd.DataFrame()

        data = []
        lst_list = lst_col.toList(lst_size)

        for i in range(lst_size):
            try:
                lst_img = ee.Image(lst_list.get(i))
                image_date = ee.Date(lst_img.get('system:time_start'))
                date = image_date.format('YYYY-MM-dd').getInfo()
                print(f"  Processing: {date}")

                lst = lst_img.select('LST_Day_1km').multiply(0.02).subtract(273.15).rename('lst')

                ndvi_window = ndvi_col.filterDate(
                    image_date.advance(-16, 'day'),
                    image_date.advance(16, 'day')
                )
                if ndvi_window.size().getInfo() == 0:
                    print(f"    Skip {date}: no NDVI image found near LST date")
                    continue

                ndvi = ndvi_window.mean().select('NDVI').multiply(0.0001).rename('ndvi')
                combined = lst.addBands(ndvi)
                valid_mask = ndvi.gte(0).And(ndvi.lte(1)).And(lst.gt(-50)).And(lst.lt(80))
                combined = combined.updateMask(valid_mask)

                samples = combined.sample(
                    region=geometry,
                    scale=1000,
                    numPixels=4000,
                    geometries=False,
                    seed=42
                ).getInfo()
                sample_features = samples.get("features", []) if isinstance(samples, dict) else []
                edges = compute_tvdi_edges(sample_features)

                lst_stats = lst.reduceRegion(
                    reducer=ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', True)
                        .combine(ee.Reducer.max(), '', True),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                )

                lst_mean = lst_stats.get('lst_mean')
                lst_min = lst_stats.get('lst_min')
                lst_max = lst_stats.get('lst_max')
                lst_mean_val = lst_mean.getInfo() if lst_mean else None
                lst_min_val = lst_min.getInfo() if lst_min else None
                lst_max_val = lst_max.getInfo() if lst_max else None

                if edges:
                    wet_slope, wet_intercept = edges["wet"]
                    dry_slope, dry_intercept = edges["dry"]
                    wet_edge_img = ndvi.multiply(wet_slope).add(wet_intercept)
                    dry_edge_img = ndvi.multiply(dry_slope).add(dry_intercept)
                    denominator = dry_edge_img.subtract(wet_edge_img)
                    tvdi_img = (
                        lst.subtract(wet_edge_img)
                        .divide(denominator.where(denominator.abs().lt(0.001), 0.001))
                        .clamp(0, 1)
                        .rename('tvdi')
                    )
                    source = 'MODIS-LST-NDVI-TVDI'
                    print(
                        f"    Edge fit bins={edges['bins']} "
                        f"wet=({wet_slope:.3f},{wet_intercept:.3f}) "
                        f"dry=({dry_slope:.3f},{dry_intercept:.3f})"
                    )
                else:
                    if lst_min_val is None or lst_max_val is None or lst_max_val <= lst_min_val:
                        print(f"    Skip {date}: could not derive TVDI edges or fallback range")
                        continue
                    tvdi_img = (
                        lst.subtract(lst_min_val)
                        .divide(lst_max_val - lst_min_val)
                        .clamp(0, 1)
                        .rename('tvdi')
                    )
                    source = 'MODIS-LST-TVDI-FALLBACK'
                    print(f"    Fallback TVDI used for {date}")

                tvdi_stats = tvdi_img.reduceRegion(
                    reducer=ee.Reducer.mean()
                        .combine(ee.Reducer.min(), '', True)
                        .combine(ee.Reducer.max(), '', True),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                )

                tvdi_mean = tvdi_stats.get('tvdi_mean')
                tvdi_min = tvdi_stats.get('tvdi_min')
                tvdi_max = tvdi_stats.get('tvdi_max')
                tvdi_mean_val = tvdi_mean.getInfo() if tvdi_mean else None
                tvdi_min_val = tvdi_min.getInfo() if tvdi_min else None
                tvdi_max_val = tvdi_max.getInfo() if tvdi_max else None

                drought_pct = tvdi_img.gt(0.6).reduceRegion(
                    reducer=ee.Reducer.mean(),
                    geometry=geometry,
                    scale=1000,
                    maxPixels=1e13
                ).get('tvdi')
                drought_pct_val = drought_pct.getInfo() if drought_pct else 0

                data.append(
                    {
                        'location_id': location_id,
                        'date': date,
                        'tvdi_mean': round(tvdi_mean_val, 4) if tvdi_mean_val is not None else None,
                        'tvdi_min': round(tvdi_min_val, 4) if tvdi_min_val is not None else None,
                        'tvdi_max': round(tvdi_max_val, 4) if tvdi_max_val is not None else None,
                        'lst_mean': round(lst_mean_val, 2) if lst_mean_val is not None else None,
                        'drought_area_pct': round(drought_pct_val * 100, 2) if drought_pct_val else 0,
                        'drought_class': classify_drought(tvdi_mean_val),
                        'source': source,
                    }
                )

                if tvdi_mean_val is not None and lst_mean_val is not None:
                    print(f"    OK {date}: TVDI={tvdi_mean_val:.4f}, LST={lst_mean_val:.2f}C")

            except Exception as e:
                print(f"    Error processing image {i}: {e}")
                continue

        print(f"Total records: {len(data)}")
        return pd.DataFrame(data)

    except Exception as e:
        print(f"TVDI error: {e}")
        return pd.DataFrame()


# Save to database
def save_to_database(df, table_name):
    summary = {
        'table': table_name,
        'attempted': 0 if df is None else len(df),
        'saved': 0,
        'failed': 0,
        'database': None,
        'schema': None,
        'errors': [],
        'error': None,
    }

    if df.empty:
        return summary

    conn = None
    cur = None

    def clean_value(value):
        return None if pd.isna(value) else value

    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute("SELECT current_database(), current_schema()")
        db_name, schema_name = cur.fetchone()
        summary['database'] = db_name
        summary['schema'] = schema_name
        print(f"[DB] Saving {summary['attempted']} rows into {db_name}.{schema_name}.{table_name}")

        for row_number, (_, row) in enumerate(df.iterrows(), start=1):
            savepoint_name = f"sp_{table_name}_{row_number}"
            cur.execute(f"SAVEPOINT {savepoint_name}")
            try:
                if table_name == 'rainfall_data':
                    cur.execute("""
                        INSERT INTO rainfall_data (location_id, date, rainfall_mm, source)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET rainfall_mm = EXCLUDED.rainfall_mm, source = EXCLUDED.source
                    """, (
                        clean_value(row['location_id']),
                        clean_value(row['date']),
                        clean_value(row['rainfall_mm']),
                        clean_value(row['source']),
                    ))
                
                elif table_name == 'temperature_data':
                    cur.execute("""
                        INSERT INTO temperature_data 
                        (location_id, date, temp_min, temp_max, temp_mean, source)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max,
                            temp_mean = EXCLUDED.temp_mean, source = EXCLUDED.source
                    """, (
                        clean_value(row['location_id']),
                        clean_value(row['date']),
                        clean_value(row['temp_min']),
                        clean_value(row['temp_max']),
                        clean_value(row['temp_mean']),
                        clean_value(row['source']),
                    ))
                
                elif table_name == 'soil_moisture_data':
                    cur.execute("""
                        INSERT INTO soil_moisture_data 
                        (location_id, date, sm_surface, sm_rootzone, sm_profile, source)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        ON CONFLICT (location_id, date) DO UPDATE 
                        SET sm_surface = EXCLUDED.sm_surface, sm_rootzone = EXCLUDED.sm_rootzone,
                            sm_profile = EXCLUDED.sm_profile, source = EXCLUDED.source
                    """, (
                        clean_value(row['location_id']),
                        clean_value(row['date']),
                        clean_value(row['sm_surface']),
                        clean_value(row['sm_rootzone']),
                        clean_value(row['sm_profile']),
                        clean_value(row['source']),
                    ))
                
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
                    """, (
                        clean_value(row['location_id']),
                        clean_value(row['date']),
                        clean_value(row['ndvi_mean']),
                        clean_value(row['ndvi_min']),
                        clean_value(row['ndvi_max']),
                        clean_value(row['ndvi_stddev']),
                        clean_value(row['vegetation_area_pct']),
                        clean_value(row['source']),
                    ))
                
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
                    """, (
                        clean_value(row['location_id']),
                        clean_value(row['date']),
                        clean_value(row['tvdi_mean']),
                        clean_value(row['tvdi_min']),
                        clean_value(row['tvdi_max']),
                        clean_value(row['lst_mean']),
                        clean_value(row['drought_area_pct']),
                        clean_value(row['drought_class']),
                        clean_value(row['source']),
                    ))
                
                cur.execute(f"RELEASE SAVEPOINT {savepoint_name}")
                summary['saved'] += 1
            except Exception as e:
                cur.execute(f"ROLLBACK TO SAVEPOINT {savepoint_name}")
                cur.execute(f"RELEASE SAVEPOINT {savepoint_name}")
                summary['failed'] += 1
                error_payload = {
                    'row': row_number,
                    'date': str(row.get('date')),
                    'message': str(e),
                }
                if len(summary['errors']) < 10:
                    summary['errors'].append(error_payload)
                print(f"[DB] Save error in {table_name} row {row_number} ({row.get('date')}): {e}")

        conn.commit()
        print(
            f"[DB] Commit complete for {table_name}: "
            f"attempted={summary['attempted']} saved={summary['saved']} failed={summary['failed']}"
        )
        return summary
    except Exception as e:
        if conn is not None:
            conn.rollback()
        summary['error'] = str(e)
        print(f"[DB] Fatal error while saving {table_name}: {e}")
        return summary
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def ensure_location_exists(location_id, province_name):
    conn = None
    cur = None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, province FROM locations WHERE id = %s",
            (location_id,),
        )
        existing = cur.fetchone()
        if existing:
            print(f"[DB] Using existing location id={existing[0]} name={existing[1]} province={existing[2]}")
            conn.commit()
            return True

        cur.execute(
            """
            INSERT INTO locations (id, name, province, geometry)
            VALUES (%s, %s, %s, NULL)
            """,
            (location_id, province_name, province_name),
        )
        cur.execute(
            """
            SELECT setval(
                pg_get_serial_sequence('locations', 'id'),
                COALESCE((SELECT MAX(id) FROM locations), 1),
                true
            )
            """
        )
        conn.commit()
        print(f"[DB] Created missing location id={location_id} name={province_name}")
        return True
    except Exception as e:
        if conn is not None:
            conn.rollback()
        print(f"[DB] Failed to ensure location {location_id} exists: {e}")
        return False
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def ensure_custom_location(location_id, area_name, province_name, geometry_payload):
    conn = None
    cur = None
    geometry_json = json.dumps(geometry_payload, ensure_ascii=False) if geometry_payload else None
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        conn.autocommit = False
        cur = conn.cursor()

        if location_id:
            cur.execute("SELECT id FROM locations WHERE id = %s", (location_id,))
            existing = cur.fetchone()
            if existing:
                cur.execute(
                    """
                    UPDATE locations
                    SET name = %s,
                        province = %s,
                        geometry = %s::jsonb
                    WHERE id = %s
                    """,
                    (area_name, province_name, geometry_json, location_id),
                )
                conn.commit()
                print(f"[DB] Updated custom location id={location_id} name={area_name}")
                return int(location_id)

        if geometry_json:
            cur.execute(
                """
                SELECT id
                FROM locations
                WHERE LOWER(name) = LOWER(%s)
                  AND LOWER(province) = LOWER(%s)
                  AND geometry = %s::jsonb
                ORDER BY id
                LIMIT 1
                """,
                (area_name, province_name, geometry_json),
            )
            matched = cur.fetchone()
            if matched:
                conn.commit()
                print(f"[DB] Reusing custom location id={matched[0]} name={area_name}")
                return int(matched[0])

        if location_id:
            cur.execute(
                """
                INSERT INTO locations (id, name, province, geometry)
                VALUES (%s, %s, %s, %s::jsonb)
                RETURNING id
                """,
                (location_id, area_name, province_name, geometry_json),
            )
            created_id = cur.fetchone()[0]
            cur.execute(
                """
                SELECT setval(
                    pg_get_serial_sequence('locations', 'id'),
                    COALESCE((SELECT MAX(id) FROM locations), 1),
                    true
                )
                """
            )
        else:
            cur.execute(
                """
                INSERT INTO locations (name, province, geometry)
                VALUES (%s, %s, %s::jsonb)
                RETURNING id
                """,
                (area_name, province_name, geometry_json),
            )
            created_id = cur.fetchone()[0]

        conn.commit()
        print(f"[DB] Created custom location id={created_id} name={area_name}")
        return int(created_id)
    except Exception as e:
        if conn is not None:
            conn.rollback()
        print(f"[DB] Failed to ensure custom location {area_name}: {e}")
        return None
    finally:
        if cur is not None:
            cur.close()
        if conn is not None:
            conn.close()


def build_result_payload(df, table_name, persist, include_data):
    if persist:
        save_summary = save_to_database(df, table_name)
        payload = {
            'records': save_summary['saved'],
            'attempted': save_summary['attempted'],
            'failed': save_summary['failed'],
            'database': save_summary['database'],
            'schema': save_summary['schema'],
        }
        if save_summary.get('errors'):
            payload['errors'] = save_summary['errors']
        if save_summary.get('error'):
            payload['error'] = save_summary['error']
    else:
        payload = {
            'records': len(df),
            'attempted': len(df),
            'failed': 0,
        }

    if include_data:
        payload['data'] = dataframe_to_records(df)
    return payload


def dataframe_to_records(df):
    if df.empty:
        return []
    return json.loads(df.to_json(orient="records", date_format="iso"))

# API Endpoints
@app.route('/fetch-data', methods=['POST'])
def fetch_data():
    try:
        data = request.json or {}
        province = data.get('province')
        area_name = data.get('area_name') or province or 'Vung tuy chon'
        location_id = data.get('location_id')
        geometry_payload = data.get('geometry')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        data_types = data.get('data_types', [])
        persist = bool(data.get('persist', True))
        include_data = bool(data.get('include_data', False))

        if not all([start_date, end_date]):
            return jsonify({'error': 'Missing required parameters'}), 400

        try:
            location_id = int(location_id) if location_id not in (None, "") else None
        except (TypeError, ValueError):
            return jsonify({'error': 'location_id must be an integer'}), 400
        
        # Initialize GEE
        if not initialize_gee():
            return jsonify(
                {
                    'error': 'Failed to initialize Google Earth Engine',
                    'details': GEE_STATE.get("last_error"),
                    'project': GEE_STATE.get("project"),
                }
            ), 500

        analysis_mode = 'geometry' if geometry_payload else 'province'
        province_label = province or area_name

        if geometry_payload:
            geometry = geometry_payload_to_ee_geometry(geometry_payload)
            if geometry is None:
                return jsonify({'error': 'Invalid geometry payload'}), 400
        else:
            if not province:
                return jsonify({'error': 'Missing province for location-based analysis'}), 400
            geometry = get_region_geometry(province)
            if geometry is None:
                return jsonify({'error': f'Province not found: {province}'}), 404

        effective_location_id = location_id or 0
        if persist:
            if geometry_payload:
                prepared_location_id = ensure_custom_location(location_id, area_name, province_label, geometry_payload)
                if not prepared_location_id:
                    return jsonify({'error': f'Failed to prepare custom area location {area_name}'}), 500
                effective_location_id = prepared_location_id
            else:
                if not ensure_location_exists(location_id, province_label):
                    return jsonify({'error': f'Failed to prepare location {location_id} for province {province_label}'}), 500
                effective_location_id = int(location_id)
        
        results = {}
        
        # Fetch data based on selected types
        if 'rainfall' in data_types:
            df = get_rainfall_data(geometry, start_date, end_date, effective_location_id)
            results['rainfall'] = build_result_payload(df, 'rainfall_data', persist, include_data)
        
        if 'temperature' in data_types:
            df = get_temperature_data(geometry, start_date, end_date, effective_location_id)
            results['temperature'] = build_result_payload(df, 'temperature_data', persist, include_data)
        
        if 'soil_moisture' in data_types:
            df = get_soil_moisture_data(geometry, start_date, end_date, effective_location_id)
            results['soil_moisture'] = build_result_payload(df, 'soil_moisture_data', persist, include_data)
        
        if 'ndvi' in data_types:
            df = get_ndvi_data(geometry, start_date, end_date, effective_location_id)
            results['ndvi'] = build_result_payload(df, 'ndvi_data', persist, include_data)
        
        if 'tvdi' in data_types:
            df = get_tvdi_data(geometry, start_date, end_date, effective_location_id)
            results['tvdi'] = build_result_payload(df, 'tvdi_data', persist, include_data)
        
        return jsonify({
            'success': True,
            'province': province_label,
            'area_name': area_name,
            'location_id': effective_location_id,
            'analysis_mode': analysis_mode,
            'period': f'{start_date} to {end_date}',
            'results': results
        })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

def resolve_analysis_geometry(province=None, geometry_payload=None):
    if geometry_payload:
        return geometry_payload_to_ee_geometry(geometry_payload)
    if province:
        return get_region_geometry(province)
    return None


def build_layer_definition(data_type, geometry, start_date, end_date, metric=None):
    end_ee = ee.Date(end_date).advance(1, 'day')

    if data_type == 'rainfall':
        image = (
            ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select('precipitation')
            .sum()
            .rename('value')
            .clip(geometry)
        )
        return {
            'image': image,
            'band': 'value',
            'scale': 5000,
            'vis': {'min': 0, 'max': 300, 'palette': ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b']},
            'units': 'mm',
            'label': 'Luong mua',
        }

    if data_type == 'temperature':
        image = (
            ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select('temperature_2m')
            .mean()
            .subtract(273.15)
            .rename('value')
            .clip(geometry)
        )
        return {
            'image': image,
            'band': 'value',
            'scale': 10000,
            'vis': {'min': 10, 'max': 45, 'palette': ['#313695', '#74add1', '#ffffbf', '#f46d43', '#a50026']},
            'units': 'do C',
            'label': 'Nhiet do',
        }

    if data_type == 'soil_moisture':
        metric_map = {
            'surface': 'volumetric_soil_water_layer_1',
            'rootzone': 'volumetric_soil_water_layer_2',
            'profile': 'volumetric_soil_water_layer_3',
        }
        selected_metric = metric if metric in metric_map else 'surface'
        band_name = metric_map[selected_metric]
        image = (
            ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select(band_name)
            .mean()
            .rename('value')
            .clip(geometry)
        )
        return {
            'image': image,
            'band': 'value',
            'scale': 10000,
            'vis': {'min': 0, 'max': 0.6, 'palette': ['#f7fcf0', '#ccebc5', '#7bccc4', '#2b8cbe', '#084081']},
            'units': 'm3/m3',
            'label': f'Do am dat ({selected_metric})',
            'metric': selected_metric,
        }

    if data_type == 'ndvi':
        image = (
            ee.ImageCollection('MODIS/061/MOD13Q1')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select('NDVI')
            .mean()
            .multiply(0.0001)
            .rename('value')
            .clip(geometry)
        )
        return {
            'image': image,
            'band': 'value',
            'scale': 250,
            'vis': {'min': 0, 'max': 1, 'palette': ['#8c510a', '#d8b365', '#f6e8c3', '#5ab45f', '#01665e']},
            'units': 'NDVI',
            'label': 'NDVI',
        }

    if data_type == 'tvdi':
        lst = (
            ee.ImageCollection('MODIS/061/MOD11A2')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select('LST_Day_1km')
            .mean()
            .multiply(0.02)
            .subtract(273.15)
            .rename('lst')
        )
        ndvi = (
            ee.ImageCollection('MODIS/061/MOD13Q1')
            .filterDate(start_date, end_ee)
            .filterBounds(geometry)
            .select('NDVI')
            .mean()
            .multiply(0.0001)
            .rename('ndvi')
        )
        combined = lst.addBands(ndvi)
        valid_mask = ndvi.gte(0).And(ndvi.lte(1)).And(lst.gt(-50)).And(lst.lt(80))
        combined = combined.updateMask(valid_mask)

        tvdi_img = None
        sample = combined.sample(region=geometry, scale=1000, numPixels=3000, geometries=False).getInfo()
        features = sample.get('features', []) if isinstance(sample, dict) else []
        edges = compute_tvdi_edges(features)
        if edges:
            wet_slope = edges['wet_edge']['slope']
            wet_intercept = edges['wet_edge']['intercept']
            dry_slope = edges['dry_edge']['slope']
            dry_intercept = edges['dry_edge']['intercept']
            ndvi_img = combined.select('ndvi')
            lst_img = combined.select('lst')
            wet_edge_img = ndvi_img.multiply(wet_slope).add(wet_intercept)
            dry_edge_img = ndvi_img.multiply(dry_slope).add(dry_intercept)
            denominator = dry_edge_img.subtract(wet_edge_img)
            tvdi_img = lst_img.subtract(wet_edge_img).divide(denominator.where(denominator.abs().lt(0.001), 0.001)).clamp(0, 1)
        else:
            lst_stats = lst.reduceRegion(reducer=ee.Reducer.minMax(), geometry=geometry, scale=1000, bestEffort=True, maxPixels=1e13).getInfo()
            lst_min = lst_stats.get('lst_min')
            lst_max = lst_stats.get('lst_max')
            if lst_min is not None and lst_max is not None and lst_max != lst_min:
                tvdi_img = lst.subtract(lst_min).divide(lst_max - lst_min).clamp(0, 1)

        if tvdi_img is None:
            raise ValueError('Could not derive TVDI raster for the selected period.')

        return {
            'image': tvdi_img.rename('value').clip(geometry),
            'band': 'value',
            'scale': 1000,
            'vis': {'min': 0, 'max': 1, 'palette': ['#2166ac', '#67a9cf', '#f7f7f7', '#ef8a62', '#b2182b']},
            'units': 'TVDI',
            'label': 'TVDI',
        }

    raise ValueError(f'Unsupported data type: {data_type}')


def build_layer_payload(layer_definition, geometry, data_type, start_date, end_date):
    image = layer_definition['image']
    band = layer_definition['band']
    vis = layer_definition['vis']
    map_payload = image.getMapId(vis)
    tile_fetcher = map_payload.get('tile_fetcher') if isinstance(map_payload, dict) else None
    tile_url = getattr(tile_fetcher, 'url_format', None)
    stats = image.reduceRegion(
        reducer=ee.Reducer.minMax().combine(ee.Reducer.mean(), '', True),
        geometry=geometry,
        scale=layer_definition['scale'],
        bestEffort=True,
        maxPixels=1e13,
    ).getInfo()
    return {
        'data_type': data_type,
        'label': layer_definition.get('label'),
        'units': layer_definition.get('units'),
        'tile_url': tile_url,
        'legend': {
            'min': vis['min'],
            'max': vis['max'],
            'palette': vis['palette'],
            'units': layer_definition.get('units'),
        },
        'statistics': {
            'min': stats.get(f'{band}_min'),
            'max': stats.get(f'{band}_max'),
            'mean': stats.get(f'{band}_mean'),
        },
        'period': f'{start_date} to {end_date}',
        'metric': layer_definition.get('metric'),
    }


@app.route('/map-layer', methods=['POST'])
def map_layer():
    try:
        data = request.json or {}
        data_type = data.get('data_type')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        province = data.get('province')
        geometry_payload = data.get('geometry')
        metric = data.get('metric')

        if data_type not in {'rainfall', 'temperature', 'soil_moisture', 'ndvi', 'tvdi'}:
            return jsonify({'error': 'Invalid data_type'}), 400
        if not start_date or not end_date:
            return jsonify({'error': 'Missing required parameters'}), 400
        if not initialize_gee():
            return jsonify({'error': 'Failed to initialize Google Earth Engine', 'details': GEE_STATE.get('last_error')}), 500

        geometry = resolve_analysis_geometry(province, geometry_payload)
        if geometry is None:
            return jsonify({'error': 'Failed to resolve analysis geometry'}), 400

        layer_definition = build_layer_definition(data_type, geometry, start_date, end_date, metric)
        return jsonify({'success': True, **build_layer_payload(layer_definition, geometry, data_type, start_date, end_date)})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/sample-point', methods=['POST'])
def sample_point():
    try:
        data = request.json or {}
        data_type = data.get('data_type')
        start_date = data.get('start_date')
        end_date = data.get('end_date')
        lat = data.get('lat')
        lng = data.get('lng')
        province = data.get('province')
        geometry_payload = data.get('geometry')
        metric = data.get('metric')

        if data_type not in {'rainfall', 'temperature', 'soil_moisture', 'ndvi', 'tvdi'}:
            return jsonify({'error': 'Invalid data_type'}), 400
        if not start_date or not end_date or lat is None or lng is None:
            return jsonify({'error': 'Missing required parameters'}), 400
        if not initialize_gee():
            return jsonify({'error': 'Failed to initialize Google Earth Engine', 'details': GEE_STATE.get('last_error')}), 500

        geometry = resolve_analysis_geometry(province, geometry_payload)
        if geometry is None:
            return jsonify({'error': 'Failed to resolve analysis geometry'}), 400

        point = ee.Geometry.Point([float(lng), float(lat)])
        layer_definition = build_layer_definition(data_type, geometry, start_date, end_date, metric)
        image = layer_definition['image']
        band = layer_definition['band']
        sampled = image.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=point,
            scale=layer_definition['scale'],
            bestEffort=True,
            maxPixels=1e13,
        ).getInfo()
        value = sampled.get(band) if isinstance(sampled, dict) else None
        return jsonify({
            'success': True,
            'data_type': data_type,
            'lat': float(lat),
            'lng': float(lng),
            'value': value,
            'units': layer_definition.get('units'),
            'label': layer_definition.get('label'),
            'metric': layer_definition.get('metric'),
            'period': f'{start_date} to {end_date}',
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/status', methods=['GET'])
def status():
    initialized = initialize_gee()
    return jsonify({
        'status': 'online' if initialized else 'offline',
        'gee_initialized': initialized,
        'gee_project': GEE_STATE.get("project"),
        'auth_mode': GEE_STATE.get("auth_mode"),
        'error': GEE_STATE.get("last_error"),
    })

if __name__ == '__main__':
    print("=" * 70)
    print("     Data Fetcher API Server")
    print("=" * 70)
    print("  Running on: http://localhost:3001")
    print("  UI: Open data_fetcher.html in browser")
    print("=" * 70)
    debug = os.getenv("FLASK_DEBUG", "true").lower() == "true"
    port = int(os.getenv("GEE_API_PORT", "3001"))
    app.run(host='0.0.0.0', port=port, debug=debug)
