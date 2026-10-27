# Chat entre usuarios y videollamada (v2.2.82, 27/10/2026)

Pedido de John: «un chat entre los usuarios de la App con todas las funcionalidades necesarias» y «posibilidad de videoconferencia».

- Código: servidor `juanmaapp/src/chat.js` (rutas `/api/chat/*`), tablas `chat_*` en `src/db.js` (solo se añaden; no se tocó ninguna tabla existente), pantalla `public/chat-page.js` (carga después de app.js y usa su `api`, `me`, `RENDER`), estilos al final de `styles.css`, prueba `test/v2-2-81-chat.test.js`.
- Conversaciones: «General» (todo el despacho, siempre existe), directas (una por pareja, clave `menor:mayor`) y grupos (cualquier integrante agrega gente o sale). Nadie lee conversaciones ajenas, tampoco Gerencia (propuesto a John; si decide otra cosa, cambiar `mine()` en chat.js).
- Los mensajes NO pasan a la Bitácora (`/chat/` está en SKIP de `src/audit.js`).
- Nada se borra: «Eliminar» solo marca `retracted_at` (los demás ven «Mensaje eliminado»); cada edición guarda el texto anterior en `history`. Esto respeta la regla de que solo Gerencia borra.
- No leídos: `last_read_id` por integrante; contador en el menú (`#chat-badge`, se consulta cada 15 s) y en el título de la pestaña. Campana: un aviso por mención (`@Nombre completo`), por grupo nuevo, por videollamada y uno por «racha» sin leer en chats directos/grupos (clave `chatmsg:conv:usuario:ultimoLeido`). General no avisa si no hay mención.
- Conectado = sesión con `last_seen` en los últimos 3 minutos (se actualiza con cada petición).
- Enlazar cliente/expediente: el remitente solo puede enlazar lo que su oficina le deja abrir; la etiqueta (cliente · título) la ven los integrantes de la conversación. El botón abre `#expediente-ID` / `#cliente-ID`.
- Archivos hasta 5 MB, guardados en `chat_files` (base de datos); solo los descargan integrantes.
- Mensajes por consulta periódica (3 s abierto, 10 s lista): sin WebSocket, funciona detrás del proxy de Azure F1.
- Videollamada: WebRTC directo entre navegadores (hasta 6 personas, malla), sin costo ni credenciales. El servidor solo pasa las señales (`chat_signals`, se purgan a los 10 min) y sabe quién está en la llamada (`chat_calls`, `chat_call_members`; un participante sin consulta en 25 s se considera fuera). Servidores STUN gratis de Google; si una red bloquea el video (cortafuegos estricto) hace falta un servidor TURN: variables `CHAT_TURN_URL`, `CHAT_TURN_USER`, `CHAT_TURN_PASS`. Probado en el contenedor con dos navegadores reales (video llegó en ambos sentidos).
- El enlace de pruebas (artifact) y la demo tienen un solo navegador: la pantalla explica que el chat funciona en el servidor (`SERVER_ONLY` en chat-page.js). No hay copia en `demo-backend.js` a propósito.
- Pendiente de decidir con John: permiso propio para usar el chat (hoy todos los usuarios activos), que Gerencia pueda auditar chats, retención de archivos.
- Ventana acoplada abajo (pedido de John, mismo día): `#chat-dock` en toda pantalla menos «Chat»; barra plegada con contador, al tocarla se despliega y muestra lista e historial (con «Cargar mensajes anteriores»); «Ampliar» abre la pantalla completa `#chat-N`. Es el mismo `#chat-app` que `syncDock()` (chat-page.js) mueve entre `#view-chat` y `#chat-dock-body`; abierto/plegado se recuerda en sessionStorage `jm_chat_dock`. La ventana sigue abierta al cambiar de módulo.
