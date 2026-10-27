# Tareas, audiencias y términos

- Servidor: `juanmaapp/src/agenda-routes.js` (`PUT /tasks/:id`); enlace: `public/demo-backend.js` (misma ruta); diálogo en `public/app.js` (`openTaskDialog`).
- Editar (27/10/2026, pedido de John «El usuario debe poder editar la tarea»): además de Gerencia y quien tiene `cases.write` en la oficina del expediente, el funcionario ASIGNADO a la tarea puede editar título, notas, fecha/hora, lugar, avisos, término y respuesta. No puede reasignarla, cambiarla de expediente ni notificar (403). Borrar sigue siendo de quien tiene permiso.
- Rastro: cada edición queda en `task_log` (solo se agrega): «editada», «reprogramada» (y reasignada si aplica); si cambia la fecha se rehacen los avisos de la campana (`task:ID:%`).
- Pruebas: `test/v2284-editar-tarea-asignado.test.js`, `test/v282-tareas-asignadas.test.js`.
