# Módulo Firma (firma electrónica y envío)

- Servidor: `juanmaapp/src/esign.js` (solicitudes, OTP, `ensureSignedPdf`, `issueLetterSignature`). Estampa: `public/pdf-tools.js` (`signedPdf`, `STAMP` 250×104) y `src/signed-pdf.js`. Vista previa y marcador: `public/pdf-view.js` (`render`, `markStamps`). Verificación pública: `verificar.html`.
- Posición de la firma: `stamp_pos` = `br|bc|bl|tr|tl` o `at:X,Y` (fracciones de la página); `stamp_page` = `last|first|all|new|N`.
- Firmar y enviar por correo (v2.2.97): botón «Firmar y enviar por correo» en Firmas (`#fse-dialog`, `openFseDialog` en `public/app.js`). `POST /api/mail` con `sign: {pdf_base64, filename, stamp_page, stamp_pos}` crea una solicitud completada (método `plataforma`) con `issueLetterSignature`, estampa y adjunta el PDF «… - firmada.pdf» a uno o varios destinatarios (`to`, `cc`). Exige nombre completo y cédula del usuario (Usuarios). Queda en Correo certificado. En el enlace de pruebas no se envían correos.
- Los destinatarios no están guardados en la App: el usuario los escribe cada vez (acepta «Nombre: correo»).
- Pruebas: `test/v2297-firmar-y-enviar.test.js`.
