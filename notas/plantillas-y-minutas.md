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
- v2.2.59 (26/10/2026): un Word de categoría Poder sin marcador muestra el cuadro de clases con aviso y el botón «Elegir dónde van las clases de poder» (`openMarkerDialog`, `#pmark-dialog`; `D.docxParagraphs` y `D.docxInsertParagraph` en `public/docx.js`: párrafo nuevo tras el elegido, con su formato). Lo pidió John porque su «Poder_ 26Oct2026» no traía el marcador.
- v2.2.61 (26/10/2026): `{{expediente.demandados|líneas}}` (`counterpartyLines` en `src/case-meta.js`; servidor `src/templates.js`, enlace `public/demo-backend.js`) = partes pasivas no nuestras con su documento, una por línea. John pidió sustituir el campo «Empleadores» del poder al empleador por datos de la entidad o entidades demandadas. Word: /mnt/project-files/clases-de-poder/.
- v2.2.63 (26/10/2026): el radicado llega a los Word aunque pidan `{{campo.Radicado}}`/`{{campo.Número de expediente}}`… (`fillRadicadoAliases` en `src/case-meta.js`, servidor y enlace; solo llena si el campo está vacío o no existe) y `expediente.radicado` / línea de proceso caen al número de expediente si no hay radicado. Pedido de John con su «Poder_ 26Oct2026».

## Impulso procesal y última actuación (v2.2.64, 26/10/2026)
- Pedido de John: plantilla «Impulso» (memorial que pide al funcionario a cargo emitir decisiones hasta llegar a sentencia) con la última actuación de lo consultado en Rama Judicial.
- Marcadores nuevos: `actuacion.ultima`, `actuacion.ultima_fecha` («9 de marzo de 2026»), `actuacion.ultima_anotacion`, `actuacion.ultima_linea` (`lastActuacionVariables` en `src/case-meta.js`; sale de la tabla `actuaciones` / `s.acts` del enlace, la más reciente por fecha, empate = la última guardada). Sin actuaciones guardadas no hay marcador: el Word muestra `[FILL: …]` (consultar primero en el expediente). `expediente.demandantes` = parte activa (`plaintiffNames`).
- Word: /mnt/project-files/impulso-procesal/. Destinatario con `destinatario.*`, «apoderado especial {{cliente.del}} {{cliente.calidad_sola}}», radicación `{{expediente.radicacion}}` + `{{#campo.SAMAI}}` opcional y `{{#campo.Situación del cliente}}` opcional (la frase de la crisis económica del original). Datos del apoderado fijos en el Word.


## Memoriales con categorías (v2.2.65, 26/10/2026, hilo «Crear botón Memoriales con categorías»)
- Pedido de John: botón «Memoriales», como «Contrato o poder», con categorías (solicitud de impulso, solicitud de link, requerimiento…), cada una con sus plantillas.
- Pestaña `data-dtab="memoriales"`: es el mismo panel del asistente (`wz`), con `wz.mode = "memorial"` (`wzMode`, `renderMemcats`, `wzMemorial` en `public/app.js`). Paso 3 = categorías de memorial; luego plantilla y Word (pasos: Cliente, Expediente, Categoría, Plantilla, Word). Botón «Memorial» en la ficha del expediente (`memorial-case`).
- Categorías: tabla `memorial_categories` (título, descripción, activa, orden) y columna `document_templates.memorial_category_id`; rutas `/api/memorial-categories` (`src/memorial-categories-routes.js`; enlace: `public/demo-backend.js`; validación compartida `src/memorial-categories.js`). Solo Gerencia crea/edita/ordena/elimina; quien redacta lee las activas. Una categoría con plantillas solo se desactiva.
- Una plantilla pertenece a una categoría de memorial solo si su categoría es «Memorial» (el cuadro «Categoría de memorial» sale en Nueva/Editar plantilla); sin categoría = «Otros memoriales». Solo Gerencia asigna una plantilla a una categoría de memorial y crea categorías (v2.2.67, John 26/10/2026); el Director Jurídico sigue gestionando plantillas pero no puede cambiar su categoría de memorial.
- Categorías iniciales una sola vez (bandera `memorial-categories-v1`, solo si no hay ninguna): Solicitud de impulso, Solicitud de link, Requerimiento. La plantilla de impulso (v2.2.64, hilo «Adaptar plantilla de impulso procesal») va en la primera. Pruebas: `test/v2265-memoriales.test.js`.
- v2.2.68 (26/10/2026, John): cada categoría de memorial lleva su texto (`memorial_categories.clause`, solo Gerencia) y se imprime en el marcador `{{CATEGORIA_MEMORIAL}}` del Word; el texto es el de la categoría elegida en el asistente (o la de la plantilla). Pestañas renombradas por John: «Categorías Contratos» (objetos contractuales), «Categorías Poder» (clases de poder) y «Categoría Memoriales». Solo cambian los rótulos de pestañas y títulos de panel.
- v2.2.69 (26/10/2026, John): en «Memoriales» hay botones para crear (`wz-new-memorial` → `openTemplateDialog(null, preset)`) y cargar Word (`wz-upload-memorial`, bandera `memorialUpload` en el cargador `#tpl-file`) plantillas de memorial; la lista de la categoría se refresca al guardar (`wzRefreshMemorial`). Solo Gerencia asigna la categoría de memorial.

