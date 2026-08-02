const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

// ---- Funciones de utilidad ----

function sanitizarNombreArchivo(nombre) {
    if (!nombre) return '';
    return nombre.replace(/\.\./g, '').replace(/[\/\\]/g, '').trim();
}

function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// ---- Captura global de errores ----
window.addEventListener('error', function(ev) {
    console.error('Error no capturado:', ev.error || ev.message);
    if (typeof mostrarToast === 'function') {
        mostrarToast('⚠️ Error: ' + (ev.message || 'algo ha fallado, revisa la consola'));
    }
});
window.addEventListener('unhandledrejection', function(ev) {
    console.error('Promesa rechazada sin capturar:', ev.reason);
    if (typeof mostrarToast === 'function') {
        mostrarToast('⚠️ Error: ' + (ev.reason && ev.reason.message ? ev.reason.message : 'algo ha fallado, revisa la consola'));
    }
});

let map;
let modoActual = 'ruta';
let drawnItems; // <--- AÑADIDO para que funcionen Guardar/Compartir

let historialAcciones = [];
let historialRehacer = [];

let ultimoPuntoTramo = null; 
let ultimoMarcadorTramo = null;
let trazoLibreActivo = false;

let borradoPreciso = false;
let borradoPrecisoActivo = false;
let ultimoPuntoBorrado = null;
const RADIO_BORRADO_PRECISO_METROS = 6;

// --- Función para obtener el menor número libre (reutiliza huecos) ---
function obtenerSiguienteNumeroDisponible() {
    const numerosUsados = new Set();
    historialAcciones.forEach(item => {
        if (item.tipo === 'marcador' && item.numero) {
            numerosUsados.add(item.numero);
        }
    });
    let i = 1;
    while (numerosUsados.has(i)) i++;
    return i;
}

// --- Helpers de vínculo marcador<->línea ---
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

// ---- Eliminar comentario (similar a marcador) ----
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

// --- Flechas de dirección ---
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
    const zonaToque = L.polyline(coordenadas, {
        color: '#000000',
        weight: pesoToque,
        opacity: 0,
        interactive: true,
        bubblingMouseEvents: false
    }).addTo(mapaInstancia);

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
    // Borrar marcadores
    const marcadoresActuales = historialAcciones.filter(item => item.tipo === 'marcador').map(item => item.elemento);
    marcadoresActuales.forEach(marcador => {
        if (marcador.getLatLng().distanceTo(latlngCentro) <= radioMetros) {
            const entradaMarcador = historialAcciones.find(item => item.tipo === 'marcador' && item.elemento === marcador);
            desvincularYQuitarMarcador(marcador);
            sesion.marcadores.push({
                elemento: marcador,
                numero: entradaMarcador ? entradaMarcador.numero : null,
                submodo: entradaMarcador ? entradaMarcador.submodo : 'ruta'
            });
        }
    });

    // Borrar comentarios
    const comentariosActuales = historialAcciones.filter(item => item.tipo === 'comentario').map(item => item.elemento);
    comentariosActuales.forEach(comentario => {
        if (comentario.getLatLng().distanceTo(latlngCentro) <= radioMetros) {
            const entradaComentario = historialAcciones.find(item => item.tipo === 'comentario' && item.elemento === comentario);
            map.removeLayer(comentario);
            historialAcciones = historialAcciones.filter(item => item.elemento !== comentario);
            sesion.comentarios.push({
                elemento: comentario,
                texto: entradaComentario ? entradaComentario.texto : ''
            });
        }
    });

    // Borrar líneas (código existente)
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

let sesionBorradoPrecisoActual = null;

function iniciarBorradoPreciso(latlng) {
    borradoPrecisoActivo = true;
    map.dragging.disable();
    // También desactivamos otros controles táctiles para evitar que interfieran
    map.touchZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    
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
            const inter = L.latLng(
                ultimoPuntoBorrado.lat + (latlng.lat - ultimoPuntoBorrado.lat) * t,
                ultimoPuntoBorrado.lng + (latlng.lng - ultimoPuntoBorrado.lng) * t
            );
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

document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: false,
        touchZoom: true,
        doubleClickZoom: false,
        tap: false 
    }).setView([37.8882, -4.7794], 13);

    // --- AÑADIDO PARA QUE FUNCIONE EL GUARDADO Y COMPARTIR ---
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

    // --- CORRECCIÓN DE BÚSQUEDA: USAR KEYDOWN EN LUGAR DE KEYPRESS ---
    document.getElementById('search-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const query = this.value.trim();
            if (!query) {
                mostrarToast("Escribe el nombre de una calle");
                return;
            }
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
                        window._marcadorBusqueda = L.marker([lat, lon], {
                            icon: L.divIcon({ className: 'number-icon', html: '📍', iconSize: [28,28], iconAnchor:[14,14] })
                        }).addTo(map);
                        mostrarToast(`Encontrado: ${data[0].display_name}`);
                    } else {
                        mostrarToast("No se encontró la calle");
                    }
                })
                .catch(() => mostrarToast("Error en la búsqueda"));
        }
    });

    // --- AÑADIDO: LISTENER PARA DESCARGAR GEOJSON ---
    document.getElementById('btn-save').addEventListener('click', function() {
        var data = drawnItems.toGeoJSON();
        var blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'mis_rutas.geojson';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        mostrarToast('💾 GeoJSON descargado');
    });

    // --- AÑADIDO: LISTENER PARA COMPARTIR (PORTAPAPELES) ---
    document.getElementById('btn-share').addEventListener('click', function() {
        var data = drawnItems.toGeoJSON();
        var jsonStr = JSON.stringify(data);
        if (navigator.clipboard) {
            navigator.clipboard.writeText(jsonStr).then(function() {
                mostrarToast('📋 Datos copiados al portapapeles');
            }, function(err) {
                mostrarToast('❌ No se pudo copiar');
                console.log(jsonStr);
            });
        } else {
            mostrarToast('❌ Portapapeles no soportado');
        }
    });

    // Cargar mapa compartido
    const urlParams = new URLSearchParams(window.location.search);
    const mapaCompartido = urlParams.get('mapa');
    if (mapaCompartido) cargarMapaDesdeGithub(mapaCompartido);
});

