# Plantillas y minutas

Reglas de John para TODAS las minutas y plantillas (19/10/2026):

- Conservar el formato original: Century Gothic, tamaños, logos, encabezado y pie.
- Llenar solo con datos del cliente y del expediente. Avisar los datos que faltan y resaltarlos en amarillo al descargar (`[FILL: dato]`).
- QR del encabezado en color RGB 31/56/100 con fondo transparente.
- Adaptar al género del cliente: «el suscrito / identificado / domiciliado» o «la suscrita / identificada / domiciliada». El género se toma del primer nombre conocido; si el nombre es raro, queda vacío para llenarlo a mano.
- Frases opcionales con `{{#campo.X}}…{{/campo.X}}`: si el dato está vacío, la frase desaparece. Formato `|líneas`: cada «;» es un renglón.
- En procesos penales se omite la línea «Proceso … Radicación No. …» (`{{#expediente.proceso_linea}}`).

## Quién hace qué
- Crear o cambiar plantillas, tipos de proceso, campos y funciones es SOLO de Gerencia (el administrador).
- Las plantillas nuevas se entregan como .docx para que John (Gerencia) las cargue en Documentos. No se siembran en la base.
- No convertir las plantillas Word a otro formato: pierden el formato.

## Dónde están
- Poderes de víctima (Fiscalía y Empleador): /mnt/project-files/poderes-victima/
- Minuta de pensión de sobreviviente: /mnt/project-files/minuta-pension-sobreviviente/
- Contrato de prestación de servicios con honorarios fijos y cuota de litis (19/10/2026): /mnt/project-files/contrato-honorarios/

## Contrato con honorarios fijos y cuota de litis (19/10/2026)
- Honorarios fijos = los cobros del expediente en Pagos: `{{honorarios.valor}}`, `{{honorarios.valor_letras}}`, `{{honorarios.forma_pago}}` (`feeVariables` en `src/ledger.js`). Sin cobros salen como faltantes resaltados.
- Cuota de litis = dos frases opcionales: `{{#campo.Cuota de litis porcentaje}}` (se escribe «treinta y cinco por ciento (35 %)») o `{{#campo.Cuota de litis valor}}` (se escribe «$20.000.000 (veinte millones de pesos)»). Se llena una de las dos en «Preparar campos»; la vacía desaparece.
- Objeto del contrato = `{{campo.Objeto del contrato}}`; contraparte = `{{expediente.contraparte}}`; firma del cliente con `{{cliente.documento|puntos}} de {{cliente.expedicion}}`.
- Los datos del apoderado (John Fredy Quiñones Montaña, cédula, T. P.) quedan fijos: la App no guarda la cédula del abogado.
- Medios de pago fijos (pedido de John): Bancolombia ahorros 869 00000 527, Nequi 314 415 6914, Llave Bre-B 314 415 6914, cada uno con su logo.
- El contenedor no alcanza las páginas de los bancos ni Wikimedia: los logos los debe subir John.
- Se arma con un guion python-docx que reemplaza texto entre runs conservando el formato del primero; se prueba llenándolo con `public/docx.js` en Node (docxtemplater de juanmaapp/node_modules).