## «Solicitar link de expediente» (v2.2.85, 27/10/2026)
- Pedido de John: con un clic pedir al juzgado del expediente el link del expediente digital; por eso la carta es HTML/CSS (correo), NO Word (John lo repitió: «la plantilla debe hacerse en HTML/CSS»). Un primer intento en Word con su membrete se descartó.
- Dónde: botón «Solicitar link de expediente» en «Generar documento ▾» del expediente (`slink-case`, `openSlink`, `#slink-dialog` en `public/app.js`/`index.html`). Para = correo del juzgado/destinatario; se escribe solo el tipo de actuación; «Enviar al juzgado» manda por `POST /api/mail` con `letter: {kind:"solicitud_link", fields}` y queda en Correo certificado.
- Lógica compartida `src/solicitud-link-letter.js` (`JuanmaSolicitudLink`: `letterFields` toma los datos de `templateData`, `letterMissing`, `buildLetter` = asunto, texto y HTML con estilos en línea). El servidor (`src/mailtrace.js`) arma el correo con esos datos escapados (no acepta HTML ajeno) y adjunta la firma `public/firma-john.png` en línea (`cid:firma-john`). Asunto: «Solicitud Link Expediente - {tipo} – {demandante} Vs {demandado} Radicación No. {radicado}».
- Texto dictado por John: «Actuando como apoderado judicial {del señor/de la señora} {CLIENTE}, por medio del presente escrito solicito de manera respetuosa a su Señoría, se sirva compartirme el link del expediente electrónico. Informo a su Señoría que el correo autorizado por el suscrito apoderado corresponde a gerencia@tecjuridicos.com».
- En el enlace de pruebas no se envían correos: el botón abre `mailto:` con el texto. Pruebas: `test/v2284-solicitud-link.test.js`.
## Plantilla HTML «Solicitud link de expediente» en Memoriales (v2.2.90, 28/10/2026)
- John (28/10) vio vacía la categoría «Solicitud de link» y pidió crear la plantilla HTML/CSS con sus parámetros: por eso existe como plantilla de la App (además del botón de envío con un clic, v2.2.85, que usa `src/solicitud-link-letter.js`; los nombres de variables de ambas son los mismos). Pedido original: carta a los despachos con el diseño de la App y su firma digital (imagen «Firma Octubre2026»), en Memoriales › «Solicitud de link» (y «Generar documento ▾ → Memorial» del expediente).
- Cómo es: plantilla de texto (`format = markdown`) cuyo cuerpo empieza con `<!--tj-html-->` y trae el HTML completo; no hubo cambio de esquema (la columna `format` solo admite markdown/docx). Fuente: `src/plantillas/solicitud-link-expediente.html` (los marcadores `@@FIRMA_LOGO@@`/`@@FIRMA_FOTO@@` se cambian por data URI de `public/firma-logo.png`/`firma-foto.png` en `solicitudLinkHtml()` de `src/templates-seed.js`). Entra una vez por la siembra de plantillas (servidor: `seedTemplates` asigna la categoría «Solicitud de link» si existe; enlace: bandera `linkTplCat`).
- Código: `public/html-template.js` (`JuanmaHtmlTemplate`: `isHtml`, `fromCase` = nombres propios de la carta → datos del expediente, `fill` con [FILL: …] amarillo, `toPdf` = foto de la hoja en carta, se encoge si pasa poco de una hoja). `public/app.js`: vista previa en iframe, botones Word y firma electrónica ocultos, `exportDocument` sin Word (`doc.word` ausente).
- Variables propias (las de John): ciudad, fecha_solicitud, nombre_juez_o_doctora, cargo_despacho, correo_juzgado, ciudad_juzgado, tipo_actuacion, demandante, demandado, numero_radicado, nombre_abogado, identificacion_abogado, nombre_cliente, correo_abogado (+ `documento.numero`, `elaboro`). `tipo_actuacion` e `identificacion_abogado` se escriben a mano (el abogado trae tarjeta profesional si está guardada).
- La firma del pie es siempre la de John (fija en el HTML); `nombre_abogado` sale del responsable del expediente.
- Copias autónomas: `node scripts/build-solicitud-link.mjs <carpeta>` (entregadas en /mnt/project-files/solicitud-link-expediente/). Pruebas: `test/v2281-solicitud-link.test.js`.