function setModo(modo) {
    modoActual = modo;
    map.dragging.enable();
    
    const botones = {
        'ruta': 'btn-ruta',
        'aislado': 'btn-aislado',
        'dibujar_puntos': 'btn-puntos-rectos',
        'continuo': 'btn-continuo',
        'borrar': 'btn-borrar',
        'comentario': 'btn-comentario'
    };

    for (let [m, id] of Object.entries(botones)) {
        const el = document.getElementById(id);
        if (el) {
            el.className = 'btn';
            if (modoActual === m) {
                el.classList.add(m === 'borrar' ? 'btn-active-red' : 'btn-active-blue');
            }
        }
    }

    if (modo !== 'ruta') {
        ultimoPuntoTramo = null;
    }

    // Desactivar arrastre de marcadores en modo borrar (mejor para táctil)
    historialAcciones.forEach(item => {
        if (item.tipo === 'marcador' && item.elemento && item.elemento.dragging) {
            if (modoActual === 'borrar') item.elemento.dragging.disable();
            else item.elemento.dragging.enable();
        }
    });

    const mensajes = {
        'ruta': "Modo: Callejero OSRM",
        'aislado': "Modo: Puntos Aislados",
        'dibujar_puntos': "Modo: Punto a punto rectos",
        'continuo': "Modo: Mano alzada continua",
        'borrar': "Modo: Borrar elementos",
        'comentario': "Modo: Añadir comentario (pulsa en el mapa)"
    };
    mostrarToast(mensajes[modo] || "");
}

function obtenerEstilosActuales() {
    const colorInput = document.getElementById('color-trazo');
    const grosorInput = document.getElementById('grosor-trazo');
    const opacidadInput = document.getElementById('opacidad-trazo');

    return { 
        color: colorInput ? colorInput.value : '#3388ff', 
        weight: grosorInput ? parseInt(grosorInput.value, 10) || 4 : 4, 
        opacity: opacidadInput ? parseFloat(opacidadInput.value) || 1 : 1 
    };
}

