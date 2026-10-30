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

- v2.60 (19/10/2026, John): la firma electrónica (módulo Firmas y recibos) se plasma como su imagen de ejemplo: QR, nombre, CC, «Firma Electrónica» con fecha y hora -05:00 y bloque de datos; con el logo de Tecjuridicos SAS como marca de agua al fondo del sello. John la llamó «certificada»: la App hace firma electrónica con evidencia, no certificada por entidad acreditada (ONAC); explicárselo.

## Firma certificada: proveedores (20/10/2026, pregunta de John)
La firma de la App es electrónica con evidencia, no certificada. Entidades de certificación digital acreditadas por el ONAC que citan las fuentes: Certicámara, GSE, Andes SCD, Camerfirma Colombia, Thomas Signe, Viafirma (acreditada marzo 2024), OlimpIA. Precio: solo una referencia de un blog (POS Colombia): $120.000 a $180.000 COP por año por un certificado de firma digital; ninguna entidad publica tarifa verificada, los planes de empresa con API se cotizan. Recomendado: pedir cotización a Certicámara, Andes SCD y Viafirma (firma en la nube con API). Pendiente de John.

- v2.2.33 (23/10/2026, John): al dar «Guardar recibo» la ventana se cierra (`$("#receipt-dialog").close()` justo tras registrar, antes de armar el Word/PDF); el sello (`receiptStampPng`) añade la T.P. del firmante. Los datos de firma (nombre completo, cédula, T.P.) los carga Gerencia en Usuarios → editar; si faltan salen [FILL] resaltados (John no los tenía cargados el 23/10).

- v2.2.70 (26/10/2026, John: «El administrador debe estar en capacidad de borrar registros efectuados en el módulo de cartera»): Gerencia borra cobros y recibos. `GET /payments/{charges,receipts}/:id/deletion` da el texto y el efecto en el saldo (`ledger.balanceEffect`, textos en `record-rules.js`); `DELETE` pide `confirm` (número del recibo o «ELIMINAR»), copia previa y bitácora. Un cobro se lleva sus recibos y recordatorios. El mayor número de recibo emitido se guarda en settings `receipt_issued` (enlace: `info.receiptIssued`) para no reusarlo. Pruebas: `test/v2-2-70-borrar-cartera.test.js`.

- v2.2.78 (27/10/2026, John: «Debe permitirse incluir el valor de honorarios de manera manual, cada abono debe verse reflejado por expediente y por cliente… clientes sin expediente»): sin tablas nuevas. Honorarios = cobro (`charges`) con `case_id` o sin él (directo al cliente); abono = recibo (`receipts`). `+ Honorarios` (`data-fees`) abre `openChargeDialog(..., fees=true)` con concepto «Honorarios». Ficha del cliente: `feesPanel` (honorarios con abonado y saldo + historial de abonos). Ficha del expediente: los abonos son los del expediente o los que pagan un cobro suyo. Un abono a un honorario sin expediente no se asigna al único expediente del cliente (`fillReceiptCharges`). Pruebas: `test/v2-2-78-honorarios-cliente.test.js`.

- v2.3.22 (30/10/2026, John: «en el registro de honorarios… establecer manualmente el valor de cada cuota y las fechas; al registrar un pago, debitarse»): `openChargeDialog` tiene la casilla `#charge-manual` y filas `#charge-parts` (`renderChargeParts`, `manualParts`); `POST /payments/charges` acepta `parts: [{amount, due_date}]` que deben sumar `amount` (cada una = un cobro «Cuota i de n»). El débito del saldo ya existía (`applyPayments`). Prueba: `test/v2-3-22-cuotas-manuales.test.js`.
