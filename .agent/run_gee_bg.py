import os
import runpy
import sys

sys.path.insert(0, r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/.venv/Lib/site-packages")
sys.path.insert(0, r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend")
os.chdir(r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong")
os.environ["FLASK_DEBUG"] = "0"

runpy.run_path(r"d:/Ki2Nam4/GIS_phuong/GIS-fork-from-phuong/backend/scripts/api_server.py", run_name="__main__")