function manejarCambioEstiloDinamico() {
    const selectorAmbito = document.getElementById('ambito-estilo');
    const ambito = selectorAmbito ? selectorAmbito.value : 'todos';
    const estilos = obtenerEstilosActuales();

    if (ambito === 'todos') {
        historialAcciones.forEach(item => {
            if (item.tipo === 'linea' && item.elemento && typeof item.elemento.setStyle === 'function') {
                item.elemento.setStyle({
                    color: estilos.color,
                    weight: estilos.weight,
                    opacity: estilos.opacity
                });
            }
        });
    } else if (ambito === 'ultimo') {
        const ultimaLinea = historialAcciones.slice().reverse().find(item => item.tipo === 'linea' && item.elemento);
        if (ultimaLinea && typeof ultimaLinea.elemento.setStyle === 'function') {
            ultimaLinea.elemento.setStyle({
                color: estilos.color,
                weight: estilos.weight,
                opacity: estilos.opacity
            });
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

// ---- Búsqueda de calles (modal) ----
function mostrarModalBuscar() {
    document.getElementById('modal-buscar').style.display = 'flex';
    document.getElementById('input-buscar-calle').focus();
}

function cerrarModalBuscar() {
    document.getElementById('modal-buscar').style.display = 'none';
}

async function buscarCalle() {
    const input = document.getElementById('input-buscar-calle');
    const query = input.value.trim();
    if (!query) {
        mostrarToast("Escribe el nombre de una calle");
        return;
    }

    mostrarToast("Buscando...");
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Córdoba, España')}&countrycodes=es&limit=1`;
        const res = await fetch(url);
        const data = await res.json();
        if (data && data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lon = parseFloat(data[0].lon);
            map.setView([lat, lon], 17);
            // Marcador temporal
            if (window._marcadorBusqueda) map.removeLayer(window._marcadorBusqueda);
            window._marcadorBusqueda = L.marker([lat, lon], {
                icon: L.divIcon({ className: 'number-icon', html: '📍', iconSize: [28,28], iconAnchor:[14,14] })
            }).addTo(map);
            mostrarToast(`Encontrado: ${data[0].display_name}`);
            cerrarModalBuscar();
        } else {
            mostrarToast("No se encontró la calle");
        }
    } catch (e) {
        mostrarToast("Error en la búsqueda");
        console.error(e);
    }
}

// ---- Añadir comentario ----
function crearComentario(latlng, texto) {
    const icon = L.divIcon({
        className: 'comentario-icon',
        html: '💬',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    const marker = L.marker(latlng, { icon: icon, interactive: true }).addTo(map);
    marker.bindPopup(`<b>Comentario:</b><br>${texto}`);

    // Evento para borrar con modo borrar (no preciso)
    marker.on('click', function(ev) {
        if (modoActual === 'borrar' && !borradoPreciso) {
            L.DomEvent.stopPropagation(ev);
            eliminarComentario(this, "Comentario borrado");
        }
    });

    historialAcciones.push({ tipo: 'comentario', elemento: marker, texto: texto });
    historialRehacer = [];
    mostrarToast("Comentario añadido");
}

// ---- Configuración de eventos táctiles y ratón (CORREGIDA PARA EVITAR ARRASTRE) ----
function configurarDibujoTactilTablet() {
    const mapaContenedor = map.getContainer();

    // Eventos para dibujo a mano alzada (continuo)
    mapaContenedor.addEventListener('touchstart', (e) => {
        if (modoActual !== 'continuo') return;
        if (e.touches.length > 1) { estaDibujandoLibre = false; return; }

        map.dragging.disable();
        estaDibujandoLibre = true;

        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        const estilos = obtenerEstilosActuales();
        
        polilineaContinuaActual = L.polyline([latlng], {
            color: estilos.color,
            weight: estilos.weight,
            opacity: estilos.opacity,
            smoothFactor: 1,
            interactive: true,
            bubblingMouseEvents: false
        }).addTo(map);

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
        if (estaDibujandoLibre) {
            estaDibujandoLibre = false;
            polilineaContinuaActual = null;
            map.dragging.enable();
        }
    };

    mapaContenedor.addEventListener('touchend', finalizarTrazoTablet);
    mapaContenedor.addEventListener('touchcancel', finalizarTrazoTablet);

    // Ratón
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

        polilineaContinuaActual = L.polyline([latlng], {
            color: estilos.color,
            weight: estilos.weight,
            opacity: estilos.opacity,
            smoothFactor: 1,
            interactive: true,
            bubblingMouseEvents: false
        }).addTo(map);

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

    // ---- BORRADO PRECISO: EVENTOS CORREGIDOS PARA BLOQUEAR EL ARRASTRE ----
    // Usamos 'passive: false' y L.DomEvent.preventDefault para evitar que el mapa se mueva
    mapaContenedor.addEventListener('touchstart', (e) => {
        if (modoActual !== 'borrar' || !borradoPreciso) return;
        if (e.touches.length > 1) return;
        // PREVENIR EL COMPORTAMIENTO POR DEFECTO (ARRASTRE)
        e.preventDefault();
        L.DomEvent.stopPropagation(e);
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        iniciarBorradoPreciso(latlng);
    }, { passive: false });

    mapaContenedor.addEventListener('touchmove', (e) => {
        if (!borradoPrecisoActivo) return;
        if (e.touches.length > 1) return;
        e.preventDefault();
        L.DomEvent.stopPropagation(e);
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        continuarBorradoPreciso(latlng);
    }, { passive: false });

    mapaContenedor.addEventListener('touchend', finalizarBorradoPreciso);
    mapaContenedor.addEventListener('touchcancel', finalizarBorradoPreciso);

    // Ratón para borrado preciso
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
        if (!window.puntosDibujoLibre || !trazoLibreActivo) {
            window.puntosDibujoLibre = [];
            trazoLibreActivo = true;
        }
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
            if (modoActual === 'borrar' && !borradoPreciso) {
                L.DomEvent.stopPropagation(ev);
                eliminarMarcadorYLineas(this, "Punto borrado");
            }
        });

        let avisoSinRuta = false;
        if (modoActual === 'ruta' && ultimoPuntoTramo) {
            const coords = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);
            if (coords && coords.length > 0) {
                const linea = L.polyline(coords, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(linea, coords, map, "Tramo borrado");
                if (ultimoMarcadorTramo) vincularLineaEntreMarcadores(ultimoMarcadorTramo, marker, linea);
                historialAcciones.push({ tipo: 'linea', elemento: linea });
            } else {
                avisoSinRuta = true;
            }
        }
        ultimoPuntoTramo = (modoActual === 'ruta') ? latlng : null;
        ultimoMarcadorTramo = (modoActual === 'ruta') ? marker : null;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: modoActual });
        historialRehacer = [];
        if (avisoSinRuta) mostrarToast("⚠️ No se encontró ruta a pie entre estos dos puntos: no se ha trazado nada");
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
    } catch (e) {
        console.error('Error en OSRM:', e);
    }
    return null;
}

