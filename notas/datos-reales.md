# Datos reales

Desde el 17/10/2026 (03:02) John carga datos reales en la App. Todo lo que cargue debe quedar guardado.

- Nunca borrar, reiniciar, sobrescribir ni sembrar datos de prueba en una base real: ni en el enlace de pruebas (base del Artifact) ni en Azure.
- Las pruebas se hacen solo en copias locales (`npm run preview` + Playwright, o el servidor con una base temporal).
- Todo cambio de estructura es una migración que conserva lo existente (`src/db.js` y `public/demo-backend.js`, función `migrate()`). Antes de cualquier migración o relleno masivo: copia de respaldo (en /mnt/project-files/respaldos/<fecha>-<tema>/).
- Los rellenos automáticos solo completan valores vacíos y corren una sola vez (bandera en `app_flags` / `st.info`).
- Normalizar registros existentes (mayúsculas, tildes, teléfonos) solo con el sí de John.
- «No borres nada» (John, 19/10/2026): las diferencias de borrado entre servidor y enlace (borrar cliente con cobros, cambio de oficina, borrar expediente) siguen sin tocar hasta que él decida.
- Si aparece un duplicado, se borra el más reciente (regla de John).

## Dónde vive cada base
- Azure: `DB_PATH=/home/data/juanmaapp.db`, fuera del paquete; publicar no la reemplaza. Copia automática cada 3 días en `/home/data/respaldos` (guarda 5).
- Enlace de pruebas: base del Artifact; republicar al mismo enlace conserva los datos.
- Son dos bases separadas y no se sincronizan. Si John dice que algo «no aparece», buscar primero en la otra base.
- El contenedor de Claude no alcanza Azure: la verificación allá la hace John.

## Guardado del enlace de pruebas (v2.2.36)
- `public/web-store.js` guarda por registro: antes de escribir un «cajón» (jm_<colección>/bN) lo lee y le aplica solo lo que ESA copia cambió, creó o borró frente a lo que leyó al cargar (`mergeItems`). Nunca escribir un cajón entero desde la copia local: borraba lo que otra pantalla guardó (edición perdida, registro vecino borrado).
- `pull()` toma lo guardado por otras pantallas al ingresar (`POST /auth/login`) y al volver a la pestaña. `test/link-shared.js` simula varias pantallas sobre una base compartida.
- El servidor (Azure) siempre actualiza y borra por id; el error era solo del enlace.
