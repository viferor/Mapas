const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

let map;
let modoActual = 'ruta'; // 'ruta', 'aislado', 'dibujar_puntos', 'continuo', 'borrar'
let contadorNumero = 1;

let historialAcciones = [];
let historialRehacer = [];

let ultimoPuntoTramo = null; 
let ultimoMarcadorTramo = null; // referencia al marcador anterior, para poder vincular las líneas en ambos sentidos
let trazoLibreActivo = false; 

// --- Goma de borrar de precisión (modo "Borrar" con el conmutador "Preciso" activado) ---
let borradoPreciso = false;         // false = borrado por elemento completo (comportamiento clásico); true = mano libre, recorte preciso
let borradoPrecisoActivo = false;   // true mientras se está arrastrando el dedo/ratón borrando
let ultimoPuntoBorrado = null;
const RADIO_BORRADO_PRECISO_METROS = 6; // pequeño y preciso, tal como se pidió

// --- Helpers de vínculo marcador<->línea (evitan líneas "huérfanas" al borrar un punto intermedio) ---
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
            if (linea._zonaToque) map.removeLayer(linea._zonaToque);
            historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
            // Quitar también la referencia en el otro marcador vinculado a esa línea
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

    recalcularContadorNumeros();
    mostrarToast(mensaje || "Punto borrado");
    historialAcciones.push({ tipo: 'borrado', restaurar });
    historialRehacer = [];
}