function manejarArchivoGPX(event) {
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
                let grupoCapas = L.featureGroup();
                const estilos = obtenerEstilosActuales();
                const linea = L.polyline(coordenadas, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(linea, coordenadas, map, "GPX borrado");

                historialAcciones.push({ tipo: 'linea', elemento: linea });
                grupoCapas.addLayer(linea);
                historialRehacer = [];
                
                enfocarMapaEnGrupo(grupoCapas, map);
                mostrarToast("¡GPX importado con éxito!");
            } else {
                alert("No se han encontrado coordenadas válidas en el archivo GPX.");
            }
        } catch (err) {
            alert("Error al procesar el archivo GPX.");
        }
        event.target.value = '';
    };
    lector.readAsText(archivo);
}

function confirmarBorrarTodo() {
    if (confirm("¿Estás seguro de que quieres borrar todo el mapa? Se perderán todos los puntos, líneas y comentarios actuales.")) {
        const capasAQuitar = [];
        map.eachLayer(function(capa) {
            if (!(capa instanceof L.TileLayer)) {
                capasAQuitar.push(capa);
            }
        });
        capasAQuitar.forEach(capa => map.removeLayer(capa));

        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
        ultimoMarcadorTramo = null;
        window.puntosDibujoLibre = [];
        trazoLibreActivo = false;

        mostrarToast("Mapa borrado por completo");
    }
}

