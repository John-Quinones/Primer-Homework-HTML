# Campana de notificaciones

- Servidor: `juanmaapp/src/agenda-routes.js` (`GET /notifications`); enlace: `public/demo-backend.js` (misma ruta). Regla común en `src/case-meta.js` (`bellShows`, `noteTaskId`). Las alertas se crean en `src/monitor.js` (`taskReminders`, `checkCase`) y al asignar/notificar tareas.
- Regla de John (23/10/2026, v2.97): una tarea resuelta (Cumplida / No cumplida) desaparece de la campana y queda en el historial del expediente (`task_log`, ya existía). Los avisos de agenda (audiencia: todos; término/tarea: los recordatorios) desaparecen al llegar la fecha; la «vencida» de una tarea/término sigue hasta resolverla. «Actuaciones nuevas» desaparece al leerla.
- Nada se borra: `bellShows` solo filtra lo que se muestra (por la clave `task:ID:…`, `assign:ID:…`, `notice:ID:…`). Si se reabre la tarea, sus avisos vuelven. Los avisos «le notificó» anteriores a 2.97 no tienen clave de tarea y siguen hasta leerlos.
- Prueba: `test/v297-campana-alertas.test.js`.
