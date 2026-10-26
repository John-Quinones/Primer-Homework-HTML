# Plantillas y minutas

Reglas de John para TODAS las minutas y plantillas (19/10/2026):

- Conservar el formato original: Century Gothic, tamaños, logos, encabezado y pie.
- Llenar solo con datos del cliente y del expediente. Avisar los datos que faltan y resaltarlos en amarillo al descargar (`[FILL: dato]`).
- QR del encabezado en color RGB 31/56/100 con fondo transparente.
- Adaptar al género del cliente: «el suscrito / identificado / domiciliado» o «la suscrita / identificada / domiciliada». El género se toma del primer nombre conocido; si el nombre es raro, queda vacío para llenarlo a mano.
- Frases opcionales con `{{#campo.X}}…{{/campo.X}}`: si el dato está vacío, la frase desaparece. Formato `|líneas`: cada «;» es un renglón.
- En procesos penales se omite la línea «Proceso … Radicación No. …» (`{{#expediente.proceso_linea}}`).

## Quién hace qué
- Crear tipos de proceso, campos y funciones es SOLO de Gerencia (el administrador).
- Plantillas de documentos (v2.2.32, John 23/10/2026): el Director Jurídico también sube, descarga, reemplaza y crea plantillas (permiso `templates.manage`; Gerencia lo conserva siempre). Eliminar una plantilla sigue siendo solo de Gerencia (todo borrado). Servidor: `DEFAULT_MATRIX` + `grantTemplatesToDirector` (`src/db.js`, una vez, con copia previa; solo agrega la fila, no quita nada); enlace: `migrate` en `public/demo-backend.js` (`info.templatesDirector`). Gerencia puede quitárselo en Usuarios › Roles y no se vuelve a dar.
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

## Membrete, pie, numeración y marca de agua (v2.2.4, 23/10/2026)
- Pedido de John: todos los documentos que la App genere en PDF o Word usan su «Plantilla Membrete_Pie_Encab_Pagina»; el reporte del correo certificado lleva la marca de agua con el logo de Tecjuridicos.
- La plantilla adjunta NO trae marca de agua (solo logo, QR, pie, borde y número de página en un encabezado que no se usa); la marca es el logo de Tecjuridicos al 16 % (Word) / 11 % (PDF), centrado detrás del texto.
- PDF: `public/membrete.js` (`newPdf`, `pdfBox`, `finishPdf`); lo usan `markdownToPdf`, `signatureCertificate`, `mailProof`, reportes, recibo simple y estado de cuenta. Los PDF originales que se suben a Firmas no se modifican (cambiaría su huella); solo se estampan.
- Word: `public/membrete-base.docx` (cuerpo `<!--BODY-->`, estilos Ttulo1-3) lo usa `markdownToDocx`; `public/recibo-base.docx` lleva el mismo encabezado y pie. Ambos y `public/membrete-assets.js` salen de `python3 scripts/build-membrete.py <plantilla.docx>`.
- Las plantillas Word cargadas por Gerencia en Documentos conservan su propio membrete (no se sobrescriben).
- El pie del recibo ya no dice ojani0722@hotmail.com: ahora gerencia@tecjuridicos.com (el de la plantilla nueva).
- La letra de los PDF es la estándar de jsPDF (no hay Century Gothic para PDF); los Word usan Century Gothic.