function deshacerUltimo() {
    if (historialAcciones.length === 0) {
        mostrarToast("Nada que deshacer");
        return;
    }
    const accion = historialAcciones.pop();
    if (!accion) return;

    if (accion.tipo === 'borrado') {
        if (accion.restaurar) {
            accion.restaurar.forEach(item => {
                if (item.tipo === 'marcador' && item.elemento) {
                    // Reasignar número si está ocupado
                    const numActual = item.numero;
                    const numerosUsados = new Set();
                    historialAcciones.forEach(i => {
                        if (i.tipo === 'marcador' && i.numero) numerosUsados.add(i.numero);
                    });
                    if (numerosUsados.has(numActual)) {
                        let nuevoNum = 1;
                        while (numerosUsados.has(nuevoNum)) nuevoNum++;
                        item.numero = nuevoNum;
                        item.elemento.setIcon(L.divIcon({
                            className: 'number-icon',
                            html: `<span>${nuevoNum}</span>`,
                            iconSize: [28, 28],
                            iconAnchor: [14, 14]
                        }));
                    }
                }
                item.elemento.addTo(map);
                anadirCapasExtra(item.elemento);
                historialAcciones.push(item);
            });
        }
        if (accion.sesionPrecisa) {
            // Restaurar marcadores
            accion.sesionPrecisa.marcadores.forEach(m => {
                const numActual = m.numero;
                const numerosUsados = new Set();
                historialAcciones.forEach(i => {
                    if (i.tipo === 'marcador' && i.numero) numerosUsados.add(i.numero);
                });
                if (numerosUsados.has(numActual)) {
                    let nuevoNum = 1;
                    while (numerosUsados.has(nuevoNum)) nuevoNum++;
                    m.numero = nuevoNum;
                    m.elemento.setIcon(L.divIcon({
                        className: 'number-icon',
                        html: `<span>${nuevoNum}</span>`,
                        iconSize: [28, 28],
                        iconAnchor: [14, 14]
                    }));
                }
                m.elemento.addTo(map);
                historialAcciones.push({ tipo: 'marcador', elemento: m.elemento, numero: m.numero, submodo: m.submodo });
            });
            // Restaurar comentarios
            accion.sesionPrecisa.comentarios.forEach(c => {
                c.elemento.addTo(map);
                historialAcciones.push({ tipo: 'comentario', elemento: c.elemento, texto: c.texto });
            });
            // Restaurar líneas
            accion.sesionPrecisa.reemplazosLinea.forEach(registro => {
                registro.actuales.forEach(l => {
                    map.removeLayer(l);
                    quitarCapasExtra(l);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== l);
                });
                const lineaRestaurada = L.polyline(registro.coordsOriginal, { color: registro.estiloOriginal.color, weight: registro.estiloOriginal.weight, opacity: registro.estiloOriginal.opacity, interactive: true }).addTo(map);
                anadirZonaDeToque(lineaRestaurada, registro.coordsOriginal, map, "Tramo borrado");
                lineaRestaurada.marcadoresVinculados = registro.marcadoresVinculadosOriginal;
                registro.marcadoresVinculadosOriginal.forEach(m => {
                    if (m.lineasAsociadas && !m.lineasAsociadas.includes(lineaRestaurada)) {
                        m.lineasAsociadas.push(lineaRestaurada);
                    }
                });
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
    if (historialRehacer.length === 0) {
        mostrarToast("Nada que rehacer");
        return;
    }
    const item = historialRehacer.pop();
    if (!item) return;

    if (!Array.isArray(item) && item.tipo === 'borrado') {
        if (item.restaurar) {
            item.restaurar.forEach(r => {
                map.removeLayer(r.elemento);
                quitarCapasExtra(r.elemento);
                historialAcciones = historialAcciones.filter(x => x.elemento !== r.elemento);
            });
        }
        if (item.sesionPrecisa) {
            item.sesionPrecisa.marcadores.forEach(m => {
                map.removeLayer(m.elemento);
                historialAcciones = historialAcciones.filter(x => x.elemento !== m.elemento);
            });
            item.sesionPrecisa.comentarios.forEach(c => {
                map.removeLayer(c.elemento);
                historialAcciones = historialAcciones.filter(x => x.elemento !== c.elemento);
            });
            item.sesionPrecisa.reemplazosLinea.forEach(registro => {
                if (registro.lineaRestaurada) {
                    map.removeLayer(registro.lineaRestaurada);
                    quitarCapasExtra(registro.lineaRestaurada);
                    historialAcciones = historialAcciones.filter(x => x.elemento !== registro.lineaRestaurada);
                }
                registro.actuales.forEach(l => {
                    l.addTo(map);
                    anadirCapasExtra(l);
                    historialAcciones.push({ tipo: 'linea', elemento: l });
                });
            });
        }
        historialAcciones.push(item);
        mostrarToast("Rehecho");
        return;
    }

    const grupo = Array.isArray(item) ? item : [item];
    grupo.forEach(accion => {
        accion.elemento.addTo(map);
        anadirCapasExtra(accion.elemento);
        historialAcciones.push(accion);
    });

    const accionMarcador = grupo.find(a => a.tipo === 'marcador');
    if (accionMarcador) {
        if (accionMarcador.submodo === 'ruta') {
            ultimoPuntoTramo = accionMarcador.elemento.getLatLng();
            ultimoMarcadorTramo = accionMarcador.elemento;
        }
    }
    mostrarToast("Rehecho");
}

// ---- EXPORTAR GPX ----
function exportarGPX() {
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="MapasApp" xmlns="http://www.topografix.com/GPX/1/1">\n';

    const lineas = historialAcciones.filter(item => item.tipo === 'linea');
    if (lineas.length) {
        gpx += '  <trk>\n    <name>Rutas</name>\n';
        lineas.forEach((item) => {
            const coords = item.elemento.getLatLngs();
            if (!coords || coords.length < 2) return;
            gpx += `    <trkseg>\n`;
            coords.forEach(ll => {
                gpx += `      <trkpt lat="${ll.lat}" lon="${ll.lng}"></trkpt>\n`;
            });
            gpx += `    </trkseg>\n`;
        });
        gpx += '  </trk>\n';
    }

    const marcadores = historialAcciones.filter(item => item.tipo === 'marcador');
    marcadores.forEach(item => {
        const ll = item.elemento.getLatLng();
        gpx += `  <wpt lat="${ll.lat}" lon="${ll.lng}">\n    <name>${item.numero}</name>\n  </wpt>\n`;
    });

    // Comentarios como waypoints con descripción
    const comentarios = historialAcciones.filter(item => item.tipo === 'comentario');
    comentarios.forEach(item => {
        const ll = item.elemento.getLatLng();
        gpx += `  <wpt lat="${ll.lat}" lon="${ll.lng}">\n    <name>Comentario</name>\n    <desc>${item.texto}</desc>\n  </wpt>\n`;
    });

    gpx += '</gpx>';

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mapa.gpx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    mostrarToast('GPX exportado');
}

// ---- NUEVAS FUNCIONES: EXPORTAR PNG Y PDF ----
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
            mostrarToast("Cargando librería de imágenes...");
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        }
        // Pequeña pausa para que Leaflet termine de renderizar (evita desfases)
        await new Promise(r => setTimeout(r, 250));
        const canvas = await html2canvas(document.getElementById('map'), { useCORS: true, scale: 2, backgroundColor: null });
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
            mostrarToast("Cargando librería de imágenes...");
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
        }
        if (typeof window.jspdf === 'undefined') {
            mostrarToast("Cargando librería de PDF...");
            await cargarScriptExterno('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        }
        // Pequeña pausa para que Leaflet termine de renderizar (evita desfases)
        await new Promise(r => setTimeout(r, 250));
        const canvas = await html2canvas(document.getElementById('map'), { useCORS: true, scale: 2, backgroundColor: null });
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
            elementos.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: item.elemento.getLatLngs().map(ll => [ll.lng, ll.lat]) },
                properties: { 
                    tipo: "linea", 
                    color: item.elemento.options.color, 
                    weight: item.elemento.options.weight, 
                    opacity: item.elemento.options.opacity,
                    conecta: conecta.length === 2 ? conecta : []
                }
            });
        } else if (item.tipo === 'marcador') {
            const ll = item.elemento.getLatLng();
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: { tipo: "marcador", numero: item.numero, submodo: item.submodo }
            });
        } else if (item.tipo === 'comentario') {
            const ll = item.elemento.getLatLng();
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: { tipo: "comentario", texto: item.texto }
            });
        }
    });
    return { type: "FeatureCollection", features: elementos };
}

