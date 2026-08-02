// ============================================
//   FUNCIONES DE CARGA
// ============================================

// ---- Cargar Archivo de Texto (TXT) ----
window.procesarArchivoTextoRuta = async function(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;
    
    mostrarToast(`Leyendo archivo...`);
    const lector = new FileReader();
    lector.onload = async function(e) {
        const contenidoTexto = e.target.result;
        const lineas = contenidoTexto.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        if (lineas.length === 0) {
            mostrarToast("El archivo está vacío");
            return;
        }
        console.log(`[Debug] Se han leído ${lineas.length} líneas.`);
        await procesarListadoCalles(lineas, event);
    };
    lector.readAsText(archivo);
};

// Conjunto de caracteres esperable en un nombre de calle español (letras con tildes/ñ, números,
// espacios y puntuación habitual). Se usa tanto para limitar lo que reconoce Tesseract como para
// limpiar el texto después, y así evitar que se cuelen símbolos raros del ruido de la imagen.
const CARACTERES_CALLE_REGEX = /[^A-Za-zÁÉÍÓÚÑÜáéíóúñü0-9 .,ºª/\-']/g;

function limpiarLineaOCR(linea) {
    return linea.replace(CARACTERES_CALLE_REGEX, '').replace(/\s{2,}/g, ' ').trim();
}

// Preprocesa la imagen antes de pasarla al OCR: la pasa a escala de grises, aumenta el contraste,
// y la amplía si es pequeña. Una foto de móvil normal (con sombras, poco contraste, texto pequeño)
// mejora mucho su reconocimiento con esto — es la causa más habitual de que el OCR meta símbolos
// que no existen en la imagen original.
function preprocesarImagenParaOCR(archivo) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const anchoObjetivo = 1600;
            const factor = img.width < anchoObjetivo ? anchoObjetivo / img.width : 1;
            const ancho = Math.round(img.width * factor);
            const alto = Math.round(img.height * factor);

            const canvas = document.createElement('canvas');
            canvas.width = ancho;
            canvas.height = alto;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, ancho, alto);

            const imageData = ctx.getImageData(0, 0, ancho, alto);
            const datos = imageData.data;
            const contraste = 1.35;
            for (let i = 0; i < datos.length; i += 4) {
                const gris = datos[i] * 0.299 + datos[i + 1] * 0.587 + datos[i + 2] * 0.114;
                let valor = (gris - 128) * contraste + 128;
                valor = Math.max(0, Math.min(255, valor));
                datos[i] = datos[i + 1] = datos[i + 2] = valor;
            }
            ctx.putImageData(imageData, 0, 0);

            URL.revokeObjectURL(img.src);
            resolve(canvas);
        };
        img.onerror = () => reject(new Error("No se pudo leer la imagen"));
        img.src = URL.createObjectURL(archivo);
    });
}

// ---- Escanear Imagen (OCR) ----
window.procesarImagenCalles = async function(event) {
    const archivos = Array.from(event.target.files || []);
    if (archivos.length === 0) return;
    
    mostrarToast("Cargando motor de OCR...");
    try {
        if (typeof Tesseract === 'undefined') {
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
        }
        
        // Configuración PSM 6: Ideal para listas y bloques de texto uniforme
        const worker = await Tesseract.createWorker('spa', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                    mostrarToast(`Escaneando... ${Math.round(m.progress * 100)}%`);
                }
            }
        });
        await worker.setParameters({
            tessedit_pageseg_mode: '6',
            // Restringe el reconocimiento a los caracteres que puede tener un nombre de calle:
            // así el OCR ya no "inventa" símbolos raros para trazos de tinta, sombras o ruido.
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÚÑÜabcdefghijklmnopqrstuvwxyzáéíóúñü0123456789 .,ºª/-\'',
            preserve_interword_spaces: '1'
        });

        let todasLasLineas = [];
        for (const archivo of archivos) {
            mostrarToast(`Escaneando imagen...`);
            const imagenPreparada = await preprocesarImagenParaOCR(archivo).catch(() => archivo);
            const { data: { text } } = await worker.recognize(imagenPreparada);
            const lineasImagen = text.split('\n')
                .map(l => limpiarLineaOCR(l))
                .filter(l => l.length > 2);
            todasLasLineas = todasLasLineas.concat(lineasImagen);
        }
        await worker.terminate();
        if (todasLasLineas.length === 0) {
            mostrarToast("El OCR no detectó texto");
            event.target.value = '';
            return;
        }
        console.log(`[Debug] OCR detectó ${todasLasLineas.length} líneas.`);
        const lineasEditadas = await mostrarModalEdicionOCR(todasLasLineas);
        if (!lineasEditadas || lineasEditadas.length === 0) {
            event.target.value = '';
            return;
        }
        await procesarListadoCalles(lineasEditadas, event);
    } catch (err) {
        console.error("Error en OCR:", err);
        mostrarToast("Error al escanear la imagen");
        event.target.value = '';
    }
};

// ---- Cargar GPX ----
window.manejarArchivoGPX = function(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = function(e) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(e.target.result, "text/xml");
            const puntosTrk = xmlDoc.getElementsByTagName("trkpt");
            const puntosRte = xmlDoc.getElementsByTagName("rtept");
            let coordenadas = [];
            const extraerPuntos = (nodos) => {
                for (let i = 0; i < nodos.length; i++) {
                    const lat = parseFloat(nodos[i].getAttribute("lat"));
                    const lon = parseFloat(nodos[i].getAttribute("lon"));
                    if (!isNaN(lat) && !isNaN(lon)) coordenadas.push([lat, lon]);
                }
            };
            extraerPuntos(puntosTrk);
            if (coordenadas.length === 0) extraerPuntos(puntosRte);
            if (coordenadas.length > 0) {
                const estilos = obtenerEstilosActuales();
                const linea = L.polyline(coordenadas, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(linea, coordenadas, map, "GPX borrado");
                historialAcciones.push({ tipo: 'linea', elemento: linea });
                historialRehacer = [];
                enfocarMapaEnGrupo(L.featureGroup([linea]), map);
                mostrarToast("GPX importado con éxito!");
            } else {
                mostrarToast("El archivo GPX no tiene coordenadas");
            }
        } catch (err) {
            console.error("Error en GPX:", err);
            mostrarToast("Error al procesar el archivo GPX");
        }
        event.target.value = '';
    };
    lector.readAsText(archivo);
};

// ---- Borrar Todo ----
window.confirmarBorrarTodo = function() {
    if (confirm("¿Estás seguro de que quieres borrar todo el mapa?")) {
        const capasAQuitar = [];
        map.eachLayer(function(capa) {
            if (!(capa instanceof L.TileLayer)) capasAQuitar.push(capa);
        });
        capasAQuitar.forEach(capa => map.removeLayer(capa));
        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
        ultimoMarcadorTramo = null;
        window.puntosDibujoLibre = [];
        trazoLibreActivo = false;
        mostrarToast("Mapa borrado por completo.");
    }
};

// ---- Conmutador de Borrado ----
window.alternarBorrado = function() {
    const btn = document.getElementById('btn-borrar');
    const otrosModos = ['btn-ruta', 'btn-aislado', 'btn-puntos-rectos', 'btn-continuo', 'btn-comentario'];
    otrosModos.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.className = 'btn';
    });
    if (modoActual !== 'borrar') {
        modoActual = 'borrar';
        borradoPreciso = false;
        btn.className = 'btn btn-active-red';
        btn.innerHTML = '🧹';
        map.dragging.enable(); 
        mostrarToast("🧹 Modo: Borrar elementos");
    } else {
        if (!borradoPreciso) {
            borradoPreciso = true;
            btn.className = 'btn btn-active-blue';
            btn.innerHTML = '🧽';
            map.dragging.disable();
            mostrarToast("🧽 Modo: Borrado preciso");
        } else {
            borradoPreciso = false;
            modoActual = 'ruta';
            btn.className = 'btn';
            btn.innerHTML = '🧹';
            map.dragging.enable();
            if (borradoPrecisoActivo) finalizarBorradoPreciso();
            mostrarToast("Modo borrado desactivado");
        }
    }
};

// ============================================
//   VARIABLES GLOBALES
// ============================================
const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

let map;
let modoActual = 'ruta';
let drawnItems; 
let historialAcciones = [];
let historialRehacer = [];
let ultimoPuntoTramo = null; 
let ultimoMarcadorTramo = null;
let trazoLibreActivo = false;
let borradoPreciso = false;
let borradoPrecisoActivo = false;
let ultimoPuntoBorrado = null;
const RADIO_BORRADO_PRECISO_METROS = 6;
let sesionBorradoPrecisoActual = null;