## Objetos contractuales (v2.2.46, 26/10/2026, hilo «Objetos contractuales configurables en contrato»)
- Pedido de John: en la Plantilla de Contrato, el administrador crea y modifica a gusto varios «Objetos contractuales» (título + cláusula); al hacer el contrato el usuario marca casillas y la cláusula de cada una se imprime en el contrato.
- Marcador del Word: `{{OBJETOS_CONTRACTUALES}}` (antes el ejemplo de John usaba `{{campo.Objeto del contrato}}`). Word ya ajustado: /mnt/project-files/contrato-objetos/. Sin casillas marcadas sale `[FILL: Objetos contractuales]` resaltado.
- Lógica compartida: `src/contract-objects.js` (`JuanmaContractObjects`: `objectValues` valida, `mergeObjects` une). Una cláusula sale tal cual; varias salen «A) … B) …» separadas por línea en blanco, dentro del mismo párrafo (saltos de línea), así conservan la letra y el formato del Word. La cláusula admite `{{cliente.nombre}}` y similares (dato faltante = resaltado).
- Servidor: `src/contract-objects-routes.js` (`/api/contract-objects`: GET lista activos o `?all=1` para Gerencia, POST, PUT `/:id`, PUT `/order {ids}`, DELETE, POST `/uses`, GET `/uses?case_id=`); enlace: mismas rutas en `public/demo-backend.js` (`s.cobjects`, `s.cobjuses`). Solo Gerencia crea/edita/ordena/elimina (no basta `templates.manage`: el Director Jurídico solo lee la lista activa).
- Tablas nuevas `contract_objects` y `contract_object_uses` (título copiado, sin llave foránea): solo se agregan, con copia previa `antes-v2.2.46`. Eliminar un objeto ya usado solo lo desactiva.
- Pantalla: pestaña «Objetos del contrato» (`renderCobjAdmin`, `#cobj-dialog`) y casillas en «Datos del documento» (`objectsChecklist`, `tplObjects`). Se registra el uso al descargar, guardar, enviar por correo o WhatsApp.
- Interpretaciones: objetos globales de la categoría Contrato (sirven a cualquier Word con el marcador); texto simple, sin editor enriquecido (el formato lo da el Word). Pruebas: `test/v2246-objetos-contractuales.test.js`.


## Clases de poder (v2.2.47, 26/10/2026, hilo «Clases de poder configurables en poder»)
- Pedido de John: en la Plantilla de Poder el administrador crea, edita, ordena y desactiva/elimina «Clases de poder» (título, descripción opcional, texto de facultades, activo, orden); al hacer el poder el usuario marca casillas y el texto de cada una va al marcador `{{CLASES_DE_PODER}}` (o `{{FACULTADES_ESPECIFICAS}}`). Una casilla: texto tal cual; varias: A), B), C)… Se guarda qué clases llevó cada poder (`contract_object_uses`, kind poder).
- No se duplicó código: es el mecanismo de «Objetos contractuales» (v2.2.46) con columna `kind` ('contrato' | 'poder') y `description` en `contract_objects`; `contract_object_uses` también lleva `kind`. `contractObjectsRouter(db, kind)` se monta en `/api/contract-objects` y `/api/power-classes` (`src/app.js`); enlace: `cobjRoutes(path, kind)` en `public/demo-backend.js`. Texto de la clase = columna `clause` (al escribir la API acepta `clause` o `content_template`; al leer devuelve `clause`).
- Migración (`src/db.js` + `addKindColumns`): solo ADD COLUMN, copia previa `antes-v2.2.47` si ya existían las tablas de la 2.2.46 sin `kind` y hay datos. Filas anteriores quedan como contrato.
- Solo Gerencia crea/edita/ordena/elimina; los demás con `drafts.generate` leen las activas. Eliminar una clase ya usada solo la desactiva.
- Pantalla: pestaña «Clases de poder» (`renderPickAdmin('poder')`, `#pcls-dialog`) y casillas en «Datos del documento» (`pickChecklist`, tabla `PICK` en `public/app.js`). Los datos escritos dentro del texto de una clase (`{{campo.Deudor}}`) se piden en el formulario (`clauseVars`).
- Word de ejemplo (poder de víctima al empleador) con el marcador en lugar del párrafo de facultades: /mnt/project-files/clases-de-poder/. Pruebas: `test/v2247-clases-de-poder.test.js`.