// --- Zona de toque ampliada para líneas: en pantalla táctil, tocar exactamente sobre el
// grosor visual de una línea es difícil incluso con trazos medios/gruesos. Añadimos una línea
// invisible más ancha por debajo, que comparte el mismo borrado, para que sea mucho más fácil
// acertar con el dedo al borrar. ---
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

    const manejarClickBorrado = function(ev) {
        if (modoActual === 'borrar' && !borradoPreciso) {
            L.DomEvent.stopPropagation(ev);
            mapaInstancia.removeLayer(lineaVisible);
            mapaInstancia.removeLayer(zonaToque);
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

// Inserta puntos intermedios interpolados en una línea para que ningún tramo entre dos puntos
// consecutivos supere "distMaxMetros". Así la goma de borrar puede "cortar" en cualquier punto
// de la línea y no solo en sus vértices originales (importante para tramos rectos con pocos puntos).
function densificarPuntos(puntos, distMaxMetros) {
    if (!puntos || puntos.length < 2) return puntos;
    let resultado = [puntos[0]];
    for (let i = 1; i < puntos.length; i++) {
        const a = puntos[i - 1], b = puntos[i];
        const distancia = a.distanceTo(b);
        const pasos = Math.min(500, Math.ceil(distancia / distMaxMetros)); // límite de seguridad para no generar listas gigantes
        for (let s = 1; s <= pasos; s++) {
            const t = s / pasos;
            resultado.push(L.latLng(a.lat + (b.lat - a.lat) * t, a.lng + (b.lng - a.lng) * t));
        }
    }
    return resultado;
}

function eliminarLineaDelHistorial(linea) {
    map.removeLayer(linea);
    if (linea._zonaToque) map.removeLayer(linea._zonaToque);
    historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
    if (linea.marcadoresVinculados) {
        linea.marcadoresVinculados.forEach(m => {
            if (m.lineasAsociadas) m.lineasAsociadas = m.lineasAsociadas.filter(l => l !== linea);
        });
    }
}

// Quita solo el marcador numérico, sin tocar el trazado que tenga asociado (se usa en la goma de
// borrar de precisión: borrar un punto no debe borrar la ruta que pasa por él).
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

// Borra con precisión todo lo que quede dentro de "radioMetros" de "latlngCentro", registrando los
// cambios dentro de "sesion" para que todo el gesto de arrastre se pueda deshacer/rehacer de una vez:
// - Marcadores: se quita solo el número, el trazado asociado se conserva intacto.
// - Líneas: se recorta justo el tramo tocado, dividiéndola en varios trozos si hace falta.
function borrarConPrecision(latlngCentro, radioMetros, sesion) {
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
    if (sesion.marcadores.length) recalcularContadorNumeros();

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

        // Si esta línea ya es descendiente de un recorte anterior dentro de este mismo gesto, se
        // reutiliza su registro (para poder deshacer todo el gesto de golpe, restaurando la línea
        // tal cual estaba antes de empezar a arrastrar la goma de borrar)
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
            anadirZonaDeToque(nuevaLinea, sub, map, "Tramo borrado");
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
    ultimoPuntoBorrado = latlng;
    sesionBorradoPrecisoActual = { marcadores: [], reemplazosLinea: [] };
    borrarConPrecision(latlng, RADIO_BORRADO_PRECISO_METROS, sesionBorradoPrecisoActual);
}

function continuarBorradoPreciso(latlng) {
    if (!borradoPrecisoActivo || !sesionBorradoPrecisoActual) return;
    if (ultimoPuntoBorrado) {
        // Se interpola entre el último punto y el actual, para no dejar huecos sin borrar si el dedo se mueve rápido
        const distancia = ultimoPuntoBorrado.distanceTo(latlng);
        const pasos = Math.min(60, Math.max(1, Math.ceil(distancia / (RADIO_BORRADO_PRECISO_METROS / 2))));
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

        const sesion = sesionBorradoPrecisoActual;
        sesionBorradoPrecisoActual = null;

        if (sesion && (sesion.marcadores.length || sesion.reemplazosLinea.length)) {
            sesion.reemplazosLinea.forEach(registro => {
                registro.actuales.forEach(l => { delete l._registroSesionBorrado; });
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
        doubleClickZoom: false, // evita que el doble-toque para "cortar tramo" también dispare el zoom nativo de Leaflet
        tap: false 
    }).setView([37.8882, -4.7794], 13);

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const cartoClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; CARTO' });
    const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '&copy; Google Maps' });

    osm.addTo(map);
    L.control.layers({ "Callejero": osm, "Claro": cartoClaro, "Google": googleHybrid }, null, { position: 'topright' }).addTo(map);

    map.on('click', gestionarPulsacion);
    configurarDibujoTactilTablet();
    setModo('ruta');

    // Escuchadores para los controles de estilo con selector de ámbito (todos vs último)
    const colorInput = document.getElementById('color-trazo');
    const grosorInput = document.getElementById('grosor-trazo');
    const opacidadInput = document.getElementById('opacidad-trazo');

    if (colorInput) colorInput.addEventListener('input', manejarCambioEstiloDinamico);
    if (grosorInput) grosorInput.addEventListener('input', manejarCambioEstiloDinamico);
    if (opacidadInput) opacidadInput.addEventListener('input', manejarCambioEstiloDinamico);

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
        'borrar': 'btn-borrar'
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

    // En modo "Borrar", desactivamos el arrastre de los marcadores existentes: en pantalla táctil
    // un toque casi siempre incluye un pequeño desplazamiento del dedo, y eso puede iniciar
    // un arrastre accidental en vez de disparar el borrado con un toque simple.
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
        'borrar': "Modo: Borrar elementos"
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

// Función que lee el interruptor/selector de ámbito ('todos' o 'ultimo') y aplica los estilos correspondientes
function manejarCambioEstiloDinamico() {
    const selectorAmbito = document.getElementById('ambito-estilo'); // <select> o radio buttons con ID 'ambito-estilo'
    const ambito = selectorAmbito ? selectorAmbito.value : 'todos'; // valores esperados: 'todos' o 'ultimo'
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
        // Buscar el último elemento de tipo línea en el historial
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

function recalcularContadorNumeros() {
    const marcadoresRestantes = historialAcciones.filter(item => item.tipo === 'marcador');
    contadorNumero = marcadoresRestantes.length === 0 ? 1 : Math.max(...marcadoresRestantes.map(m => m.numero)) + 1;
}

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

    // --- Equivalentes de ratón, para que "Mano Alzada" también funcione en ordenador de escritorio ---
    let ultimoEventoFueTouch = 0;
    mapaContenedor.addEventListener('touchstart', () => { ultimoEventoFueTouch = Date.now(); }, { passive: true, capture: true });

    mapaContenedor.addEventListener('mousedown', (e) => {
        if (Date.now() - ultimoEventoFueTouch < 500) return; // ignora el mouse "fantasma" que generan algunos navegadores tras un touch
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

    // --- Goma de borrar de precisión: arrastrar (dedo o ratón) mientras el modo "Borrar" tiene
    // activado el conmutador "Preciso" recorta justo el trazo por el que se pasa ---
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
        const num = contadorNumero;
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
                avisoSinRuta = true; // no se encontró una ruta a pie real: no se dibuja nada de relleno
            }
        }
        ultimoPuntoTramo = (modoActual === 'ruta') ? latlng : null;
        ultimoMarcadorTramo = (modoActual === 'ruta') ? marker : null;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: modoActual });
        historialRehacer = [];
        contadorNumero++;
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
    } catch (e) {}
    // Estrictamente peatonal: si no hay una ruta real a pie entre los dos puntos, no se inventa
    // una línea recta de relleno (podría atravesar edificios, un río, una autovía, etc.). Se
    // devuelve null y quien llame a esta función debe dejar ese tramo sin dibujar.
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
    if (confirm("¿Estás seguro de que quieres borrar todo el mapa? Se perderán todos los puntos y trazos actuales.")) {
        historialAcciones.forEach(i => {
            if (i && i.elemento) {
                map.removeLayer(i.elemento);
                if (i.elemento._zonaToque) map.removeLayer(i.elemento._zonaToque);
            }
        });
        historialRehacer.forEach(i => {
            if (i && i.elemento) {
                map.removeLayer(i.elemento);
                if (i.elemento._zonaToque) map.removeLayer(i.elemento._zonaToque);
            }
        });

        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
        ultimoMarcadorTramo = null;
        contadorNumero = 1;
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

    // --- Deshacer un BORRADO (clásico o preciso): se restaura lo que se había quitado ---
    if (accion.tipo === 'borrado') {
        if (accion.restaurar) {
            accion.restaurar.forEach(item => {
                item.elemento.addTo(map);
                if (item.elemento._zonaToque) item.elemento._zonaToque.addTo(map);
                historialAcciones.push(item);
            });
        }
        if (accion.sesionPrecisa) {
            accion.sesionPrecisa.marcadores.forEach(m => {
                m.elemento.addTo(map);
                historialAcciones.push({ tipo: 'marcador', elemento: m.elemento, numero: m.numero, submodo: m.submodo });
            });
            accion.sesionPrecisa.reemplazosLinea.forEach(registro => {
                registro.actuales.forEach(l => {
                    map.removeLayer(l);
                    if (l._zonaToque) map.removeLayer(l._zonaToque);
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
        recalcularContadorNumeros();
        historialRehacer.push(accion);
        mostrarToast("Borrado deshecho");
        return;
    }

    // --- Deshacer un DIBUJO (marcador o línea añadidos): se quita, agrupando marcador+sus líneas
    // en un solo paso para poder rehacerlo todo junto (antes se deshacían juntos pero se rehacían
    // por separado, dejando estados intermedios raros) ---
    if (!accion.elemento) return;

    map.removeLayer(accion.elemento);
    if (accion.elemento._zonaToque) map.removeLayer(accion.elemento._zonaToque);

    let grupo = [accion];

    if (accion.tipo === 'marcador' && accion.elemento.lineasAsociadas && accion.elemento.lineasAsociadas.length) {
        accion.elemento.lineasAsociadas.forEach(linea => {
            map.removeLayer(linea);
            if (linea._zonaToque) map.removeLayer(linea._zonaToque);
            historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
            grupo.push({ tipo: 'linea', elemento: linea });
        });
        recalcularContadorNumeros();
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

    // --- Rehacer un BORRADO: se vuelve a quitar lo que se había restaurado con el "Deshacer" anterior ---
    if (!Array.isArray(item) && item.tipo === 'borrado') {
        if (item.restaurar) {
            item.restaurar.forEach(r => {
                map.removeLayer(r.elemento);
                if (r.elemento._zonaToque) map.removeLayer(r.elemento._zonaToque);
                historialAcciones = historialAcciones.filter(x => x.elemento !== r.elemento);
            });
        }
        if (item.sesionPrecisa) {
            item.sesionPrecisa.marcadores.forEach(m => {
                map.removeLayer(m.elemento);
                historialAcciones = historialAcciones.filter(x => x.elemento !== m.elemento);
            });
            item.sesionPrecisa.reemplazosLinea.forEach(registro => {
                if (registro.lineaRestaurada) {
                    map.removeLayer(registro.lineaRestaurada);
                    if (registro.lineaRestaurada._zonaToque) map.removeLayer(registro.lineaRestaurada._zonaToque);
                    historialAcciones = historialAcciones.filter(x => x.elemento !== registro.lineaRestaurada);
                }
                registro.actuales.forEach(l => {
                    l.addTo(map);
                    if (l._zonaToque) l._zonaToque.addTo(map);
                    historialAcciones.push({ tipo: 'linea', elemento: l });
                });
            });
        }
        recalcularContadorNumeros();
        historialAcciones.push(item);
        mostrarToast("Rehecho");
        return;
    }

    // --- Rehacer un DIBUJO: se restaura el grupo completo (marcador + sus líneas) de una vez ---
    const grupo = Array.isArray(item) ? item : [item];
    grupo.forEach(accion => {
        accion.elemento.addTo(map);
        if (accion.elemento._zonaToque) accion.elemento._zonaToque.addTo(map);
        historialAcciones.push(accion);
    });

    const accionMarcador = grupo.find(a => a.tipo === 'marcador');
    if (accionMarcador) {
        recalcularContadorNumeros();
        if (accionMarcador.submodo === 'ruta') {
            ultimoPuntoTramo = accionMarcador.elemento.getLatLng();
            ultimoMarcadorTramo = accionMarcador.elemento;
        }
    }
    mostrarToast("Rehecho");
}

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
            elementos.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: item.elemento.getLatLngs().map(ll => [ll.lng, ll.lat]) },
                properties: { tipo: "linea", color: item.elemento.options.color, weight: item.elemento.options.weight, opacity: item.elemento.options.opacity }
            });
        } else if (item.tipo === 'marcador') {
            const ll = item.elemento.getLatLng();
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: { tipo: "marcador", numero: item.numero, submodo: item.submodo }
            });
        }
    });
    return { type: "FeatureCollection", features: elementos };
}