// ============================================
//   FUNCIONES DE UTILIDAD Y MAPA
// ============================================
function sanitizarNombreArchivo(nombre) { return nombre ? nombre.replace(/\.\./g, '').replace(/[\/\\]/g, '').trim() : ''; }
function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

function obtenerSiguienteNumeroDisponible() {
    const numerosUsados = new Set();
    historialAcciones.forEach(item => {
        if (item.tipo === 'marcador' && item.numero) numerosUsados.add(item.numero);
    });
    let i = 1;
    while (numerosUsados.has(i)) i++;
    return i;
}

function vincularLineaEntreMarcadores(marcadorAnterior, marcadorNuevo, linea) {
    if (!marcadorAnterior.lineasAsociadas) marcadorAnterior.lineasAsociadas = [];
    if (!marcadorNuevo.lineasAsociadas) marcadorNuevo.lineasAsociadas = [];
    marcadorAnterior.lineasAsociadas.push(linea);
    marcadorNuevo.lineasAsociadas.push(linea);
    linea.marcadoresVinculados = [marcadorAnterior, marcadorNuevo];
}

function eliminarMarcadorYLineas(marcador, mensaje) {
    const entradaMarcador = historialAcciones.find(item => item.tipo === 'marcador' && item.elemento === marcador);
    const restaurar = [{
        tipo: 'marcador',
        elemento: marcador,
        numero: entradaMarcador ? entradaMarcador.numero : null,
        submodo: entradaMarcador ? entradaMarcador.submodo : 'ruta'
    }];
    map.removeLayer(marcador);
    historialAcciones = historialAcciones.filter(item => item.elemento !== marcador);
    if (marcador.lineasAsociadas && marcador.lineasAsociadas.length) {
        marcador.lineasAsociadas.forEach(linea => {
            map.removeLayer(linea);
            quitarCapasExtra(linea);
            historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
            if (linea.marcadoresVinculados) {
                linea.marcadoresVinculados.forEach(m => {
                    if (m !== marcador && m.lineasAsociadas) {
                        m.lineasAsociadas = m.lineasAsociadas.filter(l => l !== linea);
                    }
                });
            }
            restaurar.push({ tipo: 'linea', elemento: linea });
        });
    }
    mostrarToast(mensaje || "Punto borrado");
    historialAcciones.push({ tipo: 'borrado', restaurar });
    historialRehacer = [];
}

function eliminarComentario(comentario, mensaje) {
    const entradaComentario = historialAcciones.find(item => item.tipo === 'comentario' && item.elemento === comentario);
    const restaurar = [{
        tipo: 'comentario',
        elemento: comentario,
        texto: entradaComentario ? entradaComentario.texto : ''
    }];
    map.removeLayer(comentario);
    historialAcciones = historialAcciones.filter(item => item.elemento !== comentario);
    mostrarToast(mensaje || "Comentario borrado");
    historialAcciones.push({ tipo: 'borrado', restaurar });
    historialRehacer = [];
}

function calcularRumbo(p1, p2) {
    const lat1 = p1.lat * Math.PI / 180, lat2 = p2.lat * Math.PI / 180;
    const dLng = (p2.lng - p1.lng) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    const rumbo = Math.atan2(y, x) * 180 / Math.PI;
    return (rumbo + 360) % 360;
}
const DISTANCIA_ENTRE_FLECHAS_METROS = 70;

