// Starter document templates. Variables use {{group.field}}; anything the
// case does not provide is left as **[FILL: …]** for the attorney to complete.
// Legal references are limited to well-established provisions; everything
// case-specific is left for the attorney.

export const DOC_CATEGORIES = ["Contrato", "Poder", "Autorización", "Derecho de petición", "Demanda", "Tutela", "Recurso", "Memorial", "Otro"];

export const VARIABLES = [
  ["cliente.nombre", "Nombre del cliente", "Cliente"],
  ["cliente.tipo_documento", "Tipo de documento", "Cliente"],
  ["cliente.documento", "Número de documento", "Cliente"],
  ["cliente.correo", "Correo del cliente", "Cliente"],
  ["cliente.telefono", "Teléfono del cliente", "Cliente"],
  ["cliente.direccion", "Dirección del cliente", "Cliente"],
  ["cliente.ciudad", "Ciudad del cliente", "Cliente"],
  ["cliente.departamento", "Departamento del cliente", "Cliente"],
  ["cliente.expedicion", "Lugar de expedición de la cédula, ej. Ibagué (Tolima)", "Cliente"],
  ["cliente.expedicion_ciudad", "Ciudad de expedición de la cédula", "Cliente"],
  ["cliente.expedicion_departamento", "Departamento de expedición de la cédula", "Cliente"],
  ["cliente.genero", "Género del cliente (Hombre o Mujer)", "Cliente"],
  ["expediente.clase_proceso", "Clase de proceso del expediente (vacía en procesos penales)", "Expediente"],
  ["expediente.radicacion", "«Radicación No. …» del expediente (vacía en procesos penales)", "Expediente"],
  ["expediente.proceso_linea", "«Proceso … Radicación No. …» (vacía en procesos penales)", "Expediente"],
  ["cliente.suscrito", "«el suscrito» o «la suscrita» según el género", "Género del cliente"],
  ["cliente.identificado", "«identificado» o «identificada» según el género", "Género del cliente"],
  ["cliente.domiciliado", "«domiciliado» o «domiciliada» según el género", "Género del cliente"],
  ["cliente.el", "«el» o «la» según el género", "Género del cliente"],
  ["cliente.senor", "«señor» o «señora» según el género", "Género del cliente"],
  ["cliente.el_senor", "«el señor» o «la señora» según el género", "Género del cliente"],
  ["cliente.del_senor", "«del señor» o «de la señora» según el género", "Género del cliente"],
  ["expediente.carpeta", "Número de carpeta (y del contrato)", "Expediente"],
  ["expediente.radicado", "Radicado", "Expediente"],
  ["expediente.numero", "Número de expediente", "Expediente"],
  ["expediente.tipo_proceso", "Tipo de proceso", "Expediente"],
  ["expediente.subproceso", "Subproceso", "Expediente"],
  ["expediente.asunto", "Asunto", "Expediente"],
  ["expediente.contraparte", "Contraparte / entidad", "Expediente"],
  ["expediente.hechos", "Hechos", "Expediente"],
  ["expediente.despacho", "Despacho", "Expediente"],
  ["expediente.juez", "Juez del despacho", "Expediente"],
  ["expediente.correo_despacho", "Correo del despacho", "Expediente"],
  ["expediente.area", "Área", "Expediente"],
  ["expediente.ciudad", "Ciudad del proceso", "Expediente"],
  ["expediente.departamento", "Departamento del proceso", "Expediente"],
  ["destinatario.bloque", "Destinatario completo (Señor(a), nombre, cargo, entidad, ciudad)", "Destinatario"],
  ["destinatario.tratamiento", "Tratamiento (Señor(a), Doctor(a)…)", "Destinatario"],
  ["destinatario.nombre", "Nombre y apellido del funcionario", "Destinatario"],
  ["destinatario.cargo", "Cargo del funcionario (Juez, Magistrado(a) ponente…)", "Destinatario"],
  ["destinatario.entidad", "Entidad o despacho destinatario", "Destinatario"],
  ["destinatario.direccion", "Dirección del destinatario", "Destinatario"],
  ["destinatario.ciudad", "Ciudad del destinatario", "Destinatario"],
  ["destinatario.correo", "Correo del destinatario", "Destinatario"],
  ["abogado.nombre", "Nombre del abogado responsable", "Abogado"],
  ["abogado.tarjeta_profesional", "Tarjeta profesional", "Abogado"],
  ["abogado.correo", "Correo del abogado", "Abogado"],
  ["abogado.telefono", "Teléfono del abogado", "Abogado"],
  ["oficina.nombre", "Oficina", "Oficina"],
  ["oficina.ciudad", "Ciudad de la oficina", "Oficina"],
  ["oficina.direccion", "Dirección de la oficina", "Oficina"],
  ["oficina.telefono", "Teléfono de la oficina", "Oficina"],
  ["oficina.correo", "Correo de la oficina", "Oficina"],
  ["honorarios.valor", "Valor de los honorarios ($)", "Honorarios"],
  ["honorarios.valor_letras", "Valor de los honorarios en letras", "Honorarios"],
  ["honorarios.forma_pago", "Forma de pago (cuotas y fechas)", "Honorarios"],
  ["honorarios.cuotas", "Número de cuotas", "Honorarios"],
  ["honorarios.pagado", "Valor ya pagado", "Honorarios"],
  ["honorarios.saldo", "Saldo por pagar", "Honorarios"],
  ["honorarios.modalidad", "Modalidad de honorarios (marque Honorarios, Cuota de litis o Mixto y escriba los valores)", "Honorarios"],
  ["honorarios.fijo", "Honorarios fijos en número y letras (según la casilla)", "Honorarios"],
  ["honorarios.litis_valor", "Cuota de litis en pesos, en número y letras (según la casilla)", "Honorarios"],
  ["honorarios.litis_porcentaje", "Cuota de litis en porcentaje, en número y letras (según la casilla)", "Honorarios"],
  ["OBJETOS_CONTRACTUALES", "Objetos contractuales", "Contrato"],
  ["fecha.hoy", "Fecha de hoy (14 de octubre de 2026)", "Fecha"],
  ["fecha.ciudad_y_fecha", "Ciudad y fecha (Ibagué, 14 de octubre de 2026)", "Fecha"],
].map(([key, label, group]) => ({ key, label, group }));