async function guardarEnGithub(nombreArchivo) {
    const token = obtenerToken();
    if (!token) return;

    const path = `${GITHUB_FOLDER}/${nombreArchivo.trim().toLowerCase().replace(/\s+/g, '-')}.json`;
    const contenido = btoa(unescape(encodeURIComponent(JSON.stringify(exportarDatosMapa(), null, 2))));
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        let sha = null;
        const resExist = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (resExist.ok) sha = (await resExist.json()).sha;

        const body = { message: `Guardar mapa`, content: contenido };
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

        // Construcción segura vía DOM (evita inyectar nombres de archivo sin escapar en atributos onclick)
        jsonFiles.forEach(file => {
            const n = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #ddd; padding-bottom:6px;';

            const nombreSpan = document.createElement('span');
            nombreSpan.style.fontWeight = '600';
            nombreSpan.textContent = n; // textContent escapa automáticamente

            const btn = document.createElement('button');
            btn.style.borderRadius = '6px';

            if (accion === 'guardar') {
                btn.className = 'btn btn-blue';
                btn.textContent = 'Sobrescribir';
                btn.addEventListener('click', () => guardarEnGithub(n));
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
    const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${GITHUB_FOLDER}/${fileName}`;
    try {
        const res = await fetch(url);
        const geojson = await res.json();
        
        const quitarSiEsCapa = (capa) => {
            if (capa && typeof capa.on === 'function') {
                map.removeLayer(capa);
                if (capa._zonaToque) map.removeLayer(capa._zonaToque);
            }
        };
        const limpiarEntrada = (i) => {
            if (!i) return;
            if (Array.isArray(i)) { i.forEach(limpiarEntrada); return; }
            if (i.tipo === 'borrado') {
                if (i.restaurar) i.restaurar.forEach(r => quitarSiEsCapa(r.elemento));
                if (i.sesionPrecisa) {
                    i.sesionPrecisa.marcadores.forEach(m => quitarSiEsCapa(m.elemento));
                    i.sesionPrecisa.reemplazosLinea.forEach(reg => {
                        quitarSiEsCapa(reg.lineaRestaurada);
                        reg.actuales.forEach(quitarSiEsCapa);
                    });
                }
                return;
            }
            quitarSiEsCapa(i.elemento);
        };
        historialAcciones.forEach(limpiarEntrada);
        historialRehacer.forEach(limpiarEntrada);
        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
        ultimoMarcadorTramo = null;
        contadorNumero = 1;

        procesarYAnadirGeoJSON(geojson, map);
        cerrarModal();
        mostrarToast("¡Mapa cargado!");
    } catch (e) { alert("Error al cargar el mapa"); }
}

async function compartirMapaEspecifico(fileName) {
    const link = `${window.location.href.split('?')[0]}?mapa=${fileName}`;
    if (navigator.share) {
        try { await navigator.share({ title: 'Ruta', url: link }); cerrarModal(); return; } catch (e) {}
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(link)}`, '_blank');
    cerrarModal();
}

function procesarYAnadirGeoJSON(geojson, mapInstance) {
    let grupoCapas = L.featureGroup();

    geojson.features.forEach(f => {
        if (f.properties.tipo === 'linea') {
            const ll = f.geometry.coordinates.map(c => [c[1], c[0]]);
            const l = L.polyline(ll, { 
                color: f.properties.color || '#3388ff', 
                weight: f.properties.weight !== undefined ? f.properties.weight : 4, 
                opacity: f.properties.opacity !== undefined ? f.properties.opacity : 1, 
                interactive: true 
            }).addTo(mapInstance);
            
            const zonaToque = anadirZonaDeToque(l, ll, mapInstance, "Línea borrada");
            
            historialAcciones.push({ tipo: 'linea', elemento: l });
            grupoCapas.addLayer(l);
            grupoCapas.addLayer(zonaToque);

        } else if (f.properties.tipo === 'marcador') {
            const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
            const m = L.marker(latlng, { 
                icon: L.divIcon({ className: 'number-icon', html: `<span>${f.properties.numero}</span>`, iconSize: [28,28], iconAnchor:[14,14] }), 
                interactive: true 
            }).addTo(mapInstance);
            
            m.on('click', ev => { 
                if (modoActual === 'borrar' && !borradoPreciso) { 
                    L.DomEvent.stopPropagation(ev); 
                    mapInstance.removeLayer(m); 
                    historialAcciones = historialAcciones.filter(item => item.elemento !== m); 
                    recalcularContadorNumeros(); 
                    mostrarToast("Punto borrado"); 
                } 
            });
            
            historialAcciones.push({ tipo: 'marcador', elemento: m, numero: f.properties.numero });
            grupoCapas.addLayer(m);
        }
    });

    recalcularContadorNumeros();
    enfocarMapaEnGrupo(grupoCapas, mapInstance);
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

// --- Carga de un listado de calles a partir de una FOTO/IMAGEN, usando reconocimiento de texto (OCR) ---
// Tesseract.js se carga bajo demanda (solo la primera vez que se usa esta función) para no penalizar
// la carga inicial de la app con una librería que muchas veces no hará falta.
function cargarScriptExterno(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("No se pudo cargar la librería de OCR. Comprueba tu conexión a internet."));
        document.head.appendChild(script);
    });
}