function crearFlechasDireccion(coordenadas, color) {
    const flechas = [];
    if (!coordenadas || coordenadas.length < 2) return flechas;
    const puntos = coordenadas.map(p => (p instanceof L.LatLng) ? p : L.latLng(p));
    let acumulado = 0;
    let siguienteFlechaEn = DISTANCIA_ENTRE_FLECHAS_METROS / 2;
    for (let i = 1; i < puntos.length; i++) {
        const a = puntos[i - 1], b = puntos[i];
        const tramoDist = a.distanceTo(b);
        if (tramoDist === 0) continue;
        while (acumulado + tramoDist >= siguienteFlechaEn) {
            const t = Math.max(0, Math.min(1, (siguienteFlechaEn - acumulado) / tramoDist));
            const punto = L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t);
            const rumbo = calcularRumbo(a, b);
            const icono = L.divIcon({
                className: 'flecha-direccion',
                html: `<div style="transform: rotate(${rumbo}deg); color: ${color || '#3388ff'}; font-size: 16px; line-height: 16px; text-shadow: 0 0 2px white, 0 0 2px white;">▲</div>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            });
            const marcadorFlecha = L.marker(punto, { icon: icono, interactive: false, keyboard: false }).addTo(map);
            flechas.push(marcadorFlecha);
            siguienteFlechaEn += DISTANCIA_ENTRE_FLECHAS_METROS;
        }
        acumulado += tramoDist;
    }
    return flechas;
}

function quitarCapasExtra(linea) {
    if (!linea) return;
    if (linea._zonaToque) map.removeLayer(linea._zonaToque);
    if (linea._flechas) linea._flechas.forEach(f => map.removeLayer(f));
}
function anadirCapasExtra(linea) {
    if (!linea) return;
    if (linea._zonaToque) linea._zonaToque.addTo(map);
    if (linea._flechas) linea._flechas.forEach(f => f.addTo(map));
}

function anadirZonaDeToque(lineaVisible, coordenadas, mapaInstancia, mensajeBorrado) {
    const pesoToque = Math.max((lineaVisible.options.weight || 4) + 22, 26);
    const zonaToque = L.polyline(coordenadas, { color: '#000000', weight: pesoToque, opacity: 0, interactive: true, bubblingMouseEvents: false }).addTo(mapaInstancia);
    lineaVisible._zonaToque = zonaToque;
    lineaVisible._flechas = crearFlechasDireccion(coordenadas, lineaVisible.options.color);
    const manejarClickBorrado = function(ev) {
        if (modoActual === 'borrar' && !borradoPreciso) {
            L.DomEvent.stopPropagation(ev);
            if (ev.originalEvent) {
                ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
                ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
            }
            mapaInstancia.removeLayer(lineaVisible);
            mapaInstancia.removeLayer(zonaToque);
            quitarCapasExtra(lineaVisible);
            historialAcciones = historialAcciones.filter(item => item.elemento !== lineaVisible);
            if (lineaVisible.marcadoresVinculados) {
                lineaVisible.marcadoresVinculados.forEach(m => {
                    if (m.lineasAsociadas) m.lineasAsociadas = m.lineasAsociadas.filter(l => l !== lineaVisible);
                });
            }
            mostrarToast(mensajeBorrado || "Línea borrada");
            historialAcciones.push({ tipo: 'borrado', restaurar: [{ tipo: 'linea', elemento: lineaVisible }] });
            historialRehacer = [];
        }
    };
    lineaVisible.on('click', manejarClickBorrado);
    zonaToque.on('click', manejarClickBorrado);
    return zonaToque;
}

function densificarPuntos(puntos, distMaxMetros) {
    if (!puntos || puntos.length < 2) return puntos;
    let resultado = [puntos[0]];
    for (let i = 1; i < puntos.length; i++) {
        const a = puntos[i - 1], b = puntos[i];
        const distancia = a.distanceTo(b);
        const pasos = Math.min(500, Math.ceil(distancia / distMaxMetros));
        for (let s = 1; s <= pasos; s++) {
            const t = s / pasos;
            resultado.push(L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t));
        }
    }
    return resultado;
}

function eliminarLineaDelHistorial(linea) {
    map.removeLayer(linea);
    quitarCapasExtra(linea);
    historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
    if (linea.marcadoresVinculados) {
        linea.marcadoresVinculados.forEach(m => {
            if (m.lineasAsociadas) m.lineasAsociadas = m.lineasAsociadas.filter(l => l !== linea);
        });
    }
}

function desvincularYQuitarMarcador(marcador) {
    map.removeLayer(marcador);
    historialAcciones = historialAcciones.filter(item => item.elemento !== marcador);
    if (marcador.lineasAsociadas) {
        marcador.lineasAsociadas.forEach(linea => {
            if (linea.marcadoresVinculados) {
                linea.marcadoresVinculados = linea.marcadoresVinculados.filter(m => m !== marcador);
            }
        });
    }
}

function borrarConPrecision(latlngCentro, radioMetros, sesion) {
    const marcadoresActuales = historialAcciones.filter(item => item.tipo === 'marcador').map(item => item.elemento);
    marcadoresActuales.forEach(marcador => {
        if (marcador.getLatLng().distanceTo(latlngCentro) <= radioMetros) {
            const entradaMarcador = historialAcciones.find(item => item.tipo === 'marcador' && item.elemento === marcador);
            desvincularYQuitarMarcador(marcador);
            sesion.marcadores.push({ elemento: marcador, numero: entradaMarcador ? entradaMarcador.numero : null, submodo: entradaMarcador ? entradaMarcador.submodo : 'ruta' });
        }
    });
    const comentariosActuales = historialAcciones.filter(item => item.tipo === 'comentario').map(item => item.elemento);
    comentariosActuales.forEach(comentario => {
        if (comentario.getLatLng().distanceTo(latlngCentro) <= radioMetros) {
            const entradaComentario = historialAcciones.find(item => item.tipo === 'comentario' && item.elemento === comentario);
            map.removeLayer(comentario);
            historialAcciones = historialAcciones.filter(item => item.elemento !== comentario);
            sesion.comentarios.push({ elemento: comentario, texto: entradaComentario ? entradaComentario.texto : '' });
        }
    });
    const lineasActuales = historialAcciones.filter(item => item.tipo === 'linea').map(item => item.elemento);
    lineasActuales.forEach(linea => {
        let puntos = linea.getLatLngs();
        if (!puntos || puntos.length < 2) return;
        const algunoCerca = puntos.some(p => p.distanceTo(latlngCentro) <= radioMetros * 2.5);
        if (!algunoCerca) return;
        puntos = densificarPuntos(puntos, Math.max(radioMetros / 2, 2));
        let huboCambios = false;
        let subTramos = [];
        let actual = [];
        puntos.forEach(p => {
            if (p.distanceTo(latlngCentro) <= radioMetros) {
                huboCambios = true;
                if (actual.length >= 2) subTramos.push(actual);
                actual = [];
            } else {
                actual.push(p);
            }
        });
        if (actual.length >= 2) subTramos.push(actual);
        if (!huboCambios) return;
        let registro = linea._registroSesionBorrado;
        if (!registro) {
            registro = {
                coordsOriginal: linea.getLatLngs(),
                estiloOriginal: { color: linea.options.color, weight: linea.options.weight, opacity: linea.options.opacity },
                marcadoresVinculadosOriginal: linea.marcadoresVinculados ? linea.marcadoresVinculados.slice() : [],
                actuales: []
            };
            sesion.reemplazosLinea.push(registro);
        }
        registro.actuales = registro.actuales.filter(l => l !== linea);
        eliminarLineaDelHistorial(linea);
        subTramos.forEach(sub => {
            const nuevaLinea = L.polyline(sub, { color: registro.estiloOriginal.color, weight: registro.estiloOriginal.weight, opacity: registro.estiloOriginal.opacity, interactive: true }).addTo(map);
            nuevaLinea._registroSesionBorrado = registro;
            historialAcciones.push({ tipo: 'linea', elemento: nuevaLinea });
            registro.actuales.push(nuevaLinea);
        });
    });
}

function iniciarBorradoPreciso(latlng) {
    borradoPrecisoActivo = true;
    map.dragging.disable();
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.getContainer().style.touchAction = 'none';
    ultimoPuntoBorrado = latlng;
    sesionBorradoPrecisoActual = { marcadores: [], comentarios: [], reemplazosLinea: [] };
    borrarConPrecision(latlng, RADIO_BORRADO_PRECISO_METROS, sesionBorradoPrecisoActual);
}

function continuarBorradoPreciso(latlng) {
    if (!borradoPrecisoActivo || !sesionBorradoPrecisoActual) return;
    if (ultimoPuntoBorrado) {
        const distancia = ultimoPuntoBorrado.distanceTo(latlng);
        const pasos = Math.min(8, Math.max(1, Math.ceil(distancia / (RADIO_BORRADO_PRECISO_METROS * 0.8))));
        for (let s = 1; s <= pasos; s++) {
            const t = s / pasos;
            const inter = L.latLng(ultimoPuntoBorrado.lat + (latlng.lat - ultimoPuntoBorrado.lat) * t, ultimoPuntoBorrado.lng + (latlng.lng - ultimoPuntoBorrado.lng) * t);
            borrarConPrecision(inter, RADIO_BORRADO_PRECISO_METROS, sesionBorradoPrecisoActual);
        }
    }
    ultimoPuntoBorrado = latlng;
}

function finalizarBorradoPreciso() {
    if (borradoPrecisoActivo) {
        borradoPrecisoActivo = false;
        ultimoPuntoBorrado = null;
        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
        map.boxZoom.enable();
        map.getContainer().style.touchAction = 'auto';
        const sesion = sesionBorradoPrecisoActual;
        sesionBorradoPrecisoActual = null;
        if (sesion && (sesion.marcadores.length || sesion.comentarios.length || sesion.reemplazosLinea.length)) {
            sesion.reemplazosLinea.forEach(registro => {
                registro.actuales.forEach(l => {
                    delete l._registroSesionBorrado;
                    anadirZonaDeToque(l, l.getLatLngs(), map, "Tramo borrado");
                });
            });
            historialAcciones.push({ tipo: 'borrado', sesionPrecisa: sesion });
            historialRehacer = [];
            mostrarToast("Trazo borrado (con precisión)");
        }
    }
}

let estaDibujandoLibre = false;
let polilineaContinuaActual = null;
let ultimoToqueTiempo = 0;

// ---- INICIALIZACIÓN DEL MAPA ----
document.addEventListener("DOMContentLoaded", function () {
    try {
        map = L.map('map', {
            zoomControl: false,
            touchZoom: true,
            doubleClickZoom: false,
            tap: false 
        }).setView([37.8882, -4.7794], 13);

        drawnItems = L.featureGroup().addTo(map);

        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
        const cartoClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; CARTO' });
        const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '&copy; Google Maps' });

        osm.addTo(map);
        L.control.layers({ "Callejero": osm, "Claro": cartoClaro, "Google": googleHybrid }, null, { position: 'topright' }).addTo(map);

        map.on('click', gestionarPulsacion);
        configurarDibujoTactilTablet();
        setModo('ruta');

        const colorInput = document.getElementById('color-trazo');
        const grosorInput = document.getElementById('grosor-trazo');
        const opacidadInput = document.getElementById('opacidad-trazo');

        if (colorInput) colorInput.addEventListener('input', manejarCambioEstiloDinamico);
        if (grosorInput) grosorInput.addEventListener('input', manejarCambioEstiloDinamico);
        if (opacidadInput) opacidadInput.addEventListener('input', manejarCambioEstiloDinamico);

        // ---- Búsqueda en la barra superior ----
        function realizarBusqueda(query) {
            if (!query) { mostrarToast("Escribe el nombre de una calle"); return; }
            mostrarToast("Buscando...");
            const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Córdoba, España')}&countrycodes=es&limit=1`;
            fetch(url)
                .then(res => res.json())
                .then(data => {
                    if (data && data.length > 0) {
                        const lat = parseFloat(data[0].lat);
                        const lon = parseFloat(data[0].lon);
                        map.setView([lat, lon], 17);
                        if (window._marcadorBusqueda) map.removeLayer(window._marcadorBusqueda);
                        window._marcadorBusqueda = L.marker([lat, lon], { icon: L.divIcon({ className: 'number-icon', html: '📍', iconSize: [28,28], iconAnchor:[14,14] }) }).addTo(map);
                        mostrarToast(`Encontrado: ${data[0].display_name}`);
                    } else {
                        mostrarToast("No se encontró la calle");
                    }
                })
                .catch(() => mostrarToast("Error en la búsqueda"));
        }

        document.getElementById('search-input').addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                realizarBusqueda(this.value.trim());
            }
        });
        document.getElementById('btn-search-lupa').addEventListener('click', function() {
            const input = document.getElementById('search-input');
            realizarBusqueda(input.value.trim());
        });

        // ---- Guardar GeoJSON ----
        document.getElementById('btn-save').addEventListener('click', function() {
            var data = drawnItems.toGeoJSON();
            var blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url; a.download = 'mis_rutas.geojson';
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            mostrarToast('💾 GeoJSON descargado');
            cerrarModalExport();
        });

        // ---- Cargar mapa desde URL ----
        const urlParams = new URLSearchParams(window.location.search);
        const mapaCompartido = urlParams.get('mapa');
        if (mapaCompartido) cargarMapaDesdeGithub(mapaCompartido);
    } catch (e) {
        console.error("Error crítico en la carga del mapa:", e);
        mostrarToast("Error al cargar el mapa, revisa la consola.");
    }
});

