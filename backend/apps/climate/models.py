from django.db import models


class Location(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255)
    province = models.CharField(max_length=255)
    geometry = models.JSONField(null=True, blank=True)

    class Meta:
        db_table = "locations"
        managed = False


class AdminBoundary(models.Model):
    id = models.BigAutoField(primary_key=True)
    boundary_code = models.CharField(max_length=50)
    name = models.CharField(max_length=255)
    normalized_name = models.CharField(max_length=255)
    admin_level = models.SmallIntegerField()
    parent_code = models.CharField(max_length=50, null=True, blank=True)
    province_name = models.CharField(max_length=255, null=True, blank=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id", null=True, blank=True)
    centroid_lat = models.FloatField(null=True, blank=True)
    centroid_lng = models.FloatField(null=True, blank=True)
    geometry = models.JSONField(null=True, blank=True)
    source = models.CharField(max_length=255)
    effective_date = models.DateField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "admin_boundaries"
        managed = False


class AdministrativeRegion(models.Model):
    id = models.IntegerField(primary_key=True)
    name = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255)
    code_name = models.CharField(max_length=255, null=True, blank=True)
    code_name_en = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "administrative_regions"
        managed = False


class AdministrativeUnit(models.Model):
    id = models.IntegerField(primary_key=True)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    full_name_en = models.CharField(max_length=255, null=True, blank=True)
    short_name = models.CharField(max_length=255, null=True, blank=True)
    short_name_en = models.CharField(max_length=255, null=True, blank=True)
    code_name = models.CharField(max_length=255, null=True, blank=True)
    code_name_en = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        db_table = "administrative_units"
        managed = False


class Province(models.Model):
    code = models.CharField(max_length=20, primary_key=True)
    name = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255, null=True, blank=True)
    full_name = models.CharField(max_length=255)
    full_name_en = models.CharField(max_length=255, null=True, blank=True)
    code_name = models.CharField(max_length=255, null=True, blank=True)
    administrative_unit = models.ForeignKey(
        AdministrativeUnit, on_delete=models.DO_NOTHING, db_column="administrative_unit_id", null=True, blank=True
    )

    class Meta:
        db_table = "provinces"
        managed = False


class Ward(models.Model):
    code = models.CharField(max_length=20, primary_key=True)
    name = models.CharField(max_length=255)
    name_en = models.CharField(max_length=255, null=True, blank=True)
    full_name = models.CharField(max_length=255, null=True, blank=True)
    full_name_en = models.CharField(max_length=255, null=True, blank=True)
    code_name = models.CharField(max_length=255, null=True, blank=True)
    province_code = models.CharField(max_length=20, null=True, blank=True)
    administrative_unit = models.ForeignKey(
        AdministrativeUnit, on_delete=models.DO_NOTHING, db_column="administrative_unit_id", null=True, blank=True
    )

    class Meta:
        db_table = "wards"
        managed = False


class AnalysisAreaHistory(models.Model):
    id = models.BigAutoField(primary_key=True)
    user_id = models.BigIntegerField()
    name = models.CharField(max_length=255)
    province_name = models.CharField(max_length=255, null=True, blank=True)
    source_type = models.CharField(max_length=50)
    boundary_code = models.CharField(max_length=50, null=True, blank=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id", null=True, blank=True)
    geometry = models.JSONField()
    centroid_lat = models.FloatField(null=True, blank=True)
    centroid_lng = models.FloatField(null=True, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "analysis_area_history"
        managed = False


class MonitoringStation(models.Model):
    id = models.BigAutoField(primary_key=True)
    name = models.CharField(max_length=255)
    station_type = models.CharField(max_length=20)
    lat = models.FloatField()
    lon = models.FloatField()
    rainfall_mm = models.FloatField(null=True, blank=True)
    source_description = models.TextField(null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "monitoring_stations"
        managed = False


class RainfallData(models.Model):
    id = models.BigAutoField(primary_key=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id")
    date = models.DateField()
    rainfall_mm = models.FloatField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    source_station = models.ForeignKey(
        MonitoringStation, on_delete=models.DO_NOTHING, db_column="source_station_id", null=True, blank=True
    )
    source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "rainfall_data"
        managed = False


class TemperatureData(models.Model):
    id = models.BigAutoField(primary_key=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id")
    date = models.DateField()
    temp_min = models.FloatField(null=True, blank=True)
    temp_max = models.FloatField(null=True, blank=True)
    temp_mean = models.FloatField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    source_station = models.ForeignKey(
        MonitoringStation, on_delete=models.DO_NOTHING, db_column="source_station_id", null=True, blank=True
    )
    source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "temperature_data"
        managed = False


class SoilMoistureData(models.Model):
    id = models.BigAutoField(primary_key=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id")
    date = models.DateField()
    sm_surface = models.FloatField(null=True, blank=True)
    sm_rootzone = models.FloatField(null=True, blank=True)
    sm_profile = models.FloatField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    source_station = models.ForeignKey(
        MonitoringStation, on_delete=models.DO_NOTHING, db_column="source_station_id", null=True, blank=True
    )
    source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "soil_moisture_data"
        managed = False


class NdviData(models.Model):
    id = models.BigAutoField(primary_key=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id")
    date = models.DateField()
    ndvi_mean = models.FloatField(null=True, blank=True)
    ndvi_min = models.FloatField(null=True, blank=True)
    ndvi_max = models.FloatField(null=True, blank=True)
    ndvi_stddev = models.FloatField(null=True, blank=True)
    vegetation_area_pct = models.FloatField(null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    source_station = models.ForeignKey(
        MonitoringStation, on_delete=models.DO_NOTHING, db_column="source_station_id", null=True, blank=True
    )
    source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "ndvi_data"
        managed = False


class TvdiData(models.Model):
    id = models.BigAutoField(primary_key=True)
    location = models.ForeignKey(Location, on_delete=models.DO_NOTHING, db_column="location_id")
    date = models.DateField()
    tvdi_mean = models.FloatField(null=True, blank=True)
    tvdi_min = models.FloatField(null=True, blank=True)
    tvdi_max = models.FloatField(null=True, blank=True)
    lst_mean = models.FloatField(null=True, blank=True)
    drought_area_pct = models.FloatField(null=True, blank=True)
    drought_class = models.CharField(max_length=50, null=True, blank=True)
    source = models.CharField(max_length=100, null=True, blank=True)

    class Meta:
        db_table = "tvdi_data"
        managed = False
