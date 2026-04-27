import psycopg2
conn = psycopg2.connect(host='127.0.0.1', port=5432, user='postgres', password='1224454', dbname='web_gis')
cur = conn.cursor()
cur.execute("SELECT id, username, email, full_name, role, password_hash FROM users WHERE role='admin' ORDER BY id")
for row in cur.fetchall():
    print(row)
conn.close()