// ---- Funciones de modo y estilo ----
function setModo(modo) {
    modoActual = modo;
    map.dragging.enable();
    const botones = { 'ruta': 'btn-ruta', 'aislado': 'btn-aislado', 'dibujar_puntos': 'btn-puntos-rectos', 'continuo': 'btn-continuo', 'borrar': 'btn-borrar', 'comentario': 'btn-comentario' };
    for (let [m, id] of Object.entries(botones)) {
        const el = document.getElementById(id);
        if (el) {
            el.className = 'btn';
            if (modoActual === m) el.classList.add(m === 'borrar' ? 'btn-active-red' : 'btn-active-blue');
        }
    }
    if (modo !== 'ruta') ultimoPuntoTramo = null;
    historialAcciones.forEach(item => {
        if (item.tipo === 'marcador' && item.elemento && item.elemento.dragging) {
            if (modoActual === 'borrar') item.elemento.dragging.disable();
            else item.elemento.dragging.enable();
        }
    });
    const mensajes = { 'ruta': "Modo: Callejero OSRM", 'aislado': "Modo: Puntos Aislados", 'dibujar_puntos': "Modo: Punto a punto rectos", 'continuo': "Modo: Mano alzada continua", 'borrar': "Modo: Borrar elementos", 'comentario': "Modo: Añadir comentario (pulsa en el mapa)" };
    mostrarToast(mensajes[modo] || "");
}

function obtenerEstilosActuales() {
    const colorInput = document.getElementById('color-trazo');
    const grosorInput = document.getElementById('grosor-trazo');
    const opacidadInput = document.getElementById('opacidad-trazo');
    return { color: colorInput ? colorInput.value : '#3388ff', weight: grosorInput ? parseInt(grosorInput.value, 10) || 4 : 4, opacity: opacidadInput ? parseFloat(opacidadInput.value) || 1 : 1 };
}

function manejarCambioEstiloDinamico() {
    const selectorAmbito = document.getElementById('ambito-estilo');
    const ambito = selectorAmbito ? selectorAmbito.value : 'todos';
    const estilos = obtenerEstilosActuales();
    if (ambito === 'todos') {
        historialAcciones.forEach(item => {
            if (item.tipo === 'linea' && item.elemento && typeof item.elemento.setStyle === 'function') {
                item.elemento.setStyle({ color: estilos.color, weight: estilos.weight, opacity: estilos.opacity });
            }
        });
    } else if (ambito === 'ultimo') {
        const ultimaLinea = historialAcciones.slice().reverse().find(item => item.tipo === 'linea' && item.elemento);
        if (ultimaLinea && typeof ultimaLinea.elemento.setStyle === 'function') {
            ultimaLinea.elemento.setStyle({ color: estilos.color, weight: estilos.weight, opacity: estilos.opacity });
        }
    }
}

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast-aviso');
    if (!toast) return;
    toast.innerText = mensaje;
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 2200);
}

function cortarTramoActual() {
    ultimoPuntoTramo = null;
    window.puntosDibujoLibre = [];
    trazoLibreActivo = false; 
    mostrarToast("Segmento cortado");
}

// ---- Búsqueda modal ----
function mostrarModalBuscar() { document.getElementById('modal-buscar').classList.add('active'); document.getElementById('input-buscar-calle').focus(); }
function cerrarModalBuscar() { document.getElementById('modal-buscar').classList.remove('active'); }
async function buscarCalle() {
    const input = document.getElementById('input-buscar-calle');
    const query = input.value.trim();
    if (!query) { mostrarToast("Escribe el nombre de una calle"); return; }
    mostrarToast("Buscando...");
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Córdoba, España')}&countrycodes=es&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            map.setView([lat, lon], 17);
            if (window._marcadorBusqueda) map.removeLayer(window._marcadorBusqueda);
            window._marcadorBusqueda = L.marker([lat, lon], { icon: L.divIcon({ className: 'number-icon', html: '📍', iconSize: [28,28], iconAnchor:[14,14] }) }).addTo(map);
            mostrarToast(`Encontrado: ${data[0].display_name}`);
            cerrarModalBuscar();
        } else {
            mostrarToast("No se encontró la calle");
        }
    } catch (e) { console.error(e); mostrarToast("Error en la búsqueda"); }
}

// ---- Añadir comentario ----
function crearComentario(latlng, texto) {
    const icon = L.divIcon({ className: 'comentario-icon', html: '💬', iconSize: [30, 30], iconAnchor: [15, 30] });
    const marker = L.marker(latlng, { icon: icon, interactive: true }).addTo(map);
    marker.bindPopup(`<b>Comentario:</b><br>${texto}`);
    marker.on('click', function(ev) {
        if (modoActual === 'borrar' && !borradoPreciso) { L.DomEvent.stopPropagation(ev); eliminarComentario(this, "Comentario borrado"); }
    });
    historialAcciones.push({ tipo: 'comentario', elemento: marker, texto: texto });
    historialRehacer = [];
    mostrarToast("Comentario añadido");
}

// ---- Configuración táctil y ratón ----
function configurarDibujoTactilTablet() {
    const mapaContenedor = map.getContainer();
    mapaContenedor.addEventListener('touchstart', (e) => {
        if (modoActual !== 'continuo') return;
        if (e.touches.length > 1) { estaDibujandoLibre = false; return; }
        map.dragging.disable();
        estaDibujandoLibre = true;
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        const estilos = obtenerEstilosActuales();
        polilineaContinuaActual = L.polyline([latlng], { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, smoothFactor: 1, interactive: true, bubblingMouseEvents: false }).addTo(map);
        anadirZonaDeToque(polilineaContinuaActual, [latlng], map, "Línea borrada");
        historialAcciones.push({ tipo: 'linea', elemento: polilineaContinuaActual });
        historialRehacer = [];
    }, { passive: true });
    mapaContenedor.addEventListener('touchmove', (e) => {
        if (!estaDibujandoLibre || !polilineaContinuaActual) return;
        if (e.touches.length > 1) return;
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        polilineaContinuaActual.addLatLng(latlng);
        if (polilineaContinuaActual._zonaToque) polilineaContinuaActual._zonaToque.addLatLng(latlng);
    }, { passive: true });
    const finalizarTrazoTablet = () => {
        if (estaDibujandoLibre) { estaDibujandoLibre = false; polilineaContinuaActual = null; map.dragging.enable(); }
    };
    mapaContenedor.addEventListener('touchend', finalizarTrazoTablet);
    mapaContenedor.addEventListener('touchcancel', finalizarTrazoTablet);
    let ultimoEventoFueTouch = 0;
    mapaContenedor.addEventListener('touchstart', () => { ultimoEventoFueTouch = Date.now(); }, { passive: true, capture: true });
    mapaContenedor.addEventListener('mousedown', (e) => {
        if (Date.now() - ultimoEventoFueTouch < 500) return;
        if (modoActual !== 'continuo') return;
        map.dragging.disable();
        estaDibujandoLibre = true;
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        const estilos = obtenerEstilosActuales();
        polilineaContinuaActual = L.polyline([latlng], { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, smoothFactor: 1, interactive: true, bubblingMouseEvents: false }).addTo(map);
        anadirZonaDeToque(polilineaContinuaActual, [latlng], map, "Línea borrada");
        historialAcciones.push({ tipo: 'linea', elemento: polilineaContinuaActual });
        historialRehacer = [];
    });
    mapaContenedor.addEventListener('mousemove', (e) => {
        if (!estaDibujandoLibre || !polilineaContinuaActual) return;
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        polilineaContinuaActual.addLatLng(latlng);
        if (polilineaContinuaActual._zonaToque) polilineaContinuaActual._zonaToque.addLatLng(latlng);
    });
    window.addEventListener('mouseup', finalizarTrazoTablet);
    mapaContenedor.addEventListener('touchstart', (e) => {
        if (modoActual !== 'borrar' || !borradoPreciso) return;
        if (e.touches.length > 1) return;
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        iniciarBorradoPreciso(latlng);
    }, { passive: true });
    mapaContenedor.addEventListener('touchmove', (e) => {
        if (!borradoPrecisoActivo) return;
        if (e.touches.length > 1) return;
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        continuarBorradoPreciso(latlng);
    }, { passive: true });
    mapaContenedor.addEventListener('touchend', finalizarBorradoPreciso);
    mapaContenedor.addEventListener('touchcancel', finalizarBorradoPreciso);
    mapaContenedor.addEventListener('mousedown', (e) => {
        if (Date.now() - ultimoEventoFueTouch < 500) return;
        if (modoActual !== 'borrar' || !borradoPreciso) return;
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        iniciarBorradoPreciso(latlng);
    });
    mapaContenedor.addEventListener('mousemove', (e) => {
        if (!borradoPrecisoActivo) return;
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(e.clientX - rect.left, e.clientY - rect.top));
        continuarBorradoPreciso(latlng);
    });
    window.addEventListener('mouseup', finalizarBorradoPreciso);
}

