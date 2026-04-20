from pathlib import Path
import os
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / ".venv" / "Lib" / "site-packages"))

from dotenv import load_dotenv
import psycopg2


STATIONS = [
    {
        "name": "Công ty TNHH Dệt may VTJ Toms",
        "station_type": "water",
        "lat": 16.6881363,
        "lon": 107.2560446,
        "source_description": "Trạm quan trắc nước thải tự động tại Cụm Công nghiệp Diên Sanh; tọa độ geocode theo Xã Diên Sanh.",
        "address": "Cụm Công nghiệp Diên Sanh, Xã Diên Sanh, Tỉnh Quảng Trị, Việt Nam",
    },
    {
        "name": "Nhà máy tinh bột sắn Hướng Hóa",
        "station_type": "water",
        "lat": 16.4711723,
        "lon": 106.7174578,
        "source_description": "Trạm quan trắc nước thải tự động của Nhà máy tinh bột sắn Hướng Hóa; tọa độ geocode theo điểm Lìa gần nhà máy.",
        "address": "Km 3, Xã Lìa, Tỉnh Quảng Trị, Việt Nam",
    },
    {
        "name": "Trạm xử lý nước thải thành phố Đông Hà",
        "station_type": "water",
        "lat": 16.802493,
        "lon": 107.0953385,
        "source_description": "Trạm xử lý nước thải đô thị Đông Hà; tọa độ geocode theo trung tâm khu vực Thành phố Đông Hà do chưa có điểm trạm công khai.",
        "address": "Thành phố Đông Hà, Tỉnh Quảng Trị, Việt Nam",
    },
    {
        "name": "Công ty Cổ phần Chế biến tinh bột sắn An Thái",
        "station_type": "water",
        "lat": 16.8291704,
        "lon": 107.0348371,
        "source_description": "Trạm quan trắc nước thải tự động tại cơ sở An Thái; tọa độ geocode theo Xã Hiếu Giang.",
        "address": "Thôn An Thái, Xã Hiếu Giang, Tỉnh Quảng Trị, Việt Nam",
    },
    {
        "name": "Trạm xử lý nước thải thị xã Quảng Trị",
        "station_type": "water",
        "lat": 16.6938511,
        "lon": 107.1566092,
        "source_description": "Trạm xử lý nước thải đô thị thị xã Quảng Trị; tọa độ geocode theo Phường Quảng Trị do chưa có điểm trạm công khai.",
        "address": "Phường Quảng Trị, Tỉnh Quảng Trị, Việt Nam",
    },
    {
        "name": "Trạm nghiền Clinke - Công ty CP Xi măng Bỉm Sơn",
        "station_type": "air",
        "lat": 16.7924592,
        "lon": 107.1180599,
        "source_description": "Trạm quan trắc khí thải tại Khu công nghiệp Nam Đông Hà.",
        "address": "Khu công nghiệp Nam Đông Hà, Tỉnh Quảng Trị, Việt Nam",
    },
]


def get_connection():
    load_dotenv(ROOT / "backend" / ".env")
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASS"),
        dbname=os.getenv("DB_NAME"),
    )


def upsert_stations():
    conn = get_connection()
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            for station in STATIONS:
                cur.execute(
                    "select id from monitoring_stations where name = %s limit 1",
                    (station["name"],),
                )
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        """
                        update monitoring_stations
                        set station_type = %s,
                            lat = %s,
                            lon = %s,
                            source_description = %s,
                            address = %s
                        where id = %s
                        """,
                        (
                            station["station_type"],
                            station["lat"],
                            station["lon"],
                            station["source_description"],
                            station["address"],
                            existing[0],
                        ),
                    )
                else:
                    cur.execute(
                        """
                        insert into monitoring_stations
                            (name, station_type, lat, lon, source_description, address)
                        values (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            station["name"],
                            station["station_type"],
                            station["lat"],
                            station["lon"],
                            station["source_description"],
                            station["address"],
                        ),
                    )
    finally:
        conn.close()


if __name__ == "__main__":
    upsert_stations()
    print(f"Seeded {len(STATIONS)} monitoring stations for Quang Tri.")
