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

// --- Helpers de vínculo marcador<->línea (evitan líneas "huérfanas" al borrar un punto intermedio) ---
function vincularLineaEntreMarcadores(marcadorAnterior, marcadorNuevo, linea) {
    if (!marcadorAnterior.lineasAsociadas) marcadorAnterior.lineasAsociadas = [];
    if (!marcadorNuevo.lineasAsociadas) marcadorNuevo.lineasAsociadas = [];
    marcadorAnterior.lineasAsociadas.push(linea);
    marcadorNuevo.lineasAsociadas.push(linea);
    linea.marcadoresVinculados = [marcadorAnterior, marcadorNuevo];
}

function eliminarMarcadorYLineas(marcador, mensaje) {
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
        });
    }

    recalcularContadorNumeros();
    mostrarToast(mensaje || "Punto borrado");
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
        if (modoActual === 'borrar') {
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
        }
    };

    lineaVisible.on('click', manejarClickBorrado);
    zonaToque.on('click', manejarClickBorrado);
    return zonaToque;
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
            if (modoActual === 'borrar') {
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
    if (accion && accion.elemento) {
        map.removeLayer(accion.elemento);
        if (accion.elemento._zonaToque) map.removeLayer(accion.elemento._zonaToque);
        historialRehacer.push(accion);

        if (accion.tipo === 'marcador') {
            if (accion.elemento.lineasAsociadas && accion.elemento.lineasAsociadas.length) {
                accion.elemento.lineasAsociadas.forEach(linea => {
                    map.removeLayer(linea);
                    if (linea._zonaToque) map.removeLayer(linea._zonaToque);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== linea);
                    historialRehacer.push({ tipo: 'linea', elemento: linea });
                });
            }
            recalcularContadorNumeros();
            const ultimo = historialAcciones.slice().reverse().find(i => i.tipo === 'marcador' && i.submodo === 'ruta');
            ultimoPuntoTramo = ultimo ? ultimo.elemento.getLatLng() : null;
            ultimoMarcadorTramo = ultimo ? ultimo.elemento : null;
        }
        mostrarToast("Deshecho");
    }
}

function rehacerProximo() {
    if (historialRehacer.length === 0) {
        mostrarToast("Nada que rehacer");
        return;
    }
    const accion = historialRehacer.pop();
    if (accion && accion.elemento) {
        accion.elemento.addTo(map);
        if (accion.elemento._zonaToque) accion.elemento._zonaToque.addTo(map);
        historialAcciones.push(accion);
        if (accion.tipo === 'marcador') {
            recalcularContadorNumeros();
            if (accion.submodo === 'ruta') {
                ultimoPuntoTramo = accion.elemento.getLatLng();
                ultimoMarcadorTramo = accion.elemento;
            }
        }
        mostrarToast("Rehecho");
    }
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
        
        historialAcciones.forEach(i => map.removeLayer(i.elemento));
        historialRehacer.forEach(i => map.removeLayer(i.elemento));
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
                if (modoActual === 'borrar') { 
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
function mostrarModalEdicionOCR(lineasIniciales) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-ocr');
        const textarea = document.getElementById('texto-ocr');
        const btnContinuar = document.getElementById('btn-ocr-continuar');
        const btnCancelar = document.getElementById('btn-ocr-cancelar');

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
async function procesarListadoCalles(lineas, event) {
    if (lineas.length === 0) {
        alert("El listado está vacío o no contiene líneas válidas.");
        if (event) event.target.value = '';
        return;
    }

    mostrarToast(`Geocodificando ${lineas.length} calles en Córdoba...`);
    let grupoCapas = L.featureGroup();
    let puntosCoordenadas = [];
    let textosNoReconocidos = [];
    const cacheGeocodificacion = {}; // evita repetir peticiones para nombres de calle duplicados en el archivo

    for (let nombre of lineas) {
        let nombreLimpio = nombre
            .replace(/^(c\/|cl\.|calle)\s*/i, '')
            .replace(/^(avda\.|av\.|avenida)\s*/i, '')
            .replace(/^(pza\.|plaza)\s*/i, '')
            .trim();

        const claveCache = nombre.toLowerCase();
        let encontradoValido = false;

        if (cacheGeocodificacion[claveCache] !== undefined) {
            const cacheado = cacheGeocodificacion[claveCache];
            if (cacheado) {
                if (puntosCoordenadas.length === 0 || puntosCoordenadas[puntosCoordenadas.length - 1].latlng.distanceTo(cacheado) > 20) {
                    puntosCoordenadas.push({ latlng: cacheado, nombre: nombre });
                }
                encontradoValido = true;
            }
        } else {
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

                        if (lat >= 37.80 && lat <= 37.95 && lon >= -4.90 && lon <= -4.60) {
                            const nuevoPunto = L.latLng(lat, lon);
                            cacheGeocodificacion[claveCache] = nuevoPunto;
                            if (puntosCoordenadas.length === 0 || puntosCoordenadas[puntosCoordenadas.length - 1].latlng.distanceTo(nuevoPunto) > 20) {
                                puntosCoordenadas.push({ latlng: nuevoPunto, nombre: nombre });
                            }
                            encontradoValido = true;
                            break;
                        }
                    }
                } catch (err) {
                    console.error("Error en geocodificación:", err);
                }
                // Nominatim exige un máximo de 1 petición/segundo; se respeta ese límite entre variantes
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!encontradoValido) cacheGeocodificacion[claveCache] = null;
        }

        if (!encontradoValido) {
            if (!textosNoReconocidos.includes(nombre)) {
                textosNoReconocidos.push(nombre);
            }
        }
    }

    if (textosNoReconocidos.length > 0) {
        alert(`⚠️ Atención: Las siguientes calles no se han podido reconocer en Córdoba y han sido descartadas:\n\n- ${textosNoReconocidos.join('\n- ')}`);
    }

    if (puntosCoordenadas.length === 0) {
        alert("No se ha podido trazar ninguna ruta porque ninguna calle coincide con el callejero.");
        if (event) event.target.value = '';
        return;
    }

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
            if (modoActual === 'borrar') {
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