## Carta «Solicitud link de expediente» con membrete y firma electrónica (v2.2.91, 28/10/2026)
- Diseño HTML/CSS = membrete de la plantilla Word «Plantilla Membrete_Pie_Encab_Pagina»: logo arriba izquierda, QR arriba derecha, borde azul con sombra, pie alineado a la derecha (dirección, teléfonos, web, correo, ciudad). Imágenes recortadas en `public/carta-*.png`. Archivo: `src/plantillas/solicitud-link-expediente.html`; el correo usa el mismo diseño en tablas (`buildLetter` en `src/solicitud-link-letter.js`).
- Texto de John: inicia con «NOMBRE, identificado civil y profesionalmente como aparece al final en la firma electrónica, actuando como apoderado judicial de …» (sin «Yo»). Despacho en mayúsculas, radicado con guiones.
- Firma: al enviar por `POST /mail` con `letter`, `issueLetterSignature` (`src/esign.js`) crea una solicitud completada (método `plataforma`) con código verificable; QR PNG de `src/qr-png.js`. La estampa lleva nombre completo, cédula y tarjeta profesional del usuario (Usuarios). Sin nombre completo o cédula no se envía.
- La plantilla vieja de 2.2.90 se reemplaza una vez si su SHA-256 coincide (`SLINK_V1_SHA`); demo por marca `class="cabecera"`.

## Carta «Solicitud link» tal cual el Word y firmada por el módulo de firma (v2.2.92, 28/10/2026)
- John (28/10): NO modificar el membrete ni el pie de la plantilla Word; adaptarlos tal cual a HTML/CSS (hoja Carta 816×1056 px: márgenes 3/3/3/3,5 cm, borde 1 pt #002B6A con sombra a 24 pt, encabezado a 1,25 cm, logo 131×70 y QR 70×70, pie Century Gothic 10 pt #1F3864 con íconos y correo en azul). No añadir líneas ni adornos al membrete.
- La firma debe ser la del módulo de firma, no una imagen: la plantilla solo deja el espacio `.espacio-firma` (250×104 pt); al enviar, `slinkLetterPdf` (app.js) genera el PDF (`JuanmaHtmlTemplate.toPdfSpot`, devuelve la posición del espacio) y `POST /mail` con `letter.pdf_base64` + `stamp_pos` hace que `issueLetterSignature` (src/esign.js) cree la solicitud completada (método `plataforma`) y `ensureSignedPdf` estampe con el mismo código del módulo. El PDF firmado va adjunto y se verifica por código o por archivo.
