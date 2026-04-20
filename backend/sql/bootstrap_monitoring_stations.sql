-- Bootstrap monitoring stations and manual-entry support columns.
-- Safe to run multiple times.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'monitoring_station_type') THEN
        CREATE TYPE monitoring_station_type AS ENUM ('water', 'air', 'rainfall');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitoring_stations (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    station_type monitoring_station_type NOT NULL,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    rainfall_mm DOUBLE PRECISION,
    source_description TEXT,
    address TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE monitoring_stations
    ADD COLUMN IF NOT EXISTS rainfall_mm DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_monitoring_stations_type
    ON monitoring_stations(station_type);

CREATE INDEX IF NOT EXISTS idx_monitoring_stations_lat_lon
    ON monitoring_stations(lat, lon);

ALTER TABLE rainfall_data
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS source_station_id BIGINT REFERENCES monitoring_stations(id);

ALTER TABLE temperature_data
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS source_station_id BIGINT REFERENCES monitoring_stations(id);

ALTER TABLE soil_moisture_data
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS source_station_id BIGINT REFERENCES monitoring_stations(id);

ALTER TABLE ndvi_data
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS source_station_id BIGINT REFERENCES monitoring_stations(id);
