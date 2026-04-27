import bcrypt

stored_hash = '$2b$12$JqsdC.s2i0S3TyIVT7YKl.YIUP6q6iEbMpzZqSxZd.hSPWBsS4sxi'
candidates = ['admin', 'password', '123456', 'admin123', 'Admin@123', 'gis_admin', 'gis-climate', 'change-me']

for pwd in candidates:
    if bcrypt.checkpw(pwd.encode('utf-8'), stored_hash.encode('utf-8')):
        print(f'MATCH: {pwd}')
        break
else:
    print('No common password matched')
