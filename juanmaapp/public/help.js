// In-app help: a "?" button on every module explains what it does, and every
// field shows an example (placeholder) and a writing tip while it has focus.
(() => {
  const MODULES = {
    inicio: ["Panel general", "Resumen del día: procesos activos, clientes, vencimientos de los próximos 7 días, audiencias de los próximos 14 días y actuaciones nuevas de la Rama Judicial.",
      ["Toque cualquier recuadro para ir al módulo correspondiente.", "Las cifras salen solo de los datos guardados; si no hay datos, el recuadro queda en cero."]],
    clientes: ["Clientes", "Registro de las personas naturales y jurídicas que representa la firma, con sus datos de contacto y sus expedientes.",
      ["Persona natural: nombres y apellidos por separado; se corrigen solos a mayúscula inicial (JOHN → John).", "Persona jurídica: razón social, NIT con dígito de verificación y representante legal.", "Busque por nombre o número de documento en la casilla superior.", "Escriba el documento sin puntos ni espacios.",
        "Autorizaciones de datos (en la ficha del cliente): envíe el enlace por correo o WhatsApp, o use «Firmar en la oficina». Cada autorización (datos, sensibles, privacidad, cookies, centrales de riesgo y comunicaciones) se responde por separado; también al firmar por enlace un documento y queda el soporte con fecha, hora y medio; «Constancia PDF» lo descarga."]],
    expedientes: ["Expedientes", "Cada proceso o asunto de un cliente: tipo y subproceso, calidad del cliente (demandante, demandado, ejecutante…), estado, despacho, radicado y responsable.",
      ["Funcionario responsable: en la pantalla del expediente, recuadro «Funcionario responsable», elija el funcionario y toque «Asignar como responsable»; con «+ Asignarle una tarea» le deja una tarea, audiencia o término y le llega el aviso.", "Filtre por departamento, ciudad o circuito, área y despacho: si marca Ibagué y Civil, ve los expedientes de los despachos civiles del circuito de Ibagué.", "El radicado de 23 dígitos permite consultar el proceso en la Rama Judicial.", "Estado: Activo, Archivo provisional o Archivo definitivo.", "Filtre por oficina o por tipo de proceso en la parte superior.", "La columna Carpeta muestra el número de carpeta física; búsquelo en la casilla «Buscar carpeta, cliente o radicado»."]],
    agenda: ["Agenda", "Audiencias, términos, tareas, recursos, requerimientos, peticiones y oficios de cada expediente, asignados a un funcionario con plazo y recordatorio.",
      ["Escriba el título con la norma o etapa: «Audiencia inicial art. 77 CPTSS».", "Al asignar a un funcionario, le llega el aviso en la campana con el enlace al expediente.",
        "Marque «Cumplida» cuando se cumpla: queda quién la cumplió y si fue a tiempo o con retraso.", "Oficios y peticiones: registre la fecha de entrega; al llegar la respuesta use «Respuesta». Si vence el plazo sin respuesta, se avisa.",
        "«Seguimiento por funcionario» muestra pendientes, vencidas y el porcentaje de cumplimiento de cada uno."]],
    bitacora: ["Bitácora", "Registro de auditoría: qué funcionario hizo cada cambio, con fecha y hora de Colombia, y si fue desde un celular, una tableta o un PC.",
      ["Filtre por fechas, funcionario, módulo o dispositivo, o busque un cliente, un radicado o un valor.", "«Qué cambió» muestra cada campo con el valor anterior (tachado) y el nuevo.",
        "En rojo: acciones sin permiso e ingresos fallidos.", "La bitácora no se puede editar ni borrar. Solo la ve quien tenga el permiso «Ve la bitácora» (por defecto, Gerencia).",
        "Cada expediente muestra sus propios cambios en Historial › «Cambios por funcionario»."]],
    consulta: ["Consulta de procesos", "Consulta en la Rama Judicial los expedientes con radicado y avisa de actuaciones nuevas (reportes a las 7, 13 y 17 h).",
      ["Requiere conexión a internet desde el servidor; en el enlace de prueba no está disponible.", "Solo se consultan expedientes con la casilla «Consultar automáticamente» marcada."]],
    despachos: ["Despachos judiciales", "Directorio de juzgados, tribunales y altas cortes con su correo, para elegirlos en los expedientes y en el correo certificado.",
      ["Cargue primero el directorio de correos de los juzgados (Excel o CSV) con las columnas Email, Nombre, Departamento, Ciudad y Corporación o Área. Volver a cargarlo no duplica: actualiza y no borra correos con celdas vacías.", "Filtre por departamento, ciudad o circuito y área: Civil muestra los civiles, Penal los penales y «Otros» todos los demás (Familia, Laboral, Administrativo…). Si una ciudad no tiene despachos de esa área, se muestran también los promiscuos y de pequeñas causas.", "Busque por nombre, correo o código del despacho.", "«Funcionarios por entidad»: guarde nombre, cargo y correo de quien recibe en cada entidad (Colpensiones, una EPS, la Alcaldía). Los correos, peticiones y plantillas dirigidos a esa entidad empiezan solos con «Señor(a) nombre, cargo, entidad»."]],
    borradores: ["Documentos", "Plantillas de la firma y borradores con NomosAI: poderes, demandas, derechos de petición, tutelas, contratos y más.",
      ["Cargue sus minutas de Word: la app encuentra los espacios en blanco (____, XXXX, [NOMBRE] o texto resaltado) y le sugiere qué dato del cliente va en cada uno.", "Elija un expediente para llenar los datos del cliente y del proceso automáticamente.", "Los datos que falten quedan marcados como [FILL: …] para completarlos antes de firmar.", "Revise siempre el borrador: NomosAI no inventa datos, pero un abogado debe aprobarlo."]],
    firmas: ["Firma electrónica", "Envía documentos (texto o PDF cargado) a firmar con enlace privado y código OTP por correo, SMS o WhatsApp, o firma presencial en pantalla. El PDF firmado lleva la estampa de cada firma donde usted elija y el certificado al final.",
      ["Elija para cada firmante por dónde recibe el código: correo o WhatsApp (WhatsApp necesita el servidor configurado).", "Elija la página y la posición de la estampa; «Página nueva al final» no tapa el texto.", "Marque «Notificar por correo» para que cada firmante reciba el documento firmado cuando todos firmen.", "Con «Verificar documento» (o la página pública verificar.html) se comprueba que un PDF es el firmado y no fue alterado: se compara su huella SHA-256 con la registrada; el código de verificación va al pie de cada página.", "En el enlace de prueba solo funciona la firma presencial."]],
    pagos: ["Pagos y cartera", "Cobros (honorarios, cuotas), recibos de caja, cartera por edades y recordatorios de pago a los clientes.",
      ["Cree el cobro con el concepto y las cuotas; luego registre cada pago como recibo.", "La cartera muestra lo vencido por días: 1–30, 31–60, 61–90 y más de 90.", "Configure los datos bancarios para que salgan en los recordatorios."]],
    correo: ["Correo con trazabilidad", "Envía memoriales y notificaciones y deja prueba de cada paso: aceptación del servidor de correo, cada apertura, cada descarga de anexos y el acuse de recibo, con fecha y hora exactas, IP y navegador.",
      ["La «Constancia PDF» consolida todo para el juez: huellas SHA-1, SHA-256, SHA-512 y SHA-3 del mensaje completo y de cada anexo, tamaños y la línea de tiempo.", "Para que cada descarga quede registrada, elija entregar los anexos «solo con enlace».", "Descargue el «Mensaje original (.eml)»: cualquiera puede recalcular sus huellas y comprobar que coinciden.", "Requiere el servidor de correo de la firma; en el enlace de prueba no se envía."]],
    chat: ["Chat del despacho", "Mensajes y videollamada entre los usuarios de la App: chats privados de dos personas, grupos y el canal General de todo el despacho.",
      ["Elija a una persona en «Personas» o use «+ Nuevo» para un chat o un grupo; el punto verde indica quién está conectado.", "Escriba @ y el nombre para mencionar: la persona recibe un aviso en la campana.", "El clip adjunta un archivo (hasta 5 MB) y el enlace (🔗) adjunta un cliente o expediente: al tocarlo se abre su ficha.", "Pase el cursor sobre su mensaje para editarlo o eliminarlo; los demás verán «editado» o «Mensaje eliminado».", "«Videollamada» abre la cámara y avisa a los demás; quien llega después pulsa «Unirse». Hasta 6 personas, con opción de compartir pantalla.", "Nadie ve las conversaciones de otros, ni siquiera Gerencia, y los mensajes no aparecen en la Bitácora."]],
    mony: ["Mony", "Asistente jurídico: consulta procesos en la Rama Judicial, calcula términos judiciales y prepara borradores con las plantillas. Solo lee; sus respuestas las revisa el abogado a cargo.",
      ["Pregunte con el radicado de 23 dígitos o el expediente: Mony consulta la Rama Judicial y no inventa datos; si no responde, se lo dice.", "Para un término indique la fecha de notificación y los días; Mony cuenta días hábiles con festivos y vacancia judicial y muestra los días excluidos.", "Cada pregunta gasta créditos de Anthropic: se ven en Configuración → Consumo de IA.", "En el enlace de prueba no funciona: abre la App del servidor."]],
    jurisprudencia: ["Jurisprudencia", "Búsqueda de sentencias solo en sitios oficiales (Corte Constitucional, Corte Suprema, Consejo de Estado) y verificación de citas.",
      ["Describa el problema jurídico con palabras clave: «estabilidad laboral reforzada debilidad manifiesta».", "Los botones gratis abren el buscador de cada Corte (la App copia su búsqueda para pegarla) o la sentencia de la Corte Constitucional, sin IA y sin costo.", "«Buscar con IA», «Analizar con IA» y «Revisar con IA» gastan créditos de Anthropic; una consulta repetida en 30 días sale gratis.", "«Detectar citas» es gratis: comprueba sin IA las sentencias de la Corte Constitucional y deja la revisión con IA para cuando usted la pida.", "Guarde las sentencias útiles y vincúlelas al expediente."]],
    importar: ["Importar desde Excel", "Carga clientes y expedientes desde un archivo de Excel (Access o el servidor de la firma), sin duplicar los que ya existen.",
      ["Arriba hay tres tarjetas (Clientes, Expedientes, Despachos): descargue la plantilla vacía o los datos actuales, edítelos en Excel y súbalos de nuevo; antes de importar se muestra un resumen.", "Al subir un Excel desde una tarjeta, usted asigna cada columna a un dato de ese módulo (o «No importar»); la App recuerda su elección para la próxima carga.", "En Clientes, las columnas «Departamento de expedición» y «Ciudad de expedición» cargan el lugar de expedición de la cédula; si no se reconocen, se avisa y se importa la fila sin ese dato.", "Revise la columna que la app asignó a cada campo antes de importar.", "Los radicados que no tienen 23 dígitos se guardan tal como vienen.", "Honorarios y pagos del archivo quedan como cobros y recibos."]],
    reportes: ["Reportes", "Informes de expedientes, agenda, actuaciones, cartera y recibos en Excel o PDF.",
      ["Elija el reporte, la oficina y el rango de fechas.", "Los reportes de pagos requieren el permiso de pagos."]],
    usuarios: ["Usuarios y oficinas", "Personas que usan la app, sus roles, oficinas y permisos.",
      ["Cada usuario ve solo las oficinas que tenga asignadas.", "Puede dar permisos específicos a un usuario en lugar de los de su rol.", "Al crear un usuario, marque «Enviar invitación por correo»: le llega un enlace para crear su propia contraseña (vence en 72 horas). También puede asignarle una contraseña (botón «Generar»): es temporal y se la pide cambiar al primer ingreso; entréguela en persona o por teléfono, nunca por correo.", "Solo Gerencia: «Ocultar» saca a un usuario de esta lista y todo lo que haga aparece como «Asistente». Para verlo otra vez use «Ver usuarios ocultos» y la contraseña de ocultos (la vista dura 15 minutos)."]],
    configuracion: ["Configuración", "Catálogo de tipos de proceso, subprocesos (dos niveles) y campos propios de cada uno.",
      ["Use nombres cortos: «Laboral», «Ordinario laboral de primera instancia».", "Los campos propios aparecen en el expediente según su subproceso.", "Solo Gerencia (el administrador) crea tipos de proceso, subprocesos y campos. Desde «Nuevo expediente» también puede crearlos con el botón «+ Nuevo» junto a Tipo de proceso y Subproceso."]],
  };

  // [example placeholder, writing tip]. Keys: "form.name", "name" or "#id".
  const FIELDS = {
    "#client-search": ["", "Escriba parte del nombre, apellido, razón social o número de documento."],
    "#login-email": ["usuario@tecjuridicos.com", "El correo con el que fue registrado."],
    "#setup-name": ["Ej. Juan Manuel Quiñones", "Nombre y apellidos de quien administra la app."],
    "#setup-email": ["gerencia@tecjuridicos.com", "Correo institucional de la firma."],
    "client.first_names": ["", "Solo los nombres. Ej. «María José». Se corrige a mayúscula inicial al salir."],
    "client.last_names": ["", "Primer y segundo apellido. Las partículas quedan en minúscula: «Torres de Cifuentes»."],
    "client.id_number": ["", "Solo números, sin puntos ni espacios."],
    "client.id_department": ["Escriba: C… Cundinamarca, Chocó", "Departamento donde se expidió la cédula. Al escribir una letra se filtran los departamentos que empiezan con ella; las tildes no importan. Opcional."],
    "client.id_city": ["Escriba: I… Ibagué", "Ciudad o municipio donde se expidió la cédula, dentro del departamento elegido. Si la elige primero, el departamento se llena solo. En los documentos: {{cliente.expedicion}} = «Ibagué (Tolima)»."],
    "client.affiliated": ["", "Marque la casilla si el cliente es afiliado. Es opcional y queda en su ficha."],
    "client.business_name": ["", "Razón social exacta como aparece en el certificado de Cámara de Comercio."],
    "client.nit": ["", "NIT con guion y dígito de verificación: 900123456-7."],
    "client.legal_rep": ["", "Nombre completo del representante legal según el certificado de existencia."],
    "client.email": ["cliente@correo.com", "Correo donde el cliente recibe notificaciones, recibos y recordatorios."],
    "client.phone": ["300 123 4567", "Celular con WhatsApp de preferencia. Escríbalo como quiera: queda 322 253 1327 (celular) o 608 261 4172 (fijo)."],
    "client.city": ["Escriba: I… Ibagué", "Elija de la lista o escríbala como quiera (IBAGUE → Ibagué): queda el municipio oficial (DIVIPOLA) con su tilde."],
    "client.address": ["Ej. Calle 10 # 3-45, barrio Centro", "Dirección de notificación física. Se corrige al salir: tipos de vía y lugares completos y con mayúscula inicial (CLLE 5 no 12b-30 br la pola → Calle 5 No. 12B-30 Barrio La Pola)."],
    "client.notes": ["Ej. Prefiere contacto por WhatsApp en la tarde", "Datos útiles para atender al cliente; no escriba información reservada del proceso."],
    "case.title": ["", "Qué se busca en pocas palabras: «Reconocimiento de pensión de vejez»."],
    "case.radicado": ["", "Los 23 dígitos del radicado judicial; puede pegarlo con guiones o espacios."],
    "case.client_role": ["", "Posición del cliente en el proceso: demandante, demandado, ejecutante, víctima…"],
    "case.ad_litem": ["", "Marque la casilla si la firma actúa como curadora ad-litem en este proceso. En Expedientes, «Solo curaduría ad-litem» lista esos procesos."],
    "case.counterparty": ["Ej. Colpensiones", "Nombre de la parte contraria o entidad accionada."],
    "case.facts": ["1. El 3 de marzo de 2024 el cliente…", "Hechos en orden cronológico, con fechas y cifras; NomosAI los usa para los borradores."],
    "case.court_search": ["", "Escriba ciudad y especialidad: «Ibagué laboral 3»."],
    "case.judge_name": ["Ana María Ruiz", "Al elegir el despacho la App sugiere el juez que registra la Rama Judicial para el radicado: toque «Usar este nombre» o escríbalo a mano."],
    "user.name": ["Ej. Laura Gómez Rojas", "Nombres y apellidos completos."],
    "user.email": ["nombre@tecjuridicos.com", "Correo de Microsoft 365 si va a entrar con Microsoft."],
    "user.password": ["Mínimo 10 caracteres", "Mezcle letras, números y signos. Puede dejarla vacía si entra con Microsoft."],
    "user.phone": ["300 123 4567", "Para avisos de agenda por WhatsApp."],
    "user.professional_card": ["Ej. 123456", "Número de tarjeta profesional del Consejo Superior de la Judicatura."],
    "office.name": ["Ej. Sede Ibagué", "Nombre corto con la ciudad."],
    "office.address": ["Ej. Carrera 3 # 12-30, oficina 401", ""],
    "office.phone": ["Ej. 608 261 0000", ""],
    "office.email": ["ibague@tecjuridicos.com", ""],
    "sign.title": ["Ej. Poder especial — proceso laboral", "Nombre con que el firmante verá el documento."],
    "inperson.typed_name": ["Ej. María José Torres", "Tal como aparece en el documento de identidad."],
    "inperson.id_number": ["Solo números", ""],
    "mail.cc": ["cliente@correo.com", "Varios correos separados por coma."],
    "mail.subject": ["Ej. Memorial radicado 73001310500120230012300", "Incluya el radicado para que el despacho lo ubique."],
    "mail.body": ["Señor Juez…", "Saludo, objeto del correo, anexos y firma del apoderado."],
    "template.name": ["Ej. Poder especial laboral", ""],
    "template.description": ["Ej. Poder para demanda ordinaria laboral", "Para qué sirve la plantilla."],
    "template.body": ["", "Use las variables entre llaves, por ejemplo {cliente_nombre} o {radicado}."],
    "task.notes": ["Ej. Llevar pruebas documentales y testigos", ""],
    "charge.notes": ["Ej. Pago acordado en contrato del 1 de octubre", ""],
    "charge.amount": ["", "Valor en pesos, sin puntos: se formatea solo."],
    "receipt.amount": ["", "Valor en pesos que efectivamente recibió."],
    "receipt.notes": ["", "Observaciones del pago que no van en el concepto."],
    "pay-settings.firm_name": ["Ej. TEC Jurídicos S.A.S.", "Aparece en el encabezado de los recibos."],
    "pay-settings.firm_nit": ["Ej. 900123456-7", ""],
    "password.current": ["", "La contraseña con la que entró hoy."],
    "password.next": ["Mínimo 10 caracteres", "Mezcle letras, números y signos."],
    fullName: ["Ej. María José Torres de Cifuentes", "Tal como aparece en el documento de identidad."],
    idNumber: ["Ej. CC 1110456789", "Tipo y número del documento."],
    address: ["Ej. Calle 10 # 3-45, Ibagué", "Dirección de notificación."],
    email: ["correo@ejemplo.com", ""],
    phone: ["300 123 4567", ""],
    department: ["Escriba: T… Tolima", "Elija de la lista."],
    city: ["Escriba: I… Ibagué", "Elija de la lista; la ciudad depende del departamento."],
    yearFrom: ["Ej. 2015", ""],
    yearTo: ["Ej. 2026", ""],
    notes: ["", "Información adicional, breve y sin datos reservados."],
    jurisdiction: ["", "País cuyas normas aplica el documento."],
    query: ["", "Use palabras clave del problema jurídico, no preguntas largas."],
  };

  const SELECT_TIPS = {
    office_id: "Oficina que lleva el asunto; define quién puede verlo.",
    assigned_user_id: "Funcionario (abogado o auxiliar) a cargo del expediente o de la tarea.",
    category_id: "Área del proceso: Laboral, Civil, Familia, Penal…",
    process_type_id: "Clase concreta de proceso dentro del tipo.",
    status: "Activo mientras haya trámite; Archivo provisional si está suspendido; Archivo definitivo si terminó; Pendiente Pago Sentencia si ya hay sentencia y se espera el pago.",
    affiliated: "Marque Sí si el cliente pertenece a un convenio o afiliación de la firma.",
    id_type: "Cédula de ciudadanía para colombianos mayores de edad.",
    client_id: "Escriba las primeras letras para saltar al cliente.",
    case_id: "Expediente al que se vincula el registro.",
    method: "Transferencia, consignación, efectivo, Bold…",
    every: "Cada cuánto vence la siguiente cuota.",
  };

  const TEXTUAL = /^(text|email|search|tel|url|number|password|)$/;
  const keyOf = (el) => {
    const form = el.closest("[data-form]")?.dataset.form;
    const out = [];
    if (el.id) out.push("#" + el.id);
    if (el.name && form) out.push(`${form}.${el.name}`);
    if (el.name) out.push(el.name);
    return out;
  };
  const lookup = (el) => {
    for (const k of keyOf(el)) if (FIELDS[k]) return FIELDS[k];
    if (el.tagName === "SELECT" && SELECT_TIPS[el.name]) return ["", SELECT_TIPS[el.name]];
    return null;
  };

  function applyPlaceholders(root = document) {
    for (const el of root.querySelectorAll("input, textarea")) {
      if (el.placeholder || el.readOnly || el.hidden) continue;
      if (el.tagName === "INPUT" && !TEXTUAL.test(el.type)) continue;
      const h = lookup(el);
      if (h?.[0]) el.placeholder = h[0];
    }
  }

  let tip = null;
  function showTip(el) {
    hideTip();
    const h = lookup(el);
    const text = h?.[1];
    if (!text) return;
    tip = document.createElement("small");
    tip.className = "field-tip";
    tip.setAttribute("role", "note");
    tip.textContent = "💡 " + text;
    const label = el.closest("label");
    (label || el).insertAdjacentElement(label ? "beforeend" : "afterend", tip);
  }
  function hideTip() { tip?.remove(); tip = null; }

  let dialog = null;
  function openHelp(view) {
    const [title, what, tips] = MODULES[view];
    if (!dialog) {
      dialog = document.createElement("dialog");
      dialog.className = "help-dialog";
      dialog.innerHTML = '<form method="dialog"><h3></h3><p class="help-what"></p><h4>Sugerencias</h4><ul></ul><div class="dialog-actions"><button class="primary" value="ok">Entendido</button></div></form>';
      document.body.append(dialog);
    }
    dialog.querySelector("h3").textContent = "¿Para qué sirve? · " + title;
    dialog.querySelector(".help-what").textContent = what;
    const ul = dialog.querySelector("ul");
    ul.replaceChildren(...tips.map((t) => Object.assign(document.createElement("li"), { textContent: t })));
    dialog.showModal();
  }

  function addButtons() {
    for (const view of Object.keys(MODULES)) {
      const h2 = document.querySelector(`#view-${view} h2`);
      if (!h2 || h2.parentElement.querySelector(".help-btn")) continue;
      // Headings whose text the app rewrites (the greeting) keep the button beside them.
      const beside = Boolean(h2.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "help-btn";
      b.textContent = "?";
      b.title = "¿Para qué sirve este módulo?";
      b.setAttribute("aria-label", "Ayuda: " + MODULES[view][0]);
      b.addEventListener("click", () => openHelp(view));
      if (beside) h2.insertAdjacentElement("afterend", b);
      else h2.append(b);
    }
  }

  function init() {
    addButtons();
    applyPlaceholders();
    document.addEventListener("focusin", (e) => {
      const el = e.target;
      if (el.matches?.("input, textarea, select") && !["hidden", "checkbox", "radio", "file", "button", "submit"].includes(el.type)) showTip(el);
    });
    // Removing the tip moves the controls below it up; doing it on blur would make a click on
    // "Guardar" land on empty space. Remove it once the click is over.
    document.addEventListener("focusout", () => {
      const shown = tip;
      setTimeout(() => { if (tip === shown) hideTip(); }, 250);
    });
    // Forms built later (custom fields, dialogs filled on open) get examples too.
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; applyPlaceholders(); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  window.JuanmaHelp = { MODULES, FIELDS, lookup, openHelp };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
