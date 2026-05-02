// ==========================================
// API GOOGLE APPS SCRIPT - COTIZADOR MYANANDA
// ==========================================

const FOLDER_ID_COTIZADOR = "1nOFidN0qNT5MhkLH_T48Fc3L8qPNyR3x"; // Carpeta base de datos

function doGet_Cotizador(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "get_data";

  if (action === "get_data") {
    try {
      var fileInfo = buscarArchivoHoy();
      if (!fileInfo) {
        return ContentService.createTextOutput(JSON.stringify({ 
          valid: false, 
          date: "No hay archivo hoy",
          error: "No se encontró un archivo actualizado para el día de hoy." 
        })).setMimeType(ContentService.MimeType.JSON);
      }

      var productos = extraerDatos(fileInfo.id);
      
      var response = {
        valid: true,
        fileName: fileInfo.name,
        date: Utilities.formatDate(new Date(), Session.getScriptTimeZone() || "GMT-3", "dd/MM/yyyy HH:mm"),
        productos: productos
      };

      return ContentService.createTextOutput(JSON.stringify(response))
        .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ valid: false, error: String(err) }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  return ContentService.createTextOutput(JSON.stringify({ error: "Acción no reconocida" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost_Cotizador(e) {
  try {
    var contents = JSON.parse(e.postData.contents);
    
    // Si viene fileData, es la subida del Drag & Drop del Cotizador
    if (contents.fileData && contents.fileName) {
       var folder = DriveApp.getFolderById(FOLDER_ID_COTIZADOR);
       var decodedData = Utilities.base64Decode(contents.fileData);
       var blob = Utilities.newBlob(decodedData, contents.mimeType || MimeType.MICROSOFT_EXCEL, contents.fileName);
       var newFile = folder.createFile(blob);
       
       return ContentService.createTextOutput(JSON.stringify({ success: true, fileId: newFile.getId() }))
         .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ error: "Estructura de POST no reconocida por get_producto.js" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// FUNCIONES AUXILIARES
// ==========================================

function buscarArchivoHoy() {
  var folder = DriveApp.getFolderById(FOLDER_ID_COTIZADOR);
  var files = folder.searchFiles("mimeType != 'application/vnd.google-apps.folder'");
  var hoy = new Date();
  
  var bestFile = null;
  var bestTime = 0;
  
  while (files.hasNext()) {
    var file = files.next();
    var cDate = file.getDateCreated();
    var mDate = file.getLastUpdated();
    
    // Verificamos si se creó o modificó hoy
    if ((cDate.getFullYear() === hoy.getFullYear() && cDate.getMonth() === hoy.getMonth() && cDate.getDate() === hoy.getDate()) ||
        (mDate.getFullYear() === hoy.getFullYear() && mDate.getMonth() === hoy.getMonth() && mDate.getDate() === hoy.getDate())) {
      
      if (mDate.getTime() > bestTime) {
        bestTime = mDate.getTime();
        bestFile = { id: file.getId(), name: file.getName() };
      }
    }
  }
  return bestFile;
}

function extraerDatos(fileId) {
  var file = DriveApp.getFileById(fileId);
  var rawData = [];
  
  if (file.getMimeType() === MimeType.GOOGLE_SHEETS) {
    var ss = SpreadsheetApp.openById(fileId);
    var sheet = ss.getSheets()[0];
    rawData = sheet.getDataRange().getValues();
  } else {
    // Si es un Excel o CSV subido a mano, lo leemos temporalmente
    // Google Apps Script no lee Excel crudo nativamente sin Sheets API avanzada.
    // Asumimos que si arrastran, arrastran CSV para que funcione rápido, o el sistema ya lo convierte.
    // Si es Excel, lo forzamos a Sheets:
    var blob = file.getBlob();
    var tempFile;
    try {
      // API V3
      tempFile = Drive.Files.create({
        name: file.getName() + " (Temp)",
        mimeType: MimeType.GOOGLE_SHEETS
      }, blob);
    } catch(e) {
      // API V2 fallback
      tempFile = Drive.Files.insert({
        title: file.getName() + " (Temp)",
        mimeType: MimeType.GOOGLE_SHEETS
      }, blob);
    }
    
    var ss = SpreadsheetApp.openById(tempFile.id);
    var sheet = ss.getSheets()[0];
    rawData = sheet.getDataRange().getValues();
    
    // Limpiamos el temporal
    try {
      Drive.Files.remove(tempFile.id);
    } catch(e) {
      DriveApp.getFileById(tempFile.id).setTrashed(true);
    }
  }
  
  const productos = [];
  let ultimoNombre = ""; // Para el rellenado inteligente

  // Leemos desde la fila 5 (índice 4 en el array)
  for (let i = 4; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    // Asignaciones exactas dadas por el usuario:
    // A=0 (URL/ID), B=1 (Nombre), E=4 (Aroma), N=13 (Precio)
    const idUrl = String(row[0] || "").trim();
    let nombre = String(row[1] || "").trim();
    const aroma = String(row[4] || "").trim();
    const precio = Number(row[13]) || 0;

    // Rellenado Inteligente: Si hay un ID de URL pero no hay nombre, clonamos el último nombre válido
    if (idUrl && !nombre && ultimoNombre) {
      nombre = ultimoNombre;
    }

    if (nombre) {
      ultimoNombre = nombre; // Guardamos para la siguiente fila
      productos.push({
        nombre: nombre,
        aroma: aroma,
        precio: precio
      });
    }
  }
  
  return productos;
}