// Muestra el modal de revisión/edición del texto OCR y devuelve una promesa con las líneas editadas
// (o null si el usuario cancela). Se reutiliza también cuando el OCR no ha detectado nada, para que
// el usuario pueda escribir el listado a mano en el mismo cuadro.
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

        // Un único worker reutilizado para todas las imágenes: más rápido que crear uno nuevo por foto
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

        // El OCR nunca es perfecto: se muestra en un cuadro editable para poder corregir nombres
        // mal leídos (o escribirlos a mano si no se detectó nada) antes de geocodificar
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

// --- Lógica compartida: dado un listado de nombres de calle (venga de un .txt o de una imagen escaneada),
// los geocodifica en Córdoba y traza la ruta a pie entre ellos ---
const CORDOBA_CENTRO = L.latLng(37.8882, -4.7794);
const RADIO_MAXIMO_METROS = 3500; // filtro estricto: 3,5 km desde la PRIMERA calle válida del recorrido (no desde el centro fijo)
const RADIO_PRIMERA_CALLE_METROS = 12000; // margen amplio, solo para localizar la primera calle en cualquier punto de Córdoba

// Geocodifica un listado de nombres de calle contra el callejero de Córdoba.
// La primera calle que se localiza correctamente pasa a ser el "centro" del recorrido: todas las
// demás calles deben quedar a un máximo de 3,5 km de esa primera calle (no del centro de la ciudad),
// para descartar coincidencias de Nominatim en zonas alejadas que probablemente sean erróneas.
// "centroInicial" permite reutilizar como referencia el centro ya calculado en una pasada anterior
// (por ejemplo, al reintentar solo las calles no reconocidas).
// Devuelve { resultados, centroRuta }, donde resultados es un array paralelo a "nombres":
// cada elemento es { nombre, latlng } con latlng=null si no se ha podido reconocer.
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
        if (!centroRuta && latlng) centroRuta = latlng; // fija el centro del recorrido con la primera calle válida
    }

    return { resultados, centroRuta };
}

