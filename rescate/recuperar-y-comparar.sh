#!/bin/bash
# Solo trabaja sobre las COPIAS de la carpeta rescate indicada. No toca /home/data/juanmaapp.db ni respaldos/.
R=$1; [ -d "$R" ] || { echo "Uso: bash recuperar-y-comparar.sh /home/data/rescate-XXXX"; exit 1; }
rm -f "$R/recuperada.db"
sqlite3 "$R/juanmaapp.db" ".recover" 2>"$R/recover.err" | sqlite3 "$R/recuperada.db" 2>>"$R/recover.err"
echo "recover: $(wc -l < "$R/recover.err") mensajes; integridad de la recuperada: $(sqlite3 "$R/recuperada.db" 'PRAGMA integrity_check;' 2>&1 | head -2 | tr '\n' '|')"
python3 "$(dirname "$0")/comparar-db.py" "$R"
