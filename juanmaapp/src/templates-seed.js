// Starter document templates. Variables use {{group.field}}; anything the
// case does not provide is left as **[FILL: …]** for the attorney to complete.
// Legal references are limited to well-established provisions; everything
// case-specific is left for the attorney.

export const DOC_CATEGORIES = ["Contrato", "Poder", "Derecho de petición", "Demanda", "Tutela", "Recurso", "Memorial", "Otro"];

export const VARIABLES = [
  ["cliente.nombre", "Nombre del cliente", "Cliente"],
  ["cliente.tipo_documento", "Tipo de documento", "Cliente"],
  ["cliente.documento", "Número de documento", "Cliente"],
  ["cliente.correo", "Correo del cliente", "Cliente"],
  ["cliente.telefono", "Teléfono del cliente", "Cliente"],
  ["cliente.direccion", "Dirección del cliente", "Cliente"],
  ["cliente.ciudad", "Ciudad del cliente", "Cliente"],
  ["cliente.departamento", "Departamento del cliente", "Cliente"],
  ["expediente.radicado", "Radicado", "Expediente"],
  ["expediente.tipo_proceso", "Tipo de proceso", "Expediente"],
  ["expediente.subproceso", "Subproceso", "Expediente"],
  ["expediente.asunto", "Asunto", "Expediente"],
  ["expediente.contraparte", "Contraparte / entidad", "Expediente"],
  ["expediente.hechos", "Hechos", "Expediente"],
  ["expediente.despacho", "Despacho", "Expediente"],
  ["expediente.correo_despacho", "Correo del despacho", "Expediente"],
  ["expediente.area", "Área", "Expediente"],
  ["expediente.ciudad", "Ciudad del proceso", "Expediente"],
  ["expediente.departamento", "Departamento del proceso", "Expediente"],
  ["abogado.nombre", "Nombre del abogado responsable", "Abogado"],
  ["abogado.tarjeta_profesional", "Tarjeta profesional", "Abogado"],
  ["abogado.correo", "Correo del abogado", "Abogado"],
  ["abogado.telefono", "Teléfono del abogado", "Abogado"],
  ["oficina.nombre", "Oficina", "Oficina"],
  ["oficina.ciudad", "Ciudad de la oficina", "Oficina"],
  ["oficina.direccion", "Dirección de la oficina", "Oficina"],
  ["oficina.telefono", "Teléfono de la oficina", "Oficina"],
  ["oficina.correo", "Correo de la oficina", "Oficina"],
  ["fecha.hoy", "Fecha de hoy (14 de octubre de 2026)", "Fecha"],
  ["fecha.ciudad_y_fecha", "Ciudad y fecha (Ibagué, 14 de octubre de 2026)", "Fecha"],
].map(([key, label, group]) => ({ key, label, group }));

const FOOTER = "\n\n---\n\n*Borrador generado con JuanMaApp a partir de una plantilla. Revíselo y ajústelo antes de firmarlo o radicarlo.*";

export const SEED_TEMPLATES = [
  {
    name: "Contrato de prestación de servicios profesionales de abogado",
    category: "Contrato",
    description: "Honorarios, alcance del mandato, obligaciones de las partes y terminación.",
    body: `# CONTRATO DE PRESTACIÓN DE SERVICIOS PROFESIONALES DE ABOGADO

Entre **{{cliente.nombre}}**, identificado(a) con {{cliente.tipo_documento}} No. {{cliente.documento}}, domiciliado(a) en {{cliente.ciudad}}, quien en adelante se denomina **EL CLIENTE**, y **{{abogado.nombre}}**, abogado(a) con tarjeta profesional No. {{abogado.tarjeta_profesional}}, quien actúa en nombre de la oficina **{{oficina.nombre}}** y en adelante se denomina **EL ABOGADO**, se celebra el presente contrato, que se rige por las siguientes cláusulas:

## PRIMERA. OBJETO

EL ABOGADO prestará sus servicios profesionales para atender el asunto: **{{expediente.asunto}}**, correspondiente a un proceso {{expediente.tipo_proceso}} — {{expediente.subproceso}}, en contra de {{expediente.contraparte}}.

## SEGUNDA. ALCANCE

El servicio comprende el estudio del caso, la elaboración y radicación de los escritos necesarios, la asistencia a las audiencias y la vigilancia del proceso hasta **[FILL: Etapa hasta la que se presta el servicio]**. No incluye **[FILL: Actuaciones excluidas]**.

## TERCERA. HONORARIOS

EL CLIENTE pagará a EL ABOGADO:

1. Una suma fija de **[FILL: Valor en pesos]** pagadera así: **[FILL: Forma y fechas de pago]**.
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

Señor(a)
**{{expediente.despacho}}**
{{expediente.ciudad}}
E. S. D.

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

Señores
**{{expediente.contraparte}}**
**[FILL: Dirección o correo de radicación de la entidad]**

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