## Asistente «Contrato o poder» (v2.2.48, 26/10/2026)
- Pedido de John: orden claro cliente → expediente → contrato/poder → checklist del tipo → honorarios (solo contrato) → Word; entrada desde el expediente o directo desde Documentos.
- Pestaña `data-dtab="guiado"` (primera; las plantillas de siempre quedan en «Otras plantillas»). Pasos 1–3 propios (`#wz-client`, `#wz-case`, `[name=wz-kind]`, `#wz-tpl`; código `renderWizard`, `wzPickClient`, `wzKind`, `wzPreselect` en `public/app.js`). Los pasos 4–6 son el panel `#tpl-active` de siempre: `wzDock()` lo mueve a `#wz-host` mientras la pestaña está abierta y lo devuelve al salir; el CSS (`#wz-host`) pone los botones de generar al final y oculta el selector de expediente y el cuadro viejo «Registrar honorarios en Pagos» solo en el asistente.
- `draft-case` («Generar documento» del expediente) ya no abre NomosAI: `renderBorradores` llama `wzPreselect(caseId)`. Las leyendas «4.» y «5.» (`stepTag`) solo salen dentro del asistente.

## Valores en vivo (v2.2.49, John 26/10/2026)
- Pedido: «los valores números deben ir mostrando unidades, decenas, centenas». Al escribir en las casillas de honorarios (`[data-fee-money]`) el evento `input` de `#tpl-vars` (public/app.js) pone los puntos de miles, conserva el cursor y actualiza sin redibujar el panel la frase «En el contrato: …» y el desglose `L.placeValues` (src/ledger.js, p. ej. «2 unidades de millón · 5 centenas de mil»). Porcentajes: solo letras. El `change` de siempre sigue dando el formato final al salir de la casilla. Prueba: `test/v2249-valores-en-vivo.test.js`.

## Calidad de las partes según género y número (v2.2.53)
- `partyContext`/`partyWords`/`roleWords` en `src/case-meta.js`; `templateData` (servidor y enlace) da `parte.activa|pasiva`, `cliente.calidad`, `contraparte.calidad` (+ `_sola`, `_titulo`) y `_partes` (contexto en JSON para que la app rehaga las palabras cuando se cambia «Género del cliente»; `partyWordsOf` en `public/app.js`).
- Regla de John (26/10/2026): mujer = «la demandante / la demandada», hombre = «el demandante / el demandado», varios = «los demandantes / los demandados». Persona jurídica = femenino; contraparte sin género = masculino.
- `docxGenderWords` (docx.js) también detecta esas palabras en el Word (`PARTY_RE`). Las plantillas iniciales de texto no se cambiaron (llevan «Demandante:»/«Demandado:» fijos).
- Cuotas de honorarios (v2.2.52–2.2.54): marcador `{{honorarios.cuotas}}` (una cuota por renglón) dentro de `{{#honorarios.cuotas}}…{{/…}}` en su propio párrafo (paragraphLoop) y `{{^honorarios.cuotas}}` para «a la firma». Si el Word no trae el marcador, las cuotas no salen: minuta en /mnt/project-files/contrato-objetos/ «(cuotas, objetos y logos).docx». No usar `{{honorarios.numero_cuotas}}` fuera de un `{{#…}}` propio (saldría como dato faltante).
- Minuta del contrato por género (v2.2.57): los artículos delante de PODERDANTE usan `cliente.el|al|del` (+ `|mayúsculas`/`|inicial`). La minuta vigente es la que John sube (la de 26/10 02:15 trae el bloque PARTES): trabajar siempre sobre la última, no sobre una copia anterior. `docxGenderWords` ignora palabras dentro de {{marcador}}; al aplicar todo, excluir a mano el «identificado» del abogado.


## Numeración y pie (v2.2.58)
- Contratos desde el No. 2.326 y poderes desde el No. 10.222 (`src/doc-numbers.js`, tabla `doc_numbers`, `POST /api/doc-numbers`); se asigna al generar (Word, PDF, guardar, correo, WhatsApp, firma), guardado o no en el expediente. Marcador `{{documento.numero}}`; la minuta debe tenerlo (ej. «No.{{documento.numero}}»).
- Pie de todo documento generado: «Documento generado por: <usuario>» (`stampFooter` en `public/docx.js`, `finishPdf` en `public/membrete.js`).
- Barra del asistente: cada paso verde cuando está completo (`wzBar`, `wz.generated`).
