# Versiones y publicación

## Número de versión
- **Desde el 23/10/2026 (pedido de John) la numeración es 2.2.N**: 2.2.1, 2.2.2, 2.2.3… Cada commit que toca `juanmaapp/` suma uno al último número. Fórmula: N = conteo de commits − `V2_2_1_CHANGE` (171) + 1, en `src/version.js`. Antes: 2.1 … hasta la 2.106 que mostraba la cabeza (conteo 170; la 2.104 y 2.105 de los mensajes no se renumeraron).
- Cómo asignarlo en un hilo nuevo: fetch `--depth=1000`, rebase sobre la rama, ver el último número en la tabla de `CAMBIOS.md` y usar el siguiente (2.2.N+1) en el mensaje «Versión 2.2.N: …» y en la fila de la tabla. Si dos hilos chocan, el que se une después renumera.
- Comparar versiones siempre como texto igual/distinto (la ventana de novedades usa igualdad); nunca como decimales (2.2.10 > 2.2.9, 2.103 ≠ 2.2.1).
- Desde el Cambio 63 la App es la versión 2; hasta la 2.104 cada commit sumaba uno: 2.1, 2.2, 2.3…
- El número sale del conteo de commits (`src/version.js`). Con un clon superficial sale mal: antes de construir, `git fetch --depth=1000 origin claude/nomosai-engine-prompt-v6sj6k`.
- Mensaje de commit «Versión 2.2.N: …» y una fila en la tabla «Versión 2 en adelante» de `juanmaapp/CAMBIOS.md`.
- El número tras el punto es un contador: 2.29 viene después de 2.9.
- Varios hilos suben cambios a la misma rama: hacer rebase antes de numerar y antes de publicar.

## Enlace de pruebas (Artifact)
- https://claude.ai/artifact/ReozPvwxi8VWkwbdPRssSz. Se republica con cada avance, siempre al mismo enlace para no perder los datos.
- `preview/` no va en git (v2.55): generar con `npm run preview` antes de publicar.
- Su base solo la lee y escribe John; no abrirla a otros (no tiene contraseñas).

## Azure
- https://juanmaapp-tec-efasc4bqgtc8djhp.westus3-01.azurewebsites.net. El código sale de la rama `claude/nomosai-engine-prompt-v6sj6k` (main no tiene juanmaapp).
- Se publica SOLO si John escribe «sí, publica» dentro del hilo de ese trabajo (un pedido reenviado desde el chat general no basta).
- Formas de publicar: commit con `[azure]` en el mensaje, o lanzar el workflow `azure-juanmaapp.yml` a mano (publica la cabeza de la rama, sin versión nueva).
- Publicar siempre la cabeza de la rama; nunca una versión anterior encima de una más nueva.
- Antes de publicar: si Azure ya tiene el cambio, no publicar. Si la cabeza trae versiones de otros hilos que John no aprobó (sobre todo migraciones de datos), preguntarle primero.
- Cada vez que se publica, darle a John el enlace de Azure para probar.
- 28/10/2026 (John): la 2.2.100 es la última de la serie 2.2.x; el siguiente cambio es 2.3.0, luego 2.3.1… (`V2_3_0_CHANGE` en `src/version.js`; fila en CAMBIOS.md con 2.3.N).