async function guardarEnGithub(nombreArchivo) {
    const token = obtenerToken();
    if (!token) return;

    const nombreSeguro = sanitizarNombreArchivo(nombreArchivo);
    if (!nombreSeguro) {
        alert("Nombre de archivo no válido.");
        return;
    }

    const path = `${GITHUB_FOLDER}/${nombreSeguro}.json`;
    const contenido = utf8ToBase64(JSON.stringify(exportarDatosMapa(), null, 2));
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        let sha = null;
        const resExist = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (resExist.ok) {
            const data = await resExist.json();
            if (data.sha) {
                if (!confirm(`El mapa "${nombreSeguro}" ya existe. ¿Sobrescribir?`)) return;
                sha = data.sha;
            }
        }

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

    document.getElementById('modal-load').style.display = 'flex';
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
            btnNuevo.className = 'btn btn-blue';
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
                btn.className = 'btn btn-blue';
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

function promptGuardarNuevo() {
    const n = prompt("Nombre del mapa:");
    if (n) guardarEnGithub(n);
}

function cerrarModal() { document.getElementById('modal-load').style.display = 'none'; }

async function cargarMapaDesdeGithub(fileName) {
    const nombreSeguro = sanitizarNombreArchivo(fileName);
    if (!nombreSeguro) {
        alert("Nombre de archivo no válido.");
        return;
    }
    const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${GITHUB_FOLDER}/${nombreSeguro}?t=${Date.now()}`;
    try {
        const res = await fetch(url, { cache: 'no-store' });

        if (!res.ok) {
            if (res.status === 404) {
                alert("No se ha encontrado ese mapa. Si lo acabas de guardar, espera unos segundos (GitHub tarda un poco en publicarlo) y vuelve a intentarlo.");
            } else {
                alert(`No se ha podido cargar el mapa (error ${res.status}).`);
            }
            return;
        }

        let geojson;
        try {
            geojson = await res.json();
        } catch (errorParseo) {
            alert("El archivo del mapa no tiene un formato válido (no es un JSON legible) y no se ha podido leer.");
            return;
        }

        if (!geojson || !Array.isArray(geojson.features)) {
            alert("El archivo del mapa no contiene datos reconocibles.");
            return;
        }

        const capasAQuitar = [];
        map.eachLayer(function(capa) {
            if (!(capa instanceof L.TileLayer)) capasAQuitar.push(capa);
        });
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
    if (!nombreSeguro) {
        alert("Nombre de archivo no válido.");
        return;
    }
    const link = `${window.location.href.split('?')[0]}?mapa=${nombreSeguro}`;
    if (navigator.share) {
        try { await navigator.share({ title: 'Ruta', url: link }); cerrarModal(); return; } catch (e) {}
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(link)}`, '_blank');
    cerrarModal();
}

function procesarYAnadirGeoJSON(geojson, mapInstance) {
    const marcadoresPorNumero = {};
    const lineasConConecta = [];

    geojson.features.forEach(f => {
        if (f.properties.tipo === 'linea') {
            const ll = f.geometry.coordinates.map(c => [c[1], c[0]]);
            const l = L.polyline(ll, { 
                color: f.properties.color || '#3388ff', 
                weight: f.properties.weight !== undefined ? f.properties.weight : 4, 
                opacity: f.properties.opacity !== undefined ? f.properties.opacity : 1, 
                interactive: true 
            }).addTo(mapInstance);
            
            anadirZonaDeToque(l, ll, mapInstance, "Línea borrada");
            
            historialAcciones.push({ tipo: 'linea', elemento: l });
            if (f.properties.conecta && f.properties.conecta.length === 2) {
                lineasConConecta.push({ linea: l, conecta: f.properties.conecta });
            }
        } else if (f.properties.tipo === 'marcador') {
            const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const m = L.marker(latlng, { 
                icon: L.divIcon({ className: 'number-icon', html: `<span>${f.properties.numero}</span>`, iconSize: [28,28], iconAnchor:[14,14] }), 
                interactive: true 
            }).addTo(mapInstance);
            
            m.on('click', ev => { 
                if (modoActual === 'borrar' && !borradoPreciso) { 
                    L.DomEvent.stopPropagation(ev); 
                    eliminarMarcadorYLineas(m, "Punto borrado");
                } 
            });
            
            historialAcciones.push({ tipo: 'marcador', elemento: m, numero: f.properties.numero, submodo: f.properties.submodo || 'ruta' });
            marcadoresPorNumero[f.properties.numero] = m;
        } else if (f.properties.tipo === 'comentario') {
            const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const icon = L.divIcon({
                className: 'comentario-icon',
                html: '💬',
                iconSize: [30, 30],
                iconAnchor: [15, 30]
            });
            const m = L.marker(latlng, { icon: icon, interactive: true }).addTo(mapInstance);
            m.bindPopup(`<b>Comentario:</b><br>${f.properties.texto || ''}`);
            m.on('click', function(ev) {
                if (modoActual === 'borrar' && !borradoPreciso) {
                    L.DomEvent.stopPropagation(ev);
                    eliminarComentario(this, "Comentario borrado");
                }
            });
            historialAcciones.push({ tipo: 'comentario', elemento: m, texto: f.properties.texto || '' });
        }
    });

    // Vincular líneas
    lineasConConecta.forEach(({ linea, conecta }) => {
        const m1 = marcadoresPorNumero[conecta[0]];
        const m2 = marcadoresPorNumero[conecta[1]];
        if (m1 && m2) {
            vincularLineaEntreMarcadores(m1, m2, linea);
        }
    });

    // Enfocar mapa
    const grupo = L.featureGroup();
    historialAcciones.forEach(item => {
        if (item.elemento) grupo.addLayer(item.elemento);
    });
    enfocarMapaEnGrupo(grupo, mapInstance);
}

