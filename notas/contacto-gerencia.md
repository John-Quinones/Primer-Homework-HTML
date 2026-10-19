# Contacto de Gerencia (correo y WhatsApp)

- Correo de Gerencia: gerencia@tecjuridicos.com. Es el correo del usuario John Quinones (Gerencia), el de la firma en `juanmaapp/src/legal.js` (`FIRM.email`) y el remitente de la App en Azure (`MAIL_FROM`, guía en la carpeta del proyecto `correo/conectar-gerencia.md`).
- WhatsApp de John: 314 415 6914 (confirmado por John el 19/10/2026). Es también `FIRM.phone`.
- Dónde vive el número en la App: campo «Celular / WhatsApp» del usuario (Usuarios → Editar; `users.phone`). De ahí salen los avisos de agenda, tareas y reportes por WhatsApp (`report_prefs.whatsapp` toma `u.phone` si no hay otro).
- Enlace de pruebas y Azure tienen bases separadas: el número se guardó en el usuario del enlace (19/10/2026, respaldo previo en `respaldos/2026-10-19-antes-whatsapp-gerencia/`). En Azure lo escribe John en Usuarios → Editar.
- Para que el servidor envíe WhatsApp solo faltan las variables de Meta (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TEMPLATE`), ver `juanmaapp/AZURE.md` paso 7.
