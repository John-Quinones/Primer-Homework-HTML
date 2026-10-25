#!/bin/bash
# Solo LEE el original: copia la base y los respaldos a /home/data/rescate-<hora>/ y revisa cada COPIA.
D=/home/data
OUT=$D/rescate-$(date -u +%Y%m%d-%H%M%S)
mkdir -p "$OUT/respaldos" || exit 1
echo "== Archivos en $D"; ls -la $D $D/respaldos
for f in juanmaapp.db juanmaapp.db-wal juanmaapp.db-shm juanmaapp.db-journal; do [ -f "$D/$f" ] && cp -p "$D/$f" "$OUT/$f"; done
cp -p $D/respaldos/*.db "$OUT/respaldos/" 2>/dev/null
echo; echo "== Copias hechas en $OUT"; sqlite3 -version
for f in "$OUT/juanmaapp.db" "$OUT"/respaldos/*.db; do
  [ -f "$f" ] || continue
  echo; echo "--- $(basename "$f") ($(stat -c %s "$f") bytes)"
  echo "integridad: $(sqlite3 "$f" 'PRAGMA integrity_check;' 2>&1 | head -3 | tr '\n' '|')"
  for t in clients cases payments users; do echo "$t: $(sqlite3 "$f" "SELECT COUNT(*) FROM $t;" 2>&1 | head -1)"; done
done
