# Solo LEE (modo sólo lectura) las COPIAS de la carpeta rescate: cuenta filas por tabla en cada copia.
import sqlite3, sys, glob, os
d = sys.argv[1]
files = [os.path.join(d, "juanmaapp.db"), os.path.join(d, "recuperada.db")] + sorted(glob.glob(os.path.join(d, "respaldos", "*.db")))
files = [f for f in files if os.path.exists(f)]
newest = files[-1]
def open_ro(f): return sqlite3.connect("file:%s?mode=ro" % f, uri=True)
tables = [r[0] for r in open_ro(newest).execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
names = [os.path.basename(f).replace("juanmaapp-", "").replace(".db", "") or f for f in files]
names[0] = "ORIGINAL"
print("tabla".ljust(26) + "".join(n[-12:].rjust(14) for n in names))
for t in tables:
    row = t[:25].ljust(26)
    for f in files:
        try: row += str(open_ro(f).execute('select count(*) from "%s"' % t).fetchone()[0]).rjust(14)
        except Exception as e: row += "ERR".rjust(14)
    print(row)