async function geocodificarUnaCalleNominatim(nombre, centroReferencia, radioMetros) {
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

    for (let queryConCiudad of variantesBusqueda) {
        try {
            const urlGeo = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryConCiudad)}&countrycodes=es&limit=1`;
            const res = await fetch(urlGeo);
            const datos = await res.json();

            if (datos && datos.length > 0) {
                const lat = parseFloat(datos[0].lat);
                const lon = parseFloat(datos[0].lon);
                const nuevoPunto = L.latLng(lat, lon);

                if (nuevoPunto.distanceTo(centroReferencia) <= radioMetros) {
                    return nuevoPunto;
                }
            }
        } catch (err) {
            console.error("Error en geocodificación:", err);
        }
        // Nominatim exige un máximo de 1 petición/segundo; se respeta ese límite entre variantes
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

    // Las que no se han reconocido se ofrecen en el mismo cuadro editable, para corregirlas y reintentar
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
            // Se sustituyen en su posición original dentro de la secuencia; si se han añadido líneas
            // de más al corregir, se colocan al final del listado
            reintento.forEach((r, idx) => {
                if (idx < indicesFallidos.length) {
                    entradas[indicesFallidos[idx]] = r;
                } else {
                    entradas.push(r);
                }
            });
            // Si se han borrado líneas al corregir (menos líneas que fallidos originales), esas posiciones quedan sin resolver
        }
    }

    // Se construye el listado final de puntos, respetando el orden original y evitando puntos duplicados muy próximos
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
        const num = contadorNumero;
        
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
                // No se ha encontrado una ruta a pie real entre estos dos puntos: no se dibuja nada de
                // relleno (ni línea recta). El punto se mantiene, pero queda sin conectar visualmente.
                tramosSinRuta.push(`${puntosCoordenadas[i - 1].nombre} → ${pt.nombre}`);
            }
        }

        ultimoPunto = pt.latlng;
        ultimoMarcador = marker;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: 'ruta' });
        contadorNumero++;
    }

    historialRehacer = [];
    enfocarMapaEnGrupo(grupoCapas, map);

    if (tramosSinRuta.length > 0) {
        alert(`⚠️ No se ha encontrado ruta a pie en estos tramos (se han dejado sin trazar):\n\n- ${tramosSinRuta.join('\n- ')}`);
    }
    mostrarToast(tramosSinRuta.length > 0 ? "Ruta procesada (con algún tramo sin conectar)" : "¡Ruta a pie procesada!");
    if (event) event.target.value = '';
}

