import psycopg2
import bcrypt

new_password = 'admin123'
new_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

conn = psycopg2.connect(host='127.0.0.1', port=5432, user='postgres', password='1224454', dbname='web_gis')
cur = conn.cursor()
cur.execute("UPDATE users SET password_hash = %s WHERE username = 'admin' RETURNING id, username", (new_hash,))
result = cur.fetchone()
conn.commit()
conn.close()

if result:
    print(f"Admin password reset successfully for user: {result[1]} (ID: {result[0]})")
    print(f"New password: {new_password}")
else:
    print("Admin user not found")
