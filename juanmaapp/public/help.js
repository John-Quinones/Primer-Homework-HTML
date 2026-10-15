// In-app help: a "?" button on every module explains what it does, and every
// field shows an example (placeholder) and a writing tip while it has focus.
(() => {
  const MODULES = {
    inicio: ["Panel general", "Resumen del día: procesos activos, clientes, vencimientos de los próximos 7 días, audiencias de los próximos 14 días y actuaciones nuevas de la Rama Judicial.",
      ["Toque cualquier recuadro para ir al módulo correspondiente.", "Las cifras salen solo de los datos guardados; si no hay datos, el recuadro queda en cero."]],
    clientes: ["Clientes", "Registro de las personas naturales y jurídicas que representa la firma, con sus datos de contacto y sus expedientes.",
      ["Persona natural: nombres y apellidos por separado; se corrigen solos a mayúscula inicial (JOHN → John).", "Persona jurídica: razón social, NIT con dígito de verificación y representante legal.", "Busque por nombre o número de documento en la casilla superior.", "Escriba el documento sin puntos ni espacios."]],
    expedientes: ["Expedientes", "Cada proceso o asunto de un cliente: tipo y subproceso, calidad del cliente (demandante, demandado, ejecutante…), estado, despacho, radicado y responsable.",
      ["El radicado de 23 dígitos permite consultar el proceso en la Rama Judicial.", "Estado: Activo, Archivo provisional o Archivo definitivo.", "Filtre por oficina o por tipo de proceso en la parte superior."]],
    agenda: ["Agenda", "Audiencias, términos y tareas de cada expediente, con recordatorios por correo o WhatsApp.",
      ["Escriba el título con la norma o etapa: «Audiencia inicial art. 77 CPTSS».", "Marque la tarea como hecha cuando se cumpla para que salga de pendientes."]],
    consulta: ["Consulta de procesos", "Consulta en la Rama Judicial los expedientes con radicado y avisa de actuaciones nuevas (reportes a las 7, 13 y 17 h).",
      ["Requiere conexión a internet desde el servidor; en el enlace de prueba no está disponible.", "Solo se consultan expedientes con la casilla «Consultar automáticamente» marcada."]],
    despachos: ["Despachos judiciales", "Directorio de juzgados, tribunales y altas cortes con su correo, para elegirlos en los expedientes y en el correo certificado.",
      ["Filtre por departamento, ciudad y área.", "Busque por nombre, correo o código del despacho."]],
    borradores: ["Documentos", "Plantillas de la firma y borradores con NomosAI: poderes, demandas, derechos de petición, tutelas, contratos y más.",
      ["Elija un expediente para llenar los datos del cliente y del proceso automáticamente.", "Los datos que falten quedan marcados como [FILL: …] para completarlos antes de firmar.", "Revise siempre el borrador: NomosAI no inventa datos, pero un abogado debe aprobarlo."]],
    firmas: ["Firma electrónica", "Envía documentos a firmar por enlace con código de verificación o firma presencial en pantalla, con constancia y huella del documento.",
      ["Revise el texto antes de enviarlo: después de firmado no se puede cambiar.", "En el enlace de prueba solo funciona la firma presencial."]],
    pagos: ["Pagos y cartera", "Cobros (honorarios, cuotas), recibos de caja, cartera por edades y recordatorios de pago a los clientes.",
      ["Cree el cobro con el concepto y las cuotas; luego registre cada pago como recibo.", "La cartera muestra lo vencido por días: 1–30, 31–60, 61–90 y más de 90.", "Configure los datos bancarios para que salgan en los recordatorios."]],
    correo: ["Correo con trazabilidad", "Envío de memoriales y comunicaciones con constancia de envío y lectura, vinculados al expediente.",
      ["Escriba el correo oficial del despacho; puede tomarlo del directorio.", "Requiere el servidor de correo de la firma; en el enlace de prueba no se envía."]],
    jurisprudencia: ["Jurisprudencia", "Búsqueda de sentencias solo en sitios oficiales (Corte Constitucional, Corte Suprema, Consejo de Estado) y verificación de citas.",
      ["Describa el problema jurídico con palabras clave: «estabilidad laboral reforzada debilidad manifiesta».", "Guarde las sentencias útiles y vincúlelas al expediente."]],
    importar: ["Importar desde Excel", "Carga clientes y expedientes desde un archivo de Excel (Access o el servidor de la firma), sin duplicar los que ya existen.",
      ["Revise la columna que la app asignó a cada campo antes de importar.", "Los radicados que no tienen 23 dígitos se guardan tal como vienen.", "Honorarios y pagos del archivo quedan como cobros y recibos."]],
    reportes: ["Reportes", "Informes de expedientes, agenda, actuaciones, cartera y recibos en Excel o PDF.",
      ["Elija el reporte, la oficina y el rango de fechas.", "Los reportes de pagos requieren el permiso de pagos."]],
    usuarios: ["Usuarios y oficinas", "Personas que usan la app, sus roles, oficinas y permisos.",
      ["Cada usuario ve solo las oficinas que tenga asignadas.", "Puede dar permisos específicos a un usuario en lugar de los de su rol."]],
    configuracion: ["Configuración", "Catálogo de tipos de proceso, subprocesos (dos niveles) y campos propios de cada uno.",
      ["Use nombres cortos: «Laboral», «Ordinario laboral de primera instancia».", "Los campos propios aparecen en el expediente según su subproceso."]],
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
    "client.business_name": ["", "Razón social exacta como aparece en el certificado de Cámara de Comercio."],
    "client.nit": ["", "NIT con guion y dígito de verificación: 900123456-7."],
    "client.legal_rep": ["", "Nombre completo del representante legal según el certificado de existencia."],
    "client.email": ["cliente@correo.com", "Correo donde el cliente recibe notificaciones, recibos y recordatorios."],
    "client.phone": ["300 123 4567", "Celular con WhatsApp de preferencia, sin indicativo +57."],
    "client.city": ["Escriba: I… Ibagué", "Elija de la lista para que quede el municipio oficial (DIVIPOLA)."],
    "client.address": ["Ej. Calle 10 # 3-45, barrio Centro", "Dirección de notificación física."],
    "client.notes": ["Ej. Prefiere contacto por WhatsApp en la tarde", "Datos útiles para atender al cliente; no escriba información reservada del proceso."],
    "case.title": ["", "Qué se busca en pocas palabras: «Reconocimiento de pensión de vejez»."],
    "case.radicado": ["", "Los 23 dígitos del radicado judicial; puede pegarlo con guiones o espacios."],
    "case.client_role": ["", "Posición del cliente en el proceso: demandante, demandado, ejecutante, víctima…"],
    "case.counterparty": ["Ej. Colpensiones", "Nombre de la parte contraria o entidad accionada."],
    "case.facts": ["1. El 3 de marzo de 2024 el cliente…", "Hechos en orden cronológico, con fechas y cifras; NomosAI los usa para los borradores."],
    "case.court_search": ["", "Escriba ciudad y especialidad: «Ibagué laboral 3»."],
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
    assigned_user_id: "Abogado o auxiliar responsable.",
    category_id: "Área del proceso: Laboral, Civil, Familia, Penal…",
    process_type_id: "Clase concreta de proceso dentro del tipo.",
    status: "Activo mientras haya trámite; Archivo provisional si está suspendido; Archivo definitivo si terminó.",
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
    document.addEventListener("focusout", hideTip);
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
