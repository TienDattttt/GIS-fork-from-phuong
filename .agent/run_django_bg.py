import os
import sys

sys.path.insert(0, r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/.venv/Lib/site-packages")
sys.path.insert(0, r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend")
os.chdir(r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong")
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.management import execute_from_command_line

execute_from_command_line(["manage.py", "runserver", "0.0.0.0:8001", "--noreload"])