function enfocarMapaEnGrupo(grupoCapas, mapInstance) {
    if (grupoCapas.getLayers().length > 0) {
        let limites = grupoCapas.getBounds();
        mapInstance.fitBounds(limites, {
            padding: [50, 50],
            maxZoom: 16
        });
    }
}

// ---- Procesar archivo de texto con calles (OCR y geocodificación) ----
async function procesarArchivoTextoRuta(event) {
    const archivo = event.target.files[0];
    if (!archivo) return;

    mostrarToast(`Leyendo listado de calles...`);

    const lector = new FileReader();
    lector.onload = async function(e) {
        const contenidoTexto = e.target.result;
        const lineas = contenidoTexto.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        await procesarListadoCalles(lineas, event);
    };

    lector.readAsText(archivo);
}

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
        modal.style.display = 'flex';

        const limpiar = () => {
            modal.style.display = 'none';
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

async function procesarImagenCalles(event) {
    const archivos = Array.from(event.target.files || []);
    if (archivos.length === 0) return;

    try {
        if (typeof Tesseract === 'undefined') {
            mostrarToast("Cargando motor de reconocimiento de texto (solo la primera vez)...");
            await cargarScriptExterno('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
        }

        const worker = await Tesseract.createWorker('spa', 1, {
            logger: m => {
                if (m.status === 'recognizing text' && typeof m.progress === 'number') {
                    mostrarToast(`Escaneando imagen ${indiceActual}/${archivos.length}... ${Math.round(m.progress * 100)}%`);
                }
            }
        });

        let indiceActual = 1;
        let todasLasLineas = [];
        let imagenesSinTexto = [];

        for (const archivo of archivos) {
            mostrarToast(`Escaneando imagen ${indiceActual}/${archivos.length}...`);
            const { data: { text } } = await worker.recognize(archivo);
            const lineasImagen = text.split('\n').map(l => l.trim()).filter(l => l.length > 2);

            if (lineasImagen.length === 0) {
                imagenesSinTexto.push(archivo.name || `imagen ${indiceActual}`);
            } else {
                todasLasLineas = todasLasLineas.concat(lineasImagen);
            }
            indiceActual++;
        }

        await worker.terminate();

        if (imagenesSinTexto.length > 0) {
            mostrarToast(`⚠️ No se pudo leer texto en: ${imagenesSinTexto.join(', ')}`);
        }

        if (todasLasLineas.length === 0) {
            mostrarToast("El OCR no ha detectado texto legible. Puedes escribir el listado a mano.");
        }

        const lineasEditadas = await mostrarModalEdicionOCR(todasLasLineas);
        if (!lineasEditadas || lineasEditadas.length === 0) {
            event.target.value = '';
            return;
        }

        await procesarListadoCalles(lineasEditadas, event);
    } catch (err) {
        alert("Error al escanear la imagen: " + err.message);
        event.target.value = '';
    }
}

const CORDOBA_CENTRO = L.latLng(37.8882, -4.7794);
const RADIO_MAXIMO_METROS = 3500;
const RADIO_PRIMERA_CALLE_METROS = 12000;

async function geocodificarListado(nombres, centroInicial) {
    const resultados = nombres.map(nombre => ({ nombre, latlng: null }));
    let centroRuta = centroInicial || null;
    const cacheLocal = {};

    for (let i = 0; i < resultados.length; i++) {
        const nombre = resultados[i].nombre;
        const centroReferencia = centroRuta || CORDOBA_CENTRO;
        const radioAplicable = centroRuta ? RADIO_MAXIMO_METROS : RADIO_PRIMERA_CALLE_METROS;
        const claveCache = nombre.toLowerCase();

        let latlng;
        if (cacheLocal[claveCache] !== undefined) {
            latlng = cacheLocal[claveCache];
            if (latlng && latlng.distanceTo(centroReferencia) > radioAplicable) latlng = null;
        } else {
            latlng = await geocodificarUnaCalleNominatim(nombre, centroReferencia, radioAplicable);
            cacheLocal[claveCache] = latlng;
        }

        resultados[i].latlng = latlng;
        if (!centroRuta && latlng) centroRuta = latlng;
    }

    return { resultados, centroRuta };
}

async function geocodificarUnaCalleNominatim(nombre, centroReferencia, radioMetros, intentos = 2) {
    let nombreLimpio = nombre
        .replace(/^(c\/|cl\.|calle)\s*/i, '')
        .replace(/^(avda\.|av\.|avenida)\s*/i, '')
        .replace(/^(pza\.|plaza)\s*/i, '')
        .trim();

    let variantesBusqueda = [
        `${nombre}, Córdoba, España`,
        `${nombreLimpio}, Córdoba, España`,
        `Calle ${nombreLimpio}, Córdoba, España`,
        `Calle ${nombre}, Córdoba, España`
    ];

    for (let query of variantesBusqueda) {
        for (let intento = 1; intento <= intentos; intento++) {
            try {
                const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=es&limit=1`;
                const res = await fetch(urlGeo);
                if (!res.ok) {
                    if (res.status === 429) {
                        await new Promise(r => setTimeout(r, 2000 * intento));
                        continue;
                    }
                    throw new Error(`HTTP ${res.status}`);
                }
                const datos = await res.json();
                if (datos && datos.length > 0) {
                    const lat = parseFloat(datos[0].lat);
                    const lon = parseFloat(datos[0].lon);
                    const nuevoPunto = L.latLng(lat, lon);
                    if (nuevoPunto.distanceTo(centroReferencia) <= radioMetros) {
                        return nuevoPunto;
                    }
                }
                break;
            } catch (err) {
                console.error(`Error en geocodificación (intento ${intento}):`, err);
                if (intento === intentos) {
                } else {
                    await new Promise(r => setTimeout(r, 1000 * intento));
                }
            }
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}

async function procesarListadoCalles(lineas, event) {
    if (lineas.length === 0) {
        alert("El listado está vacío o no contiene líneas válidas.");
        if (event) event.target.value = '';
        return;
    }

    mostrarToast(`Geocodificando ${lineas.length} calles en Córdoba (máx. 3,5 km desde la primera calle)...`);
    let { resultados: entradas, centroRuta } = await geocodificarListado(lineas);

    let indicesFallidos = entradas.map((e, i) => i).filter(i => entradas[i].latlng === null);

    if (indicesFallidos.length > 0) {
        const nombresFallidos = indicesFallidos.map(i => entradas[i].nombre);
        const corregidas = await mostrarModalEdicionOCR(nombresFallidos, {
            titulo: 'Calles no reconocidas',
            mensaje: `Estas ${nombresFallidos.length} calles no se han podido localizar en Córdoba (o quedaban a más de 3,5 km de la primera calle del recorrido). Corrígelas y pulsa "Reintentar", o bórralas/cancela para continuar sin ellas.`,
            textoBoton: 'Reintentar'
        });

        if (corregidas && corregidas.length > 0) {
            mostrarToast(`Reintentando geocodificar ${corregidas.length} calles corregidas...`);
            const { resultados: reintento, centroRuta: centroActualizado } = await geocodificarListado(corregidas, centroRuta);
            centroRuta = centroRuta || centroActualizado;
            reintento.forEach((r, idx) => {
                if (idx < indicesFallidos.length) {
                    entradas[indicesFallidos[idx]] = r;
                } else {
                    entradas.push(r);
                }
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
    if (noReconocidasFinal.length > 0) {
        alert(`⚠️ Estas calles no se han podido localizar y se han descartado de la ruta:\n\n- ${noReconocidasFinal.join('\n- ')}`);
    }

    if (puntosCoordenadas.length === 0) {
        alert("No se ha podido trazar ninguna ruta porque ninguna calle coincide con el callejero.");
        if (event) event.target.value = '';
        return;
    }

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
        
        marker.on('click', function(ev) {
            if (modoActual === 'borrar' && !borradoPreciso) {
                L.DomEvent.stopPropagation(ev);
                eliminarMarcadorYLineas(this, "Punto borrado");
            }
        });

        grupoCapas.addLayer(marker);

        if (ultimoPunto) {
            const coordsRuta = await obtenerRutaPorCallesOSRM(ultimoPunto, pt.latlng);
            if (coordsRuta && coordsRuta.length > 0) {
                const linea = L.polyline(coordsRuta, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                const zonaToque = anadirZonaDeToque(linea, coordsRuta, map, "Tramo borrado");
                if (ultimoMarcador) vincularLineaEntreMarcadores(ultimoMarcador, marker, linea);
                historialAcciones.push({ tipo: 'linea', elemento: linea });
                grupoCapas.addLayer(linea);
                grupoCapas.addLayer(zonaToque);
            } else {
                tramosSinRuta.push(`${puntosCoordenadas[i - 1].nombre} → ${pt.nombre}`);
            }
        }

        ultimoPunto = pt.latlng;
        ultimoMarcador = marker;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: 'ruta' });
    }

    historialRehacer = [];
    enfocarMapaEnGrupo(grupoCapas, map);

    if (tramosSinRuta.length > 0) {
        alert(`⚠️ No se ha encontrado ruta a pie en estos tramos (se han dejado sin trazar):\n\n- ${tramosSinRuta.join('\n- ')}`);
    }
    mostrarToast(tramosSinRuta.length > 0 ? "Ruta procesada (con algún tramo sin conectar)" : "¡Ruta a pie procesada!");
    if (event) event.target.value = '';
}