async function gestionarPulsacion(e) {
    if (modoActual === 'continuo') return; 
    if (modoActual === 'comentario') {
        const latlng = e.latlng;
        const texto = prompt("Escribe tu comentario:", "");
        if (texto !== null && texto.trim() !== "") {
            crearComentario(latlng, texto.trim());
        } else {
            mostrarToast("Comentario cancelado o vacío");
        }
        return;
    }
    const latlng = e.latlng;
    const estilos = obtenerEstilosActuales();
    const tiempoActual = new Date().getTime();
    if (tiempoActual - ultimoToqueTiempo < 350) cortarTramoActual();
    ultimoToqueTiempo = tiempoActual;
    if (modoActual === 'borrar') return; 
    if (modoActual === 'dibujar_puntos') {
        if (!window.puntosDibujoLibre || !trazoLibreActivo) { window.puntosDibujoLibre = []; trazoLibreActivo = true; }
        window.puntosDibujoLibre.push(latlng);
        if (window.puntosDibujoLibre.length > 1) {
            const pAnt = window.puntosDibujoLibre[window.puntosDibujoLibre.length - 2];
            const coordsSegmento = [pAnt, latlng];
            const linea = L.polyline(coordsSegmento, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
            anadirZonaDeToque(linea, coordsSegmento, map, "Segmento borrado");
            historialAcciones.push({ tipo: 'linea', elemento: linea });
        }
        historialRehacer = [];
        return;
    }
    if (modoActual === 'ruta' || modoActual === 'aislado') {
        const num = obtenerSiguienteNumeroDisponible();
        const icon = L.divIcon({ className: 'number-icon', html: `<span>${num}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        const marker = L.marker(latlng, { icon: icon, draggable: true, interactive: true }).addTo(map);
        marker.on('click', function(ev) {
            if (modoActual === 'borrar' && !borradoPreciso) { L.DomEvent.stopPropagation(ev); eliminarMarcadorYLineas(this, "Punto borrado"); }
        });
        let avisoSinRuta = false;
        if (modoActual === 'ruta' && ultimoPuntoTramo) {
            const coords = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);
            if (coords && coords.length > 0) {
                const linea = L.polyline(coords, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(linea, coords, map, "Tramo borrado");
                if (ultimoMarcadorTramo) vincularLineaEntreMarcadores(ultimoMarcadorTramo, marker, linea);
                historialAcciones.push({ tipo: 'linea', elemento: linea });
            } else { avisoSinRuta = true; }
        }
        ultimoPuntoTramo = (modoActual === 'ruta') ? latlng : null;
        ultimoMarcadorTramo = (modoActual === 'ruta') ? marker : null;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: modoActual });
        historialRehacer = [];
        if (avisoSinRuta) mostrarToast("⚠️ No se encontró ruta a pie entre estos dos puntos");
    }
}

async function obtenerRutaPorCallesOSRM(origen, destino) {
    const url = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes.length > 0) {
                return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            }
        }
    } catch (e) { console.error('Error en OSRM:', e); }
    return null;
}

// ---- Deshacer y Rehacer ----
function deshacerUltimo() {
    if (historialAcciones.length === 0) { mostrarToast("Nada que deshacer"); return; }
    const accion = historialAcciones.pop();
    if (!accion) return;
    if (accion.tipo === 'borrado') {
        if (accion.restaurar) {
            accion.restaurar.forEach(item => {
                if (item.tipo === 'marcador' && item.elemento) {
                    const numActual = item.numero;
                    const numerosUsados = new Set();
                    historialAcciones.forEach(i => { if (i.tipo === 'marcador' && i.numero) numerosUsados.add(i.numero); });
                    if (numerosUsados.has(numActual)) { let nuevoNum = 1; while (numerosUsados.has(nuevoNum)) nuevoNum++; item.numero = nuevoNum; }
                    item.elemento.setIcon(L.divIcon({ className: 'number-icon', html: `<span>${item.numero}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }));
                }
                item.elemento.addTo(map);
                anadirCapasExtra(item.elemento);
                historialAcciones.push(item);
            });
        }
        if (accion.sesionPrecisa) {
            accion.sesionPrecisa.marcadores.forEach(m => {
                const numActual = m.numero;
                const numerosUsados = new Set();
                historialAcciones.forEach(i => { if (i.tipo === 'marcador' && i.numero) numerosUsados.add(i.numero); });
                if (numerosUsados.has(numActual)) { let nuevoNum = 1; while (numerosUsados.has(nuevoNum)) nuevoNum++; m.numero = nuevoNum; }
                m.elemento.setIcon(L.divIcon({ className: 'number-icon', html: `<span>${m.numero}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] }));
                m.elemento.addTo(map);
                historialAcciones.push({ tipo: 'marcador', elemento: m.elemento, numero: m.numero, submodo: m.submodo });
            });
            accion.sesionPrecisa.comentarios.forEach(c => { c.elemento.addTo(map); historialAcciones.push({ tipo: 'comentario', elemento: c.elemento, texto: c.texto }); });
            accion.sesionPrecisa.reemplazosLinea.forEach(registro => {
                registro.actuales.forEach(l => { map.removeLayer(l); quitarCapasExtra(l); historialAcciones = historialAcciones.filter(item => item.elemento !== l); });
                const lineaRestaurada = L.polyline(registro.coordsOriginal, { color: registro.estiloOriginal.color, weight: registro.estiloOriginal.weight, opacity: registro.estiloOriginal.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(lineaRestaurada, registro.coordsOriginal, map, "Tramo borrado");
                lineaRestaurada.marcadoresVinculados = registro.marcadoresVinculadosOriginal;
                registro.marcadoresVinculadosOriginal.forEach(m => { if (m.lineasAsociadas && !m.lineasAsociadas.includes(lineaRestaurada)) { m.lineasAsociadas.push(lineaRestaurada); } });
                registro.lineaRestaurada = lineaRestaurada;
                historialAcciones.push({ tipo: 'linea', elemento: lineaRestaurada });
            });
        }
        historialRehacer.push(accion);
        mostrarToast("Borrado deshecho");
        return;
    }
    if (!accion.elemento) return;
    map.removeLayer(accion.elemento);
    quitarCapasExtra(accion.elemento);
    let grupo = [accion];
    if (accion.tipo === 'marcador' && accion.elemento.lineasAsociadas && accion.elemento.lineasAsociadas.length) {
        accion.elemento.lineasAsociadas.forEach(linea => {
            map.removeLayer(linea);
            quitarCapasExtra(linea);
            historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
            grupo.push({ tipo: 'linea', elemento: linea });
        });
        const ultimo = historialAcciones.slice().reverse().find(i => i.tipo === 'marcador' && i.submodo === 'ruta');
        ultimoPuntoTramo = ultimo ? ultimo.elemento.getLatLng() : null;
        ultimoMarcadorTramo = ultimo ? ultimo.elemento : null;
    }
    historialRehacer.push(grupo);
    mostrarToast("Deshecho");
}

function rehacerProximo() {
    if (historialRehacer.length === 0) { mostrarToast("Nada que rehacer"); return; }
    const item = historialRehacer.pop();
    if (!item) return;
    if (!Array.isArray(item) && item.tipo === 'borrado') {
        if (item.restaurar) { item.restaurar.forEach(r => { map.removeLayer(r.elemento); quitarCapasExtra(r.elemento); historialAcciones = historialAcciones.filter(x => x.elemento !== r.elemento); }); }
        if (item.sesionPrecisa) {
            item.sesionPrecisa.marcadores.forEach(m => { map.removeLayer(m.elemento); historialAcciones = historialAcciones.filter(x => x.elemento !== m.elemento); });
            item.sesionPrecisa.comentarios.forEach(c => { map.removeLayer(c.elemento); historialAcciones = historialAcciones.filter(x => x.elemento !== c.elemento); });
            item.sesionPrecisa.reemplazosLinea.forEach(registro => {
                if (registro.lineaRestaurada) { map.removeLayer(registro.lineaRestaurada); quitarCapasExtra(registro.lineaRestaurada); historialAcciones = historialAcciones.filter(x => x.elemento !== registro.lineaRestaurada); }
                registro.actuales.forEach(l => { l.addTo(map); anadirCapasExtra(l); historialAcciones.push({ tipo: 'linea', elemento: l }); });
            });
        }
        historialAcciones.push(item);
        mostrarToast("Rehecho");
        return;
    }
    const grupo = Array.isArray(item) ? item : [item];
    grupo.forEach(accion => { accion.elemento.addTo(map); anadirCapasExtra(accion.elemento); historialAcciones.push(accion); });
    const accionMarcador = grupo.find(a => a.tipo === 'marcador');
    if (accionMarcador) { if (accionMarcador.submodo === 'ruta') { ultimoPuntoTramo = accionMarcador.elemento.getLatLng(); ultimoMarcadorTramo = accionMarcador.elemento; } }
    mostrarToast("Rehecho");
}

// ---- EXPORTAR GPX ----
function exportarGPX() {
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MapasApp" xmlns="http://www.topografix.com/GPX/1/1">\n';
    const lineas = historialAcciones.filter(item => item.tipo === 'linea');
    if (lineas.length) {
        gpx += '  <trk>\n    <name>Rutas</name>\n';
        lineas.forEach((item) => {
            const coords = item.elemento.getLatLngs();
            if (!coords || coords.length < 2) return;
            gpx += `    <trkseg>\n`;
            coords.forEach(ll => { gpx += `      <trkpt lat="${ll.lat}" lon="${ll.lng}"></trkpt>\n`; });
            gpx += `    </trkseg>\n`;
        });
        gpx += '  </trk>\n';
    }
    const marcadores = historialAcciones.filter(item => item.tipo === 'marcador');
    marcadores.forEach(item => { const ll = item.elemento.getLatLng(); gpx += `  <wpt lat="${ll.lat}" lon="${ll.lng}">\n    <name>${item.numero}</name>\n  </wpt>\n`; });
    const comentarios = historialAcciones.filter(item => item.tipo === 'comentario');
    comentarios.forEach(item => { const ll = item.elemento.getLatLng(); gpx += `  <wpt lat="${ll.lat}" lon="${ll.lng}">\n    <name>Comentario</name>\n    <desc>${item.texto}</desc>\n  </wpt>\n`; });
    gpx += '</gpx>';
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'mapa.gpx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarToast('GPX exportado');
}

// ---- EXPORTACIÓN PNG Y PDF ----
function cargarScriptExterno(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar la librería."));
        document.head.appendChild(script);
    });
}

async function capturarPNG() {
    mostrarToast("Capturando pantalla...");
    try {
        if (typeof html2canvas === 'undefined') {
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        }
        map.invalidateSize();
        map.fire('moveend');
        await new Promise(r => setTimeout(r, 250));
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 300));
        const canvas = await html2canvas(document.getElementById('map'), { useCORS: true, scale: 2, backgroundColor: null, logging: false });
        const link = document.createElement('a');
        link.download = 'mapa.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        mostrarToast("✅ PNG descargado");
    } catch (error) {
        mostrarToast("❌ Error al capturar PNG");
        console.error(error);
    }
}

async function exportarPDF() {
    mostrarToast("Generando PDF...");
    try {
        if (typeof html2canvas === 'undefined') {
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        }
        if (typeof window.jspdf === 'undefined') {
            await cargarScriptExterno('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        map.invalidateSize();
        map.fire('moveend');
        await new Promise(r => setTimeout(r, 250));
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 300));
        const canvas = await html2canvas(document.getElementById('map'), { useCORS: true, scale: 2, backgroundColor: null, logging: false });
        const imgData = canvas.toDataURL('image/png');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const pdfWidth = doc.internal.pageSize.getWidth();
        const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
        doc.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
        doc.save('mapa.pdf');
        mostrarToast("✅ PDF descargado");
    } catch (error) {
        mostrarToast("❌ Error al generar PDF");
        console.error(error);
    }
}

// ---- Funciones de GitHub ----
function obtenerToken() {
    let token = localStorage.getItem('github_token');
    if (!token) {
        alert("Vas a introducir un Token de GitHub. Recomendaciones:\n\n• Usa un token de acceso fino (\"fine-grained\") limitado SOLO al repositorio '" + GITHUB_REPO + "', con permiso de lectura/escritura de contenidos.\n• No uses tu contraseña ni un token con acceso a todos tus repos.\n• El token se guardará solo en este navegador (localStorage), nunca se envía a ningún servidor salvo a la API de GitHub.");
        token = prompt("Introduce tu Token de GitHub:");
        if (token) localStorage.setItem('github_token', token.trim());
    }
    return token;
}

function exportarDatosMapa() {
    const elementos = [];
    historialAcciones.forEach(item => {
        if (!item || !item.elemento) return;
        if (item.tipo === 'linea') {
            const conecta = [];
            if (item.elemento.marcadoresVinculados) {
                item.elemento.marcadoresVinculados.forEach(m => {
                    const entrada = historialAcciones.find(a => a.elemento === m);
                    if (entrada) conecta.push(entrada.numero);
                });
            }
            elementos.push({ type: "Feature", geometry: { type: "LineString", coordinates: item.elemento.getLatLngs().map(ll => [ll.lng, ll.lat]) }, properties: { tipo: "linea", color: item.elemento.options.color, weight: item.elemento.options.weight, opacity: item.elemento.options.opacity, conecta: conecta.length === 2 ? conecta : [] } });
        } else if (item.tipo === 'marcador') {
            const ll = item.elemento.getLatLng();
            elementos.push({ type: "Feature", geometry: { type: "Point", coordinates: [ll.lng, ll.lat] }, properties: { tipo: "marcador", numero: item.numero, submodo: item.submodo } });
        } else if (item.tipo === 'comentario') {
            const ll = item.elemento.getLatLng();
            elementos.push({ type: "Feature", geometry: { type: "Point", coordinates: [ll.lng, ll.lat] }, properties: { tipo: "comentario", texto: item.texto } });
        }
    });
    return { type: "FeatureCollection", features: elementos };
}

async function guardarEnGithub(nombreArchivo) {
    const token = obtenerToken();
    if (!token) return;
    const nombreSeguro = sanitizarNombreArchivo(nombreArchivo);
    if (!nombreSeguro) { alert("Nombre de archivo no válido."); return; }
    const path = `${GITHUB_FOLDER}/${nombreSeguro}.json`;
    const contenido = utf8ToBase64(JSON.stringify(exportarDatosMapa(), null, 2));
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;
    try {
        let sha = null;
        const resExist = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (resExist.ok) { const data = await resExist.json(); if (data.sha) { if (!confirm(`El mapa "${nombreSeguro}" ya existe. ¿Sobrescribir?`)) return; sha = data.sha; } }
        const body = { message: `Guardar mapa ${nombreSeguro}`, content: contenido };
        if (sha) body.sha = sha;
        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { alert("¡Guardado!"); cerrarModal(); }
        else { const err = await res.json().catch(() => ({})); alert("No se pudo guardar: " + (err.message || res.status)); }
    } catch (e) { alert("Error: " + e.message); }
}

async function abrirModalGithub(accion) {
    const token = obtenerToken();
    if (!token) return;
    const titulos = { guardar: 'Guardar mapa en GitHub', cargar: 'Abrir mapa desde GitHub', compartir: 'Compartir mapa' };
    const tituloEl = document.getElementById('modal-titulo');
    if (tituloEl) tituloEl.innerText = titulos[accion] || 'Mapas en GitHub';
    document.getElementById('modal-load').classList.add('active');
    const lista = document.getElementById('lista-mapas');
    lista.innerHTML = 'Cargando...';
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;
    try {
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        const archivos = res.ok ? await res.json() : [];
        const jsonFiles = Array.isArray(archivos) ? archivos.filter(f => f.name.endsWith('.json')) : [];
        lista.innerHTML = '';
        if (accion === 'guardar') {
            const btnNuevo = document.createElement('button');
            btnNuevo.className = 'btn btn-primary';
            btnNuevo.style.cssText = 'width:100%; margin-bottom:10px; border-radius:6px;';
            btnNuevo.textContent = '+ Nuevo...';
            btnNuevo.addEventListener('click', promptGuardarNuevo);
            lista.appendChild(btnNuevo);
        }
        if (jsonFiles.length === 0) {
            if (accion !== 'guardar') lista.innerHTML = 'No hay mapas guardados.';
            return;
        }
        jsonFiles.forEach(file => {
            const nombreBase = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #ddd; padding-bottom:6px;';
            const nombreSpan = document.createElement('span');
            nombreSpan.style.fontWeight = '600';
            nombreSpan.textContent = nombreBase;
            const btn = document.createElement('button');
            btn.style.borderRadius = '6px';
            if (accion === 'guardar') {
                btn.className = 'btn btn-primary';
                btn.textContent = 'Sobrescribir';
                btn.addEventListener('click', () => guardarEnGithub(nombreBase));
            } else if (accion === 'cargar') {
                btn.className = 'btn';
                btn.style.background = '#e0e0e0';
                btn.textContent = 'Cargar';
                btn.addEventListener('click', () => cargarMapaDesdeGithub(file.name));
            } else if (accion === 'compartir') {
                btn.className = 'btn btn-yellow';
                btn.textContent = 'Link';
                btn.addEventListener('click', () => compartirMapaEspecifico(file.name));
            }
            item.appendChild(nombreSpan);
            item.appendChild(btn);
            lista.appendChild(item);
        });
    } catch (e) { lista.innerHTML = "Error de conexión con GitHub"; }
}

function promptGuardarNuevo() { const n = prompt("Nombre del mapa:"); if (n) guardarEnGithub(n); }
function cerrarModal() { document.getElementById('modal-load').classList.remove('active'); }

async function cargarMapaDesdeGithub(fileName) {
    const nombreSeguro = sanitizarNombreArchivo(fileName);
    if (!nombreSeguro) { alert("Nombre de archivo no válido."); return; }
    const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${GITHUB_FOLDER}/${nombreSeguro}?t=${Date.now()}`;
    try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
            if (res.status === 404) { alert("No se ha encontrado ese mapa. Espera unos segundos y vuelve a intentarlo."); return; }
            else { alert(`No se ha podido cargar el mapa (error ${res.status}).`); return; }
        }
        let geojson;
        try { geojson = await res.json(); } catch (errorParseo) { alert("El archivo del mapa no tiene un formato válido."); return; }
        if (!geojson || !Array.isArray(geojson.features)) { alert("El archivo del mapa no contiene datos."); return; }
        const capasAQuitar = [];
        map.eachLayer(function(capa) { if (!(capa instanceof L.TileLayer)) capasAQuitar.push(capa); });
        capasAQuitar.forEach(capa => map.removeLayer(capa));
        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
        ultimoMarcadorTramo = null;
        procesarYAnadirGeoJSON(geojson, map);
        cerrarModal();
        mostrarToast("¡Mapa cargado!");
    } catch (e) { alert("Error al cargar el mapa: " + e.message); }
}

async function compartirMapaEspecifico(fileName) {
    const nombreSeguro = sanitizarNombreArchivo(fileName);
    if (!nombreSeguro) { alert("Nombre de archivo no válido."); return; }
    const link = `${window.location.href.split('?')[0]}?mapa=${nombreSeguro}`;
    if (navigator.share) { try { await navigator.share({ title: 'Ruta', url: link }); cerrarModal(); return; } catch (e) {} }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(link)}`, '_blank');
    cerrarModal();
}

function procesarYAnadirGeoJSON(geojson, mapInstance) {
    const marcadoresPorNumero = {};
    const lineasConConecta = [];
    geojson.features.forEach(f => {
        if (f.properties.tipo === 'linea') {
            const ll = f.geometry.coordinates.map(c => [c[1], c[0]]);
            const l = L.polyline(ll, { color: f.properties.color || '#3388ff', weight: f.properties.weight !== undefined ? f.properties.weight : 4, opacity: f.properties.opacity !== undefined ? f.properties.opacity : 1, interactive: true }).addTo(mapInstance);
            anadirZonaDeToque(l, ll, mapInstance, "Línea borrada");
            historialAcciones.push({ tipo: 'linea', elemento: l });
            if (f.properties.conecta && f.properties.conecta.length === 2) lineasConConecta.push({ linea: l, conecta: f.properties.conecta });
        } else if (f.properties.tipo === 'marcador') {
            const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const m = L.marker(latlng, { icon: L.divIcon({ className: 'number-icon', html: `<span>${f.properties.numero}</span>`, iconSize: [28,28], iconAnchor:[14,14] }), interactive: true }).addTo(mapInstance);
            m.on('click', ev => { if (modoActual === 'borrar' && !borradoPreciso) { L.DomEvent.stopPropagation(ev); eliminarMarcadorYLineas(m, "Punto borrado"); } });
            historialAcciones.push({ tipo: 'marcador', elemento: m, numero: f.properties.numero, submodo: f.properties.submodo || 'ruta' });
            marcadoresPorNumero[f.properties.numero] = m;
        } else if (f.properties.tipo === 'comentario') {
            const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const icon = L.divIcon({ className: 'comentario-icon', html: '💬', iconSize: [30, 30], iconAnchor: [15, 30] });
            const m = L.marker(latlng, { icon: icon, interactive: true }).addTo(mapInstance);
            m.bindPopup(`<b>Comentario:</b><br>${f.properties.texto || ''}`);
            m.on('click', function(ev) { if (modoActual === 'borrar' && !borradoPreciso) { L.DomEvent.stopPropagation(ev); eliminarComentario(this, "Comentario borrado"); } });
            historialAcciones.push({ tipo: 'comentario', elemento: m, texto: f.properties.texto || '' });
        }
    });
    lineasConConecta.forEach(({ linea, conecta }) => {
        const m1 = marcadoresPorNumero[conecta[0]];
        const m2 = marcadoresPorNumero[conecta[1]];
        if (m1 && m2) vincularLineaEntreMarcadores(m1, m2, linea);
    });
    const grupo = L.featureGroup();
    historialAcciones.forEach(item => { if (item.elemento) grupo.addLayer(item.elemento); });
    enfocarMapaEnGrupo(grupo, mapInstance);
}

function enfocarMapaEnGrupo(grupoCapas, mapInstance) {
    if (grupoCapas.getLayers().length > 0) {
        let limites = grupoCapas.getBounds();
        mapInstance.fitBounds(limites, { padding: [50, 50], maxZoom: 16 });
    }
}

// ============================================
//   LÓGICA DE GEOCÓDIFICACIÓN Y TRAZADO (CON TIMEOUT A 5s Y AVISOS DE PROGRESO)
// ============================================
const CORDOBA_CENTRO = L.latLng(37.8882, -4.7794);
const RADIO_MAXIMO_METROS = 10000; // 10 km
const RADIO_PRIMERA_CALLE_METROS = 10000;

async function geocodificarListado(nombres, centroInicial) {
    const resultados = nombres.map(nombre => ({ nombre, latlng: null }));
    let centroRuta = centroInicial || null;
    const cacheLocal = {};
    let procesadas = 0;
    const total = nombres.length;
    
    for (let i = 0; i < total; i++) {
        const nombre = nombres[i];
        const centroReferencia = centroRuta || CORDOBA_CENTRO;
        const radioAplicable = centroRuta ? RADIO_MAXIMO_METROS : RADIO_PRIMERA_CALLE_METROS;
        const claveCache = nombre.toLowerCase();
        let latlng = null;

        // Mostrar progreso cada 5 calles
        if (procesadas % 5 === 0 && procesadas > 0) {
            mostrarToast(`Geocodificando... ${procesadas}/${total}`);
        }

        if (cacheLocal[claveCache] !== undefined) {
            // Ya se buscó este mismo nombre antes en este listado: se reutiliza sin volver a pedirlo
            latlng = cacheLocal[claveCache];
            if (latlng && latlng.distanceTo(centroReferencia) > radioAplicable) latlng = null;
        } else {
            // Timeout de 6 segundos para cada búsqueda (más generoso en móvil)
            try {
                latlng = await Promise.race([
                    geocodificarUnaCalleNominatim(nombre, centroReferencia, radioAplicable),
                    new Promise(resolve => setTimeout(resolve, 6000))
                ]);
                if (latlng && latlng.distanceTo(centroReferencia) > radioAplicable) {
                    latlng = null;
                }
            } catch (e) {
                latlng = null;
            }
            cacheLocal[claveCache] = latlng;
        }

        resultados[i].latlng = latlng;
        if (!centroRuta && latlng) centroRuta = latlng;

        procesadas++;
        // Pequeña pausa para no saturar la API
        await new Promise(r => setTimeout(r, 100));
    }
    return { resultados, centroRuta };
}

async function geocodificarUnaCalleNominatim(nombre, centroReferencia, radioMetros, intentos = 2) {
    const nombreLimpio = limpiarLineaOCR(nombre);
    const variantesNombre = generarVariantesNombreCalle(nombreLimpio);

    for (const variante of variantesNombre) {
        // 1) Consulta ESTRUCTURADA: se le dice a Nominatim explícitamente qué es la calle y qué la
        // ciudad, en vez de una frase libre — mucho más precisa para encontrar la calle exacta.
        const url1 = `https://nominatim.openstreetmap.org/search?format=json&street=${encodeURIComponent(variante)}&city=Córdoba&country=España&countrycodes=es&limit=5`;
        const punto1 = await intentarGeocodificar(url1, centroReferencia, radioMetros, intentos);
        if (punto1) return punto1;

        // 2) Consulta libre, como red de seguridad si la estructurada no encuentra nada
        const url2 = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(variante + ', Córdoba, España')}&countrycodes=es&limit=5`;
        const punto2 = await intentarGeocodificar(url2, centroReferencia, radioMetros, intentos);
        if (punto2) return punto2;

        await new Promise(r => setTimeout(r, 300)); // pausa entre variantes, para no saturar Nominatim
    }
    return null;
}

async function intentarGeocodificar(url, centroReferencia, radioMetros, intentos) {
    for (let intento = 1; intento <= intentos; intento++) {
        try {
            const res = await fetch(url);
            if (res.status === 429) {
                await new Promise(r => setTimeout(r, 2000 * intento));
                continue;
            }
            if (!res.ok) return null;
            const data = await res.json();
            if (data && data.length > 0) {
                // Se revisan TODOS los candidatos que devuelve Nominatim (antes solo se miraba el
                // primero): si el primero cae fuera del radio permitido pero el segundo o tercero
                // sí encaja, ahora se encuentra igualmente.
                for (const candidato of data) {
                    const punto = L.latLng(parseFloat(candidato.lat), parseFloat(candidato.lon));
                    if (punto.distanceTo(centroReferencia) <= radioMetros) {
                        return punto;
                    }
                }
            }
            return null;
        } catch (e) {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return null;
}

// Genera variantes razonables del nombre de una calle: sin prefijo, con "Calle" delante, y con
// abreviaturas típicas (Avda., Pza., Po., Ctra., Trav., C/) expandidas a su forma completa —
// Nominatim reconoce mucho mejor "Avenida" que "Avda." en muchos casos, y viceversa en otros,
// así que se prueban ambas formas.
function generarVariantesNombreCalle(nombreLimpio) {
    const sinPrefijo = nombreLimpio
        .replace(/^(c\/|cl\.?|calle)\s*/i, '')
        .replace(/^(avda\.?|av\.?|avenida)\s*/i, '')
        .replace(/^(pza\.?|plaza)\s*/i, '')
        .replace(/^(po\.?|paseo)\s*/i, '')
        .replace(/^(ctra\.?|carretera)\s*/i, '')
        .replace(/^(trav\.?|travesía|travesia)\s*/i, '')
        .trim();

    const variantes = new Set([nombreLimpio, sinPrefijo, `Calle ${sinPrefijo}`]);

    const expansiones = [
        [/^avda\.?\s*/i, 'Avenida '],
        [/^av\.?\s*/i, 'Avenida '],
        [/^pza\.?\s*/i, 'Plaza '],
        [/^po\.?\s*/i, 'Paseo '],
        [/^ctra\.?\s*/i, 'Carretera '],
        [/^trav\.?\s*/i, 'Travesía '],
        [/^c\/\s*/i, 'Calle ']
    ];
    expansiones.forEach(([patron, reemplazo]) => {
        if (patron.test(nombreLimpio)) variantes.add(nombreLimpio.replace(patron, reemplazo));
    });

    return Array.from(variantes).filter(v => v && v.length > 1);
}

async function procesarListadoCalles(lineas, event) {
    if (lineas.length === 0) { mostrarToast("Listado vacío"); if (event) event.target.value = ''; return; }
    
    mostrarToast(`Geocodificando ${lineas.length} calles...`);
    let { resultados: entradas, centroRuta } = await geocodificarListado(lineas);
    
    let indicesFallidos = entradas.map((e, i) => i).filter(i => entradas[i].latlng === null);
    if (indicesFallidos.length > 0) {
        const nombresFallidos = indicesFallidos.map(i => entradas[i].nombre);
        const corregidas = await mostrarModalEdicionOCR(nombresFallidos, { 
            titulo: 'Calles no reconocidas', 
            mensaje: `Estas calles no se han podido localizar. Corrígelas o bórralas.`, 
            textoBoton: 'Reintentar' 
        });
        if (corregidas && corregidas.length > 0) {
            const { resultados: reintento } = await geocodificarListado(corregidas, centroRuta);
            reintento.forEach((r, idx) => {
                if (idx < indicesFallidos.length) { entradas[indicesFallidos[idx]] = r; } else { entradas.push(r); }
            });
        }
    }
    
    let puntosCoordenadas = [];
    entradas.forEach(e => {
        if (!e.latlng) return;
        if (puntosCoordenadas.length === 0 || puntosCoordenadas[puntosCoordenadas.length - 1].latlng.distanceTo(e.latlng) > 20) {
            puntosCoordenadas.push({ latlng: e.latlng, nombre: e.nombre });
        }
    });
    
    const noReconocidasFinal = entradas.filter(e => !e.latlng).map(e => e.nombre);
    
    // AVISO VISIBLE DE CALLES FALLIDAS
    if (noReconocidasFinal.length > 0) { 
        console.log("[Debug] Calles descartadas:", noReconocidasFinal);
        mostrarToast(`⚠️ ${noReconocidasFinal.length} calles no se han podido localizar. Revisa el listado.`);
    }
    
    if (puntosCoordenadas.length === 0) { 
        mostrarToast("No se encontró ninguna calle en Córdoba."); 
        if (event) event.target.value = ''; 
        return; 
    }
    
    console.log(`[Debug] Puntos encontrados: ${puntosCoordenadas.length}`);
    mostrarToast(`Encontradas ${puntosCoordenadas.length} calles. Dibujando ruta...`);
    
    let grupoCapas = L.featureGroup();
    let ultimoPunto = null;
    let ultimoMarcador = null;
    let tramosSinRuta = [];
    const estilos = obtenerEstilosActuales();
    
    for (let i = 0; i < puntosCoordenadas.length; i++) {
        const pt = puntosCoordenadas[i];
        const num = obtenerSiguienteNumeroDisponible();
        const icon = L.divIcon({ className: 'number-icon', html: `<span>${num}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
        const marker = L.marker(pt.latlng, { icon: icon, draggable: true, interactive: true }).addTo(map);
        grupoCapas.addLayer(marker);
        if (ultimoPunto) {
            const coordsRuta = await obtenerRutaPorCallesOSRM(ultimoPunto, pt.latlng);
            let linea, zonaToque;
            if (coordsRuta && coordsRuta.length > 0) {
                linea = L.polyline(coordsRuta, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                zonaToque = anadirZonaDeToque(linea, coordsRuta, map, "Tramo borrado");
                console.log(`[Debug] Ruta OSRM dibujada: ${puntosCoordenadas[i-1].nombre} a ${pt.nombre}`);
            } else {
                const coordsLineaRecta = [ultimoPunto, pt.latlng];
                linea = L.polyline(coordsLineaRecta, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                zonaToque = anadirZonaDeToque(linea, coordsLineaRecta, map, "Tramo borrado");
                tramosSinRuta.push(`${puntosCoordenadas[i - 1].nombre} → ${pt.nombre}`);
                console.log(`[Debug] Línea recta dibujada (OSRM falló): ${puntosCoordenadas[i-1].nombre} a ${pt.nombre}`);
            }
            if (ultimoMarcador) vincularLineaEntreMarcadores(ultimoMarcador, marker, linea);
            historialAcciones.push({ tipo: 'linea', elemento: linea });
            grupoCapas.addLayer(linea);
            grupoCapas.addLayer(zonaToque);
        }
        ultimoPunto = pt.latlng;
        ultimoMarcador = marker;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: 'ruta' });
    }
    historialRehacer = [];
    enfocarMapaEnGrupo(grupoCapas, map);
    if (tramosSinRuta.length > 0) {
        console.log("[Debug] Tramos sin ruta OSRM:", tramosSinRuta);
        mostrarToast("Algunos tramos son líneas rectas");
    } else {
        mostrarToast("Ruta trazada con éxito!");
    }
    if (event) event.target.value = '';
}