const FOOTER = "\n\n---\n\n*Borrador generado con TecjuridicosApp a partir de una plantilla. Revíselo y ajústelo antes de firmarlo o radicarlo.*";

export const SEED_TEMPLATES = [
  {
    name: "Autorización para consulta y reporte en centrales de riesgo",
    category: "Autorización",
    description: "Habeas data financiero (Ley 1266 de 2008, modificada por la Ley 2157 de 2021) y datos personales (Ley 1581 de 2012).",
    body: `# AUTORIZACIÓN PARA LA CONSULTA, REPORTE Y TRATAMIENTO DE INFORMACIÓN EN CENTRALES DE RIESGO

{{fecha.ciudad_y_fecha}}

Yo, **{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. **{{cliente.documento}}**, con domicilio en {{cliente.direccion}}, {{cliente.ciudad}}, correo electrónico {{cliente.correo}} y teléfono {{cliente.telefono}}, en adelante **EL TITULAR**, actuando de manera libre, previa, expresa e informada, autorizo a **Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4, o a quien represente sus derechos u ostente en el futuro la calidad de acreedor, en adelante **EL RESPONSABLE**, para:

1. **Consultar** en cualquier tiempo, en DataCrédito Experian, TransUnion (CIFIN) y en cualquier otro operador de bancos de datos de información financiera, crediticia, comercial y de servicios, la información sobre mi comportamiento crediticio, financiero y comercial, con el fin de analizar y evaluar la relación contractual y de servicios profesionales con EL RESPONSABLE.
2. **Reportar** a dichos operadores el nacimiento, modificación, extinción y cumplimiento o incumplimiento de las obligaciones que contraiga con EL RESPONSABLE, incluidas las derivadas del contrato de prestación de servicios profesionales N.º **{{expediente.carpeta}}**.
3. **Procesar, solicitar y divulgar** dicha información a otras entidades que tengan las mismas finalidades, en los términos de la ley.

## DERECHOS DEL TITULAR

Declaro que conozco que:

- La permanencia de la información negativa en las bases de datos se rige por la Ley 1266 de 2008, modificada por la Ley 2157 de 2021.
- Antes de cualquier reporte negativo, EL RESPONSABLE me enviará una **comunicación previa** a la dirección física, al correo electrónico o al teléfono aquí indicados, con al menos veinte (20) días calendario de anticipación, para que pueda pagar o controvertir la obligación.
- Puedo conocer, actualizar, rectificar y solicitar la supresión de mis datos, y presentar consultas y reclamos ante EL RESPONSABLE, ante el operador de la información y ante la Superintendencia de Industria y Comercio.
- Los datos personales que entrego serán tratados conforme a la Ley 1581 de 2012 y a la política de tratamiento de datos de EL RESPONSABLE, para la ejecución de la relación contractual, la gestión de cobro y las finalidades aquí descritas.

## VIGENCIA

Esta autorización estará vigente mientras subsista cualquier relación contractual u obligación a mi cargo con EL RESPONSABLE y durante el tiempo de permanencia de la información que establece la ley.

Firma:

____________________________________
**{{cliente.nombre}}**
{{cliente.tipo_documento}} No. {{cliente.documento}}
Huella: [FILL: Huella del índice derecho, si se firma en físico]` + FOOTER,
  },
  {
    name: "Autorización para el tratamiento de datos personales",
    category: "Autorización",
    description: "Ley 1581 de 2012 y Decreto 1074 de 2015: cada autorización por separado (datos, sensibles, privacidad, cookies, centrales de riesgo y comunicaciones), para firmar en papel.",
    body: `# AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS PERSONALES

{{fecha.ciudad_y_fecha}}

Yo, **{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. **{{cliente.documento}}**, con domicilio en {{cliente.direccion}}, {{cliente.ciudad}}, correo electrónico {{cliente.correo}} y teléfono {{cliente.telefono}}, en calidad de titular de los datos, declaro que **Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4, en adelante **EL RESPONSABLE**, me informó de manera previa, expresa y clara el Aviso de privacidad y la Política de tratamiento de datos personales, y respondo **por separado** cada una de las siguientes autorizaciones, marcando SÍ o NO:

| Autorización | SÍ | NO |
|---|---|---|
| 1. **Tratamiento de datos personales** para prestar los servicios jurídicos, llevar mi expediente, consultar mis procesos, ejecutar el contrato, registrar pagos y cumplir obligaciones legales. | ☐ | ☐ |
| 2. **Datos sensibles** (salud, historia clínica, dictámenes, vida familiar u otros) estrictamente necesarios para mi caso. Sé que esta autorización es **facultativa** y que no estoy obligado(a) a darla. | ☐ | ☐ |
| 3. **Política de privacidad**, incluida la evidencia técnica (fecha, hora, IP y navegador) que se registra cuando uso las páginas de EL RESPONSABLE. | ☐ | ☐ |
| 4. **Política de cookies** de la aplicación y sus páginas públicas (solo cookies técnicas, sin publicidad ni analítica). | ☐ | ☐ |
| 5. **Centrales de riesgo**: consulta de mi información, reporte del cumplimiento o incumplimiento de mis obligaciones, previa comunicación con veinte (20) días calendario de anticipación, y su actualización (Ley 1266 de 2008, modificada por la Ley 2157 de 2021). | ☐ | ☐ |
| 6. **Comunicaciones** por correo electrónico, WhatsApp y llamada sobre mi caso y mis pagos, en los horarios de la Ley 2300 de 2023. | ☐ | ☐ |

## DERECHOS DEL TITULAR

Conozco que, conforme al artículo 8 de la Ley 1581 de 2012, puedo conocer, actualizar, rectificar y suprimir mis datos; pedir prueba de esta autorización; ser informado(a) del uso de mis datos; revocar cualquiera de estas autorizaciones cuando no exista un deber legal o contractual de conservarlos; y presentar quejas ante la Superintendencia de Industria y Comercio después de agotar el trámite ante EL RESPONSABLE, escribiendo a {{oficina.correo}} o en {{oficina.direccion}}, {{oficina.ciudad}}.

La información que entrego está amparada por el secreto profesional del abogado (artículo 74 de la Constitución y numeral 9 del artículo 28 de la Ley 1123 de 2007). EL RESPONSABLE conservará la prueba de esta autorización mientras trate mis datos.

Firma:

____________________________________
**{{cliente.nombre}}**
{{cliente.tipo_documento}} No. {{cliente.documento}}
Huella: [FILL: Huella del índice derecho, si se firma en físico]` + FOOTER,
  },
  {
    name: "Acuerdo de confidencialidad y tratamiento de datos (funcionarios y contratistas)",
    category: "Contrato",
    description: "Secreto profesional (Ley 1123 de 2007) y deberes del encargado (Ley 1581 de 2012) para quien accede a la información de los clientes.",
    body: `# ACUERDO DE CONFIDENCIALIDAD Y TRATAMIENTO DE DATOS PERSONALES

{{fecha.ciudad_y_fecha}}

Entre **Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4, en adelante **LA FIRMA**, y **[FILL: Nombre completo del funcionario o contratista]**, identificado(a) con cédula de ciudadanía No. **[FILL: Número de documento]**, que se desempeña como **[FILL: Cargo u objeto del contrato]**, en adelante **EL RECEPTOR**, se celebra el presente acuerdo:

## PRIMERA. Información confidencial

Es confidencial toda la información de clientes, contrapartes y procesos a la que EL RECEPTOR acceda por cualquier medio, incluida TecjuridicosApp: datos personales, hechos, estrategias, documentos, honorarios, pagos y credenciales de acceso.

## SEGUNDA. Obligaciones

EL RECEPTOR se obliga a:

1. Guardar el secreto profesional y la reserva de la información, aun después de terminada su relación con LA FIRMA (artículo 74 de la Constitución y Ley 1123 de 2007).
2. Usar la información solo para las labores que LA FIRMA le asigne y conforme a la Política de tratamiento de datos personales.
3. No copiar, extraer, reenviar ni divulgar información fuera de lo que exige cada encargo, ni usar correos o dispositivos personales no autorizados para ello.
4. Mantener en secreto su usuario y contraseña, no compartir su cuenta y cerrar sesión en equipos compartidos.
5. Informar de inmediato a LA FIRMA cualquier pérdida, acceso indebido o incidente de seguridad.
6. Devolver o destruir la información en su poder al terminar la relación.

## TERCERA. Registro de actividad

EL RECEPTOR conoce que TecjuridicosApp registra en una bitácora cada cambio que hace, con fecha, hora, dirección IP y dispositivo, y lo autoriza para fines de seguridad y control.

## CUARTA. Incumplimiento

El incumplimiento de este acuerdo es falta grave y da lugar a las acciones laborales, contractuales, disciplinarias, civiles y penales que correspondan, sin perjuicio de la indemnización de los perjuicios causados.

## QUINTA. Vigencia

Este acuerdo rige desde su firma y sus obligaciones de confidencialidad no terminan con la relación.

Firmas:

____________________________________
**LA FIRMA**
{{abogado.nombre}}

____________________________________
**EL RECEPTOR**
[FILL: Nombre completo]
C.C. [FILL: Número de documento]` + FOOTER,
  },
  {
    name: "Contrato de prestación de servicios profesionales de abogado",
    category: "Contrato",
    description: "Honorarios, alcance del mandato, obligaciones de las partes y terminación.",
    body: `# CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO N.º {{expediente.carpeta}}

Entre **{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}, domiciliado(a) en {{cliente.ciudad}}, quien en adelante se denomina **EL CLIENTE**, y **{{abogado.nombre}}**, abogado(a) con tarjeta profesional No. {{abogado.tarjeta_profesional}}, quien actúa en nombre de **Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4, oficina de {{oficina.nombre}}, y en adelante se denomina **EL ABOGADO**, se celebra el presente contrato, que se rige por las siguientes cláusulas:

## PRIMERA. OBJETO

EL ABOGADO prestará sus servicios profesionales para atender el asunto: **{{expediente.asunto}}**, correspondiente a un proceso {{expediente.tipo_proceso}} — {{expediente.subproceso}}, en contra de {{expediente.contraparte}}.

## SEGUNDA. ALCANCE

El servicio comprende el estudio del caso, la elaboración y radicación de los escritos necesarios, la asistencia a las audiencias y la vigilancia del proceso hasta **[FILL: Etapa hasta la que se presta el servicio]**. No incluye **[FILL: Actuaciones excluidas]**.

## TERCERA. HONORARIOS

EL CLIENTE pagará a EL ABOGADO:

1. Una suma fija de **{{honorarios.valor}}** ({{honorarios.valor_letras}}), pagadera así: **{{honorarios.forma_pago}}**.
2. Un porcentaje del **[FILL: Porcentaje]%** sobre lo que efectivamente se obtenga a favor de EL CLIENTE, pagadero cuando se reciba.

Los gastos del proceso (copias, notificaciones, peritajes, pólizas) corren por cuenta de EL CLIENTE.

## CUARTA. OBLIGACIONES DE EL ABOGADO

Atender el asunto con diligencia, informar a EL CLIENTE sobre el estado del proceso cuando lo solicite y guardar reserva sobre la información recibida.

## QUINTA. OBLIGACIONES DE EL CLIENTE

Entregar la información y los documentos completos y veraces, pagar los honorarios y gastos en las fechas acordadas y comunicar cualquier cambio de datos de contacto.

## SEXTA. TERMINACIÓN

El contrato termina por cumplimiento del objeto, por mutuo acuerdo o por decisión de cualquiera de las partes con aviso escrito de **[FILL: Días de aviso]** días. Si EL CLIENTE revoca el poder sin justa causa, pagará los honorarios causados hasta esa fecha.

## SÉPTIMA. DATOS PERSONALES

EL CLIENTE autoriza el tratamiento de sus datos personales para la ejecución de este contrato, conforme a la política de tratamiento de datos de la oficina.

## OCTAVA. NOTIFICACIONES

EL CLIENTE: {{cliente.direccion}}, {{cliente.ciudad}} · {{cliente.correo}} · {{cliente.telefono}}
EL ABOGADO: {{oficina.direccion}}, {{oficina.ciudad}} · {{abogado.correo}} · {{oficina.telefono}}

Se firma en {{fecha.ciudad_y_fecha}}.

_______________________________
**{{cliente.nombre}}**
{{cliente.tipo_documento}} {{cliente.documento}}
EL CLIENTE

_______________________________
**{{abogado.nombre}}**
T.P. {{abogado.tarjeta_profesional}}
EL ABOGADO${FOOTER}`,
  },
  {
    name: "Poder especial",
    category: "Poder",
    description: "Poder para iniciar y llevar hasta su terminación un proceso, con facultades expresas.",
    body: `{{fecha.ciudad_y_fecha}}

{{destinatario.bloque}}

**Referencia:** Proceso {{expediente.tipo_proceso}} — {{expediente.subproceso}}
**Demandante:** {{cliente.nombre}}
**Demandado:** {{expediente.contraparte}}
**Radicado:** {{expediente.radicado}}

**{{cliente.nombre}}**, mayor de edad, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}, domiciliado(a) en {{cliente.ciudad}}, con correo electrónico {{cliente.correo}}, otorgo **poder especial, amplio y suficiente** a **{{abogado.nombre}}**, abogado(a) titulado(a) con tarjeta profesional No. {{abogado.tarjeta_profesional}} del Consejo Superior de la Judicatura y correo electrónico {{abogado.correo}}, para que en mi nombre y representación inicie y lleve hasta su terminación el proceso de la referencia en contra de **{{expediente.contraparte}}**, con el fin de: **[FILL: Objeto del poder: qué se pretende]**.

Mi apoderado(a) queda facultado(a) para presentar la demanda y sus reformas, recibir, transigir, conciliar, desistir, sustituir, reasumir, interponer recursos, solicitar y aportar pruebas, y en general para realizar todas las actuaciones necesarias para el cumplimiento de este mandato, en los términos del artículo 74 del Código General del Proceso. **[FILL: Indique si se excluye alguna facultad, por ejemplo recibir]**

Este poder se otorga mediante mensaje de datos conforme a la Ley 2213 de 2022. El correo electrónico de mi apoderado(a), inscrito en el Registro Nacional de Abogados, es {{abogado.correo}}.

Atentamente,

_______________________________
**{{cliente.nombre}}**
{{cliente.tipo_documento}} {{cliente.documento}}

Acepto,

_______________________________
**{{abogado.nombre}}**
T.P. {{abogado.tarjeta_profesional}} del C. S. de la J.${FOOTER}`,
  },
  {
    name: "Derecho de petición",
    category: "Derecho de petición",
    description: "Petición respetuosa ante una entidad pública o privada, con hechos, peticiones y notificaciones.",
    body: `{{fecha.ciudad_y_fecha}}

{{destinatario.bloque}}

**Asunto:** Derecho de petición — {{expediente.asunto}}

**{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}, en ejercicio del derecho fundamental de petición consagrado en el artículo 23 de la Constitución Política y regulado por la Ley 1755 de 2015, respetuosamente presento la siguiente petición:

## HECHOS

{{expediente.hechos}}

## PETICIONES

1. **[FILL: Primera petición, concreta]**
2. **[FILL: Segunda petición, si la hay]**

## FUNDAMENTOS DE DERECHO

Artículo 23 de la Constitución Política y Ley 1755 de 2015. **[FILL: Normas especiales aplicables al caso, verificadas por el abogado]**

## ANEXOS

1. Copia del documento de identidad.
2. **[FILL: Documentos que soportan la petición]**

## NOTIFICACIONES

Recibiré respuesta en {{cliente.direccion}}, {{cliente.ciudad}}, y en el correo electrónico {{cliente.correo}}.

Atentamente,

_______________________________
**{{cliente.nombre}}**
{{cliente.tipo_documento}} {{cliente.documento}}
{{cliente.telefono}}${FOOTER}`,
  },
  {
    name: "Demanda ordinaria laboral de primera instancia",
    category: "Demanda",
    description: "Estructura de demanda laboral: partes, pretensiones, hechos, fundamentos, pruebas, cuantía, competencia y notificaciones.",
    body: `Señor(a)
**JUEZ LABORAL DEL CIRCUITO DE {{expediente.ciudad}} (REPARTO)**
E. S. D.

**Referencia:** Demanda ordinaria laboral de primera instancia
**Demandante:** {{cliente.nombre}}
**Demandado:** {{expediente.contraparte}}

**{{abogado.nombre}}**, abogado(a) con tarjeta profesional No. {{abogado.tarjeta_profesional}}, en calidad de apoderado(a) de **{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}, según el poder que adjunto, presento demanda ordinaria laboral de primera instancia en contra de **{{expediente.contraparte}}**, identificada con **[FILL: NIT o documento del demandado]**, representada legalmente por **[FILL: Representante legal]**, en los siguientes términos:

## I. PARTES

**Demandante:** {{cliente.nombre}}, {{cliente.tipo_documento}} {{cliente.documento}}, domiciliado(a) en {{cliente.ciudad}}.
**Demandado:** {{expediente.contraparte}}, domiciliado en **[FILL: Domicilio del demandado]**.

## II. PRETENSIONES

**Declarativas**

1. Que se declare que entre {{cliente.nombre}} y {{expediente.contraparte}} existió un contrato de trabajo **[FILL: Modalidad]** entre el **[FILL: Fecha de inicio]** y el **[FILL: Fecha de terminación]**.
2. **[FILL: Otras declaraciones]**

**De condena**

1. Que se condene a {{expediente.contraparte}} a pagar **[FILL: Conceptos y valores: cesantías, intereses, prima, vacaciones, indemnizaciones]**.
2. Que se condene en costas y agencias en derecho.

## III. HECHOS

{{expediente.hechos}}

**[FILL: Complete los hechos numerados, uno por cada circunstancia relevante]**

## IV. FUNDAMENTOS DE DERECHO

**[FILL: Normas sustantivas y procesales aplicables, verificadas por el abogado]**

## V. PRUEBAS

**Documentales:** **[FILL: Contrato, desprendibles de pago, carta de terminación, certificados]**
**Testimoniales:** **[FILL: Nombre, documento y dirección de cada testigo, y lo que declarará]**
**Interrogatorio de parte** al representante legal de la demandada.

## VI. CUANTÍA Y COMPETENCIA

La cuantía se estima en **[FILL: Valor]**. Es competente el juez laboral del circuito de {{expediente.ciudad}} por **[FILL: Factor de competencia: lugar de prestación del servicio o domicilio del demandado]**.

## VII. ANEXOS

Poder, documentos relacionados en pruebas, certificado de existencia y representación legal de la demandada y **[FILL: Otros anexos]**.

## VIII. NOTIFICACIONES

**Demandante:** {{cliente.direccion}}, {{cliente.ciudad}} · {{cliente.correo}}
**Apoderado(a):** {{oficina.direccion}}, {{oficina.ciudad}} · {{abogado.correo}}
**Demandado:** **[FILL: Dirección física y correo de notificaciones judiciales del demandado]**

Atentamente,

_______________________________
**{{abogado.nombre}}**
T.P. {{abogado.tarjeta_profesional}} del C. S. de la J.${FOOTER}`,
  },
];

