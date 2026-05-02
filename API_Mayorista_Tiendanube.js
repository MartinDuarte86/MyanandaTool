/* ==========================================
 * API GOOGLE APPS SCRIPT - LISTADO MAYORISTA
 * (VERSIÓN CON SUBIDA DRAG & DROP MANUAL)
 * ==========================================
 */

var FOLDER_ID = "1nOFidN0qNT5MhkLH_T48Fc3L8qPNyR3x";

// Manejador GET Principal
function doGet_Tiendanube(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : null;

  try {
    if (action === "checkFile") {
      var fileInfo = buscarArchivoHoy();
      if (!fileInfo) {
        return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "No hay archivos creados hoy." })).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, fileName: fileInfo.name })).setMimeType(ContentService.MimeType.JSON);
    } 
    
    if (action === "getListaMayorista") {
      var fileInfo = buscarArchivoHoy();
      if (!fileInfo) throw new Error("Archivo no encontrado para procesar.");
      var data = procesarDatosTiendanube(fileInfo.id);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, data: data })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "Falta el parámetro 'action'." })).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Manejador POST (para Creación de PDF y SUBIDA DE ARCHIVO MANAUL)
function doPost_Tiendanube(e) {
  try {
    var contents = JSON.parse(e.postData.contents);
    
    // Acción: Subida manual de archivo (Drag & Drop)
    if (contents.action === "uploadFile") {
       var folder = DriveApp.getFolderById(FOLDER_ID);
       // Decodificar Base64
       var decodedData = Utilities.base64Decode(contents.base64);
       // Crear el Blob designándolo como tipo CSV
       var blob = Utilities.newBlob(decodedData, MimeType.CSV, contents.filename);
       var newFile = folder.createFile(blob);
       
       return ContentService.createTextOutput(JSON.stringify({ ok: true, fileId: newFile.getId() })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // Acción: Generar el archivo PDF Base64
    if (contents.action === "generarPDFMayorista") {
       var base64 = generarPDF(contents.data, contents.nombreArchivo);
       return ContentService.createTextOutput(JSON.stringify({
          ok: true,
          base64: base64,
          filename: contents.nombreArchivo
       })).setMimeType(ContentService.MimeType.JSON);
    }
    
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Función bsucarArchivoTiendanubeHoy() removida por redundancia. Ahora se utiliza buscarArchivoHoy() desde get_producto.js

// Lee Google Sheet O CSV PURO extrae columnas funcionales Tiendanube
function procesarDatosTiendanube(fileId) {
  var file = DriveApp.getFileById(fileId);
  var rawData = [];
  
  // Determinar si es un spreadsheet (automatizado) o un csv directo (drag&drop)
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    var ss = SpreadsheetApp.openById(fileId);
    var sheet = ss.getSheets()[0];
    rawData = sheet.getDataRange().getValues();
  } else {
    // Es un CSV en crudo. Si vemos  en los acentos, es porque el archivo está codificado en Windows-1252/ISO-8859-1 (típico de Excel).
    var csvString = file.getBlob().getDataAsString("ISO-8859-1");
    
    try {
      rawData = Utilities.parseCsv(csvString, ",");
      // Si todo quedó en 1 sola columna, era separado por punto y coma
      if (rawData.length > 0 && rawData[0].length === 1) {
         rawData = Utilities.parseCsv(csvString, ";");
      }
    } catch(e) {
      // Si falla el parseo con coma (por ej. confunde delimitador y rompe comillas), probamos directamente con punto y coma
      try {
         rawData = Utilities.parseCsv(csvString, ";");
      } catch(e2) {
         // Fallback manual de emergencia si las comillas de Tiendanube están corrompidas
         rawData = [];
         var lines = csvString.split(/\r?\n/);
         for(var i=0; i<lines.length; i++) {
           var line = lines[i];
           if(line.trim() !== "") {
             var cols = line.split(";").map(function(c) { return c.replace(/^"|"$/g, ""); });
             rawData.push(cols);
           }
         }
      }
    }
  }
  
  if (rawData.length < 2) return [];
  
  var headers = rawData[0];
  var sHeaders = headers.map(function(h) { return String(h).trim().toLowerCase(); });
  
  var idxSKU = sHeaders.indexOf("sku");
  var idxNombre = sHeaders.indexOf("nombre");
  var idxPrecio = sHeaders.indexOf("precio");
  var idxPrecioPromo = sHeaders.indexOf("precio promocional");
  var idxMostrar = sHeaders.indexOf("mostrar en tienda");
  var idxCategoria = sHeaders.indexOf("categorías");
  
  var dataRows = [];
  for (var i = 1; i < rawData.length; i++) {
    var row = rawData[i];
    var mostrar = (idxMostrar > -1 && row[idxMostrar]) ? String(row[idxMostrar]).trim().toUpperCase() : "";
    if (mostrar === "SI") {
       dataRows.push({
         sku: idxSKU > -1 ? row[idxSKU] : "",
         nombre: idxNombre > -1 ? row[idxNombre] : "",
         precio: idxPrecio > -1 ? parseARSNumber(row[idxPrecio]) : 0,
         precio_promo: idxPrecioPromo > -1 ? parseARSNumber(row[idxPrecioPromo]) : 0,
         seccion: idxCategoria > -1 ? row[idxCategoria] : "General",
         pagina: 1
       });
    }
  }
  
  return dataRows;
}

// Función auxiliar para parsear números
function parseARSNumber(val) {
  if (!val) return 0;
  if (typeof val === "number") return val;
  var s = String(val).trim();
  // Quitar el símbolo de moneda si existe (solo deja números, comas, puntos y menos)
  s = s.replace(/[^0-9\,\.\-]/g, '');
  if (!s) return 0;

  // Tiendanube exporta usando formato US: "," para miles y "." para decimales.
  // Ej: "7,100.50" -> eliminamos todas las comas.
  s = s.replace(/\,/g, "");
  
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function generarPDF(datos, nombreArchivo) {
  const html = buildHTMLContinuo(datos);
  const out = HtmlService.createHtmlOutput(html).setWidth(794).setHeight(1123);
  const pdfBlob = out.getBlob().getAs('application/pdf');
  if (nombreArchivo) pdfBlob.setName(nombreArchivo);
  return Utilities.base64Encode(pdfBlob.getBytes());
}

function formatARS(n) {
  if (n === null || n === undefined || n === "") return "$ 0,00";
  const num = Number(n);
  if (isNaN(num)) return "$ 0,00";
  const fixed = num.toFixed(2);
  const [ent, dec] = fixed.split(".");
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "$ " + miles + "," + dec;
}

function normalizeRegistro(r) {
  return {
    sku: String(r.SKU ?? r.sku ?? "").trim(),
    nombre: String(r.nombre_producto ?? r.producto ?? r.nombre ?? r.Nombre ?? "").trim(),
    precio: Number(r.Precio ?? r.precio ?? 0),
    precioPromo: Number(r.Precio_promocion ?? r.precio_promo ?? r.precio_promocion ?? 0)
  };
}

function buildHTMLContinuo(registros) {
  const rows = (registros || [])
    .map(normalizeRegistro)
    .filter(r => r.nombre);

  rows.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const css = `
    @page { size: A4; margin: 15mm; }
    body { font-family: 'Helvetica', Arial, sans-serif; font-size: 11px; color:#333; }
    header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #444; padding-bottom: 10px; }
    h1 { margin: 0; font-size: 24px; text-transform: uppercase; }
    .fecha { font-size: 11px; color: #666; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    th { background-color: #f0f0f0; border-bottom: 2px solid #000; text-align: left; padding: 8px; font-weight: bold; font-size: 12px; }
    td { border-bottom: 1px solid #ddd; padding: 6px 8px; vertical-align: middle; }
    .col-sku { width: 15%; color: #666; font-size: 10px; }
    .col-nombre { width: 60%; font-weight: 500; }
    .col-precio { width: 25%; text-align: right; white-space: nowrap; }
    .precio-regular { font-weight: bold; font-size: 12px; }
    .precio-old { text-decoration: line-through; color: #999; font-size: 10px; margin-right: 5px; }
    .precio-promo { color: #d9534f; font-weight: bold; font-size: 13px; }
    .tag-promo { background: #d9534f; color: white; font-size: 8px; padding: 1px 3px; border-radius: 3px; vertical-align: middle; margin-left: 5px; }
  `;

  const hoy = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT-3", "dd/MM/yyyy");

  const tableRows = rows.map(r => {
    let precioHTML = "";
    if (r.precioPromo > 0 && r.precioPromo < r.precio) {
      precioHTML = `
        <span class="precio-old">${formatARS(r.precio)}</span>
        <span class="precio-promo">${formatARS(r.precioPromo)}</span>
      `;
    } else {
      precioHTML = `<span class="precio-regular">${formatARS(r.precio)}</span>`;
    }

    const nombreHTML = (r.precioPromo > 0 && r.precioPromo < r.precio)
      ? r.nombre + ' <span class="tag-promo">PROMO</span>'
      : r.nombre;

    return `
      <tr>
        <td class="col-sku">${r.sku}</td>
        <td class="col-nombre">${nombreHTML}</td>
        <td class="col-precio">${precioHTML}</td>
      </tr>
    `;
  }).join("");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <style>${css}</style>
      </head>
      <body>
        <header>
          <h1>Listado de Precios</h1>
          <div class="fecha">Emitido el: ${hoy}</div>
        </header>
        <table>
          <thead>
            <tr>
              <th class="col-sku">SKU</th>
              <th class="col-nombre">Producto</th>
              <th class="col-precio">Precio</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