// ---- Funciones auxiliares ----
function mostrarModalEdicionOCR(lineasIniciales, opciones) {
    opciones = opciones || {};
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-ocr');
        const textarea = document.getElementById('texto-ocr');
        const titulo = document.getElementById('titulo-ocr');
        const mensaje = document.getElementById('mensaje-ocr');
        const btnContinuar = document.getElementById('btn-ocr-continuar');
        const btnCancelar = document.getElementById('btn-ocr-cancelar');
        titulo.innerText = opciones.titulo || 'Revisa el listado de calles';
        mensaje.innerText = opciones.mensaje || 'Corrige lo que el OCR haya leído mal (una calle por línea) y luego pulsa "Trazar ruta".';
        btnContinuar.innerText = opciones.textoBoton || 'Trazar ruta';
        textarea.value = lineasIniciales.join('\n');
        modal.classList.add('active');
        const limpiar = () => {
            modal.classList.remove('active');
            btnContinuar.removeEventListener('click', onContinuar);
            btnCancelar.removeEventListener('click', onCancelar);
        };
        const onContinuar = () => {
            const lineasEditadas = textarea.value.split('\n').map(l => l.trim()).filter(l => l.length > 2);
            limpiar();
            resolve(lineasEditadas);
        };
        const onCancelar = () => {
            limpiar();
            resolve(null);
        };
        btnContinuar.addEventListener('click', onContinuar);
        btnCancelar.addEventListener('click', onCancelar);
    });
}

function cerrarModalExport() { document.getElementById('modal-export').classList.remove('active'); }