// The starter fee clause before change 36, and its replacement: the fee comes from Pagos.
export const FEE_CLAUSE_OLD = "1. Una suma fija de **[FILL: Valor en pesos]** pagadera así: **[FILL: Forma y fechas de pago]**.";
export const FEE_CLAUSE_NEW = "1. Una suma fija de **{{honorarios.valor}}** ({{honorarios.valor_letras}}), pagadera así: **{{honorarios.forma_pago}}**.";

// Change 40: the starter contract carries the case's folder number.
export const CONTRACT_HEAD_OLD = "# CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO\n";
export const CONTRACT_HEAD_NEW = "# CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO N.º {{expediente.carpeta}}\n";

// Version 2.4: the firm is named by its legal name and NIT in the starter templates.
export const FIRM_FIXES = [
  ["**{{oficina.nombre}}** (TEC Jurídicos),", "**Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4,"],
  ["| 5. **Comunicaciones**", "| 5. **Centrales de riesgo**: consulta de mi información, reporte del cumplimiento o incumplimiento de mis obligaciones, previa comunicación con veinte (20) días calendario de anticipación, y su actualización (Ley 1266 de 2008, modificada por la Ley 2157 de 2021). | ☐ | ☐ |\n| 6. **Comunicaciones**"],
  ["quien actúa en nombre de la oficina **{{oficina.nombre}}** y en adelante", "quien actúa en nombre de **Tecjuridicos S.A.S.** (TEC Jurídicos), NIT 901.269.714-4, oficina de {{oficina.nombre}}, y en adelante"],
  // Version 2.27: the petition and the power of attorney open with the named official (Señor(a), name, title, entity).
  ["Señores\n**{{expediente.contraparte}}**\n**[FILL: Dirección o correo de radicación de la entidad]**", "{{destinatario.bloque}}\n**[FILL: Dirección o correo de radicación de la entidad]**"],
  ["Señor(a)\n**{{expediente.despacho}}**\n{{expediente.ciudad}}\nE. S. D.\n\n**Referencia:**", "{{destinatario.bloque}}\n\n**Referencia:**"],
  // Version 2.30: the addressee block carries the entity's address and e-mail.
  ["{{destinatario.bloque}}\n**[FILL: Dirección o correo de radicación de la entidad]**", "{{destinatario.bloque}}"],
  // Version 2.50: the client's words follow the client's gender (the lawyer's «identificado(a)» and the funcionario's stay as they are).
  ["{{cliente.nombre}}**, identificado(a)", "{{cliente.nombre}}**, {{cliente.identificado}}"],
  ["{{cliente.nombre}}**, mayor de edad, identificado(a)", "{{cliente.nombre}}**, mayor de edad, {{cliente.identificado}}"],
  ["{{cliente.documento}}, domiciliado(a)", "{{cliente.documento}}, {{cliente.domiciliado}}"],
  // Version 2.52: poder and petición name the class of process and the radicado of the case; nothing for a criminal case.
  ["**Referencia:** Proceso {{expediente.tipo_proceso}} — {{expediente.subproceso}}\n", "{{#expediente.proceso_linea}}**Referencia:** {{expediente.proceso_linea}}\n{{/expediente.proceso_linea}}"],
  ["**Demandado:** {{expediente.contraparte}}\n**Radicado:** {{expediente.radicado}}\n", "**Demandado:** {{expediente.contraparte}}\n"],
  ["**Asunto:** Derecho de petición — {{expediente.asunto}}\n\n", "**Asunto:** Derecho de petición — {{expediente.asunto}}\n\n{{#expediente.proceso_linea}}**Referencia:** {{expediente.proceso_linea}}\n\n{{/expediente.proceso_linea}}"],
];