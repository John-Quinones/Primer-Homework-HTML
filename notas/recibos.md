# Recibos de pago (Word/PDF)

Pedido de John (19/10/2026, hilo «Recibos de pago con firma»). Instrucciones completas:

- Los recibos se generan en Word y PDF, con Documentos y Pagos trabajando juntos (interoperables).
- Dónde queda instalado: botón «Generar recibo» en Pagos (fila del recibo, ficha del expediente y al registrar un pago); usa el motor de plantillas Word de Documentos (`JuanmaDocx.fillDocx`).
- Diseño: se toma de la plantilla Word del contrato (hilo «Plantilla de contrato y honorarios»): logo de Tecjuridicos, QR del encabezado (RGB 31/56/100, fondo transparente), pie de página y letra Century Gothic.
- Firma: si lo hace el administrador (Gerencia), va firmado con los datos de John: nombres y apellidos completos, cédula de ciudadanía y tarjeta profesional. Si lo hace otro usuario, va firmado con los datos de ese usuario. Esos datos se guardan en el usuario (Usuarios → editar).
- El recibo se carga automáticamente al expediente (Documentos guardados, Word y PDF).
- Ningún recibo se puede borrar: solo el administrador (Gerencia), con copia de seguridad previa. La regla va en el servidor y en el enlace de pruebas.
- Medios de pago de la empresa (los trabaja el hilo del contrato): Bancolombia ahorros 869 00000 527, Nequi 314 415 6914, Llave Bre-B 314 415 6914.
- Datos reales: migración que conserva todo, respaldo previo, pruebas solo en copia local.
- Publicar en Azure solo con «sí, publica» de John dentro del hilo.
- Pedido final de John: «Sube todas las instrucciones al archivo .md» (este archivo).

## Dónde está en el código (v2.58)
- Word base: `juanmaapp/public/recibo-base.docx` (sale del Word del contrato; marcadores `{{recibo.*}}` y `{{firma.*}}`).
- Generación: `buildReceiptFiles`, `saveReceiptToCase`, `downloadReceipt` en `public/app.js`; botones Word/PDF/Eliminar en Pagos → Recibos.
- Firmante: columnas `users.legal_name` e `id_number` (Usuarios → editar) y `professional_card`; el recibo toma los del usuario que lo registró.
- Borrado: `DELETE /payments/receipts/:id` y borrar un documento `recibo` solo Gerencia, con `backupBeforeReceiptDelete` antes; el enlace guarda lo borrado en `receiptTrash`.
- Pruebas: `test/v258-recibos.test.js` (servidor y enlace dan lo mismo).

- v2.59 (19/10/2026, John): el recibo debe quedar con el formato (proforma), membrete y pie exactamente iguales a los demás Word; y lleva la firma electrónica del usuario (menú del usuario → «Mi firma electrónica», dibujada; se estampa sobre su nombre).
