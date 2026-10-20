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

## Contrato con honorarios (20/10/2026, versión 2.67)
- Entregable: /mnt/project-files/contrato-honorarios/ (plantilla .docx, ejemplos llenados y capturas). Gerencia lo carga en Documentos; no se siembra.
- Casillas en Documentos (`feeChecklist` en `public/app.js`): **Honorarios**, **Cuota de litis** o **Mixto** (ambos). Se escriben solo números: «2000» o «$2000» salen «$2.000» al salir de la caja, y el contrato los escribe en número y letras: «$2.000 (dos mil pesos m/cte.)». La cuota de litis también acepta porcentaje («35%» → «treinta y cinco por ciento (35 %)»).
- Lógica compartida en `src/ledger.js`: `pesosFromText`, `fmtPesos`, `numeroEnLetras`, `feeTerms(tipo, fijo, litis)`. `tplValues()` la suma a los datos del documento; pruebas en `test/v267-honorarios.test.js`.
- Marcadores del Word: `{{honorarios.modalidad}}` (no opcional: si no se marca nada sale `[FILL: Modalidad de honorarios]` resaltado; solo existe cuando todos los valores que pide la casilla son válidos), y frases opcionales `{{#honorarios.fijo}}`, `{{#honorarios.litis_porcentaje}}`, `{{#honorarios.litis_valor}}`.
- Los tres datos se guardan en el expediente como campos `Tipo de honorarios`, `Honorarios valor` y `Cuota de litis` (botón «Guardar datos en el expediente»; un campo nuevo solo lo crea Gerencia). El cuadro aparece en cualquier plantilla Word que use esos marcadores.
- Ya no se toma el valor de Pagos para este contrato (el panel «Registrar honorarios en Pagos» sigue existiendo aparte).
- Cláusulas del contrato: CUARTA «Naturaleza de la obligación» (actividad de medio y no de resultado) y QUINTA «No devolución de los pagos efectuados» (si el Poderdante desiste, revoca el poder o termina el contrato); las demás pasan a SEXTA…NOVENA. Redactadas por Claude: John debe revisarlas.
- Medios de pago fijos con logo: Bancolombia ahorros 869 00000 527, Nequi 314 415 6914, Llave Bre-B 314 415 6914. Los logos los subió John (el contenedor no alcanza las páginas de los bancos); recortados a su contenido, en `contrato-honorarios`.
- Los datos del apoderado (John Fredy Quiñones Montaña, cédula, T. P.) quedan fijos en el Word.
- Cómo se armó: guion python-docx que reemplaza texto entre runs conservando el formato del primero; se prueba llenándolo con `public/docx.js` en Node (docxtemplater de `juanmaapp/node_modules`) y se ve en imagen con LibreOffice (sin Century Gothic: la letra de la imagen es parecida).
