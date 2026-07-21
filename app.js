// Configuración de GitHub
const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

// Variables globales
let map;
let modoActual = 'numero'; // 'numero', 'dibujar' (libre) o 'borrar'
let contadorNumero = 1;

// Historial para deshacer / rehacer
let historialAcciones = [];
let historialRehacer = [];

// Control de tramos independientes
let ultimoPuntoTramo = null; 

// Inicialización del mapa y eventos de la interfaz
document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: true,
        touchZoom: true
    }).setView([37.8882, -4.7794], 13); // Centrado en Córdoba

    // Capas base de mapas (Selector superior derecho)
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    });

    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '© OpenTopoMap'
    });

    // Capa híbrida de Google Maps (Satélite + Carreteras y etiquetas superpuestas)
    const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
    });

    osm.addTo(map);

    const baseMaps = {
        "Callejero": osm,
        "Topográfico": topo,
        "Híbrido Google": googleHybrid
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    const mapContainer = map.getContainer();
    mapContainer.style.touchAction = 'auto';

    map.on('click', gestionarPulsacion);

    inicializarInterfaz();
    setModo('numero');

    const urlParams = new URLSearchParams(window.location.search);
    const mapaCompartido = urlParams.get('mapa');
    if (mapaCompartido) {
        cargarMapaDesdeGithub(mapaCompartido);
    }
});

// Enlazar botones y controles del HTML
function inicializarInterfaz() {
    const btnNumber = document.getElementById('btn-number');
    const btnDraw = document.getElementById('btn-draw');
    const btnErase = document.getElementById('btn-erase');
    const colorPicker = document.getElementById('color');
    const grosorInput = document.getElementById('grosor');
    const opacidadInput = document.getElementById('opacidad');

    // Establecer opacidad por defecto al 35% y grosor a 13 píxeles si los controles existen
    if (opacidadInput) {
        opacidadInput.value = 35;
    }
    if (grosorInput) {
        grosorInput.value = 13;
    }

    if (btnNumber) btnNumber.addEventListener('click', () => setModo('numero'));
    if (btnDraw) btnDraw.addEventListener('click', () => setModo('dibujar'));
    if (btnErase) btnErase.addEventListener('click', () => setModo('borrar'));

    // Actualizan TODAS las líneas del mapa de manera global y fluida
    if (colorPicker) colorPicker.addEventListener('input', actualizarEstilosGlobales);
    if (grosorInput) grosorInput.addEventListener('input', actualizarEstilosGlobales);
    if (opacidadInput) opacidadInput.addEventListener('input', actualizarEstilosGlobales);
}

// Selección de modos
function setModo(modo) {
    modoActual = modo;
    
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();

    const btnNumEl = document.getElementById('btn-number');
    const btnDrawEl = document.getElementById('btn-draw');
    const btnErrEl = document.getElementById('btn-erase');
    
    if (btnNumEl) btnNumEl.className = modo === 'numero' ? 'btn btn-primary' : 'btn btn-secondary';
    if (btnDrawEl) btnDrawEl.className = modo === 'dibujar' ? 'btn btn-primary' : 'btn btn-secondary';
    if (btnErrEl) btnErrEl.className = modo === 'borrar' ? 'btn btn-danger' : 'btn btn-secondary';

    if (modo === 'dibujar') {
        ultimoPuntoTramo = null;
    }
}

function obtenerEstilosActuales() {
    const colorEl = document.getElementById('color');
    const grosorEl = document.getElementById('grosor');
    const opacidadEl = document.getElementById('opacidad');

    return {
        color: colorEl ? colorEl.value : '#007bff',
        weight: grosorEl ? parseInt(grosorEl.value) : 13,
        opacity: opacidadEl ? parseFloat(opacidadEl.value) / 100 : 0.35
    };
}

// --- FUNCIÓN PARA CORTAR TRAMO ACTUAL (Sirve tanto para Números como para Dibujo Libre) ---
function cortarTramoActual() {
    ultimoPuntoTramo = null;
    window.puntosDibujoLibre = []; // Limpia también la memoria del trazo libre
    alert("Próximo punto iniciado como un trazado nuevo independiente.");
}

let ultimoToqueTiempo = 0;

// --- GESTIÓN DE CLICS / TOQUES ---
async function gestionarPulsacion(e) {
    const latlng = e.latlng;
    const estilos = obtenerEstilosActuales();

    // Control de doble toque rápido en tablet para cortar tramo (< 350ms)
    const tiempoActual = new Date().getTime();
    if (tiempoActual - ultimoToqueTiempo < 350) {
        cortarTramoActual();
    }
    ultimoToqueTiempo = tiempoActual;

    // MODO BORRAR
    if (modoActual === 'borrar') {
        return; 
    }

    // MODO DIBUJO LIBRE (Línea recta directa sin numeración)
    if (modoActual === 'dibujar') {
        if (!window.puntosDibujoLibre) window.puntosDibujoLibre = [];
        window.puntosDibujoLibre.push(latlng);

        const markerLibre = L.circleMarker(latlng, {
            radius: 5,
            color: estilos.color,
            fillColor: estilos.color,
            fillOpacity: 1
        }).addTo(map);

        historialAcciones.push({ tipo: 'marcador-libre', elemento: markerLibre });

        if (window.puntosDibujoLibre.length > 1) {
            const pAnt = window.puntosDibujoLibre[window.puntosDibujoLibre.length - 2];
            const lineaLibre = L.polyline([pAnt, latlng], {
                color: estilos.color,
                weight: estilos.weight,
                opacity: estilos.opacity
            }).addTo(map);
            historialAcciones.push({ tipo: 'linea', elemento: lineaLibre });
        }
        return;
    }

    // MODO NÚMEROS Y RUTAS POR CALLES
    if (modoActual === 'numero') {
        const numeroActual = contadorNumero;

        const numberIcon = L.divIcon({
            className: 'number-icon',
            html: `<span>${numeroActual}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker(latlng, { icon: numberIcon }).addTo(map);
        
        setTimeout(() => {
            const el = marker.getElement();
            if (el) el.style.backgroundColor = estilos.color;
        }, 10);

        marker.on('click', function(ev) {
            if (modoActual === 'borrar') {
                L.DomEvent.stopPropagation(ev);
                map.removeLayer(marker);
                historialAcciones = historialAcciones.filter(item => item.elemento !== marker);
                if (marker.lineaAsociada) {
                    map.removeLayer(marker.lineaAsociada);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== marker.lineaAsociada);
                }
            }
        });

        let lineaAsociada = null;

        // Si hay un tramo previo activo y no se ha cortado, enrutamos por las calles respetando las curvas
        if (ultimoPuntoTramo) {
            const coordenadasCalle = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);

            if (coordenadasCalle && coordenadasCalle.length > 0) {
                lineaAsociada = L.polyline(coordenadasCalle, {
                    color: estilos.color,
                    weight: estilos.weight,
                    opacity: estilos.opacity,
                    smoothFactor: 1
                }).addTo(map);

                marker.lineaAsociada = lineaAsociada;
                historialAcciones.push({ tipo: 'linea', elemento: lineaAsociada });
            }
        }

        ultimoPuntoTramo = latlng;

        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: numeroActual, color: estilos.color });
        historialRehacer = [];
        contadorNumero++;
    }
}

// --- MOTOR DE ENRUTAMIENTO POR CALLES (ADAPTA CURVAS) ---
async function obtenerRutaPorCallesOSRM(origen, destino) {
    const url = `https://router.project-osrm.org/route/v1/foot/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;

    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const coordenadasGeoJSON = data.routes[0].geometry.coordinates;
                return coordenadasGeoJSON.map(coord => [coord[1], coord[0]]);
            }
        }
    } catch (e) {
        console.warn("Error en OSRM principal, intentando alternativa:", e);
    }

    const urlRespaldo = `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
    try {
        const responseAlt = await fetch(urlRespaldo);
        if (responseAlt.ok) {
            const dataAlt = await responseAlt.json();
            if (dataAlt.code === 'Ok' && dataAlt.routes && dataAlt.routes.length > 0) {
                const coordenadasGeoJSON = dataAlt.routes[0].geometry.coordinates;
                return coordenadasGeoJSON.map(coord => [coord[1], coord[0]]);
            }
        }
    } catch (e2) {
        console.warn("Error en respaldo OSRM, usando línea directa:", e2);
    }

    return [origen, destino];
}

// Deshacer y Rehacer
function deshacerUltimo() {
    if (historialAcciones.length === 0) return;

    const ultimaAccion = historialAcciones.pop();
    map.removeLayer(ultimaAccion.elemento);
    historialRehacer.push(ultimaAccion);

    if (ultimaAccion.tipo === 'marcador') {
        contadorNumero = Math.max(1, contadorNumero - 1);
        
        if (ultimaAccion.elemento.lineaAsociada) {
            map.removeLayer(ultimaAccion.elemento.lineaAsociada);
            historialAcciones = historialAcciones.filter(item => item.elemento !== ultimaAccion.elemento.lineaAsociada);
            historialRehacer.push({ tipo: 'linea', elemento: ultimaAccion.elemento.lineaAsociada });
        }
        ultimoPuntoTramo = historialAcciones.slice().reverse().find(item => item.tipo === 'marcador')?.elemento.getLatLng() || null;
    }
}

function rehacerProximo() {
    if (historialRehacer.length === 0) return;

    const accionRehacer = historialRehacer.pop();
    accionRehacer.elemento.addTo(map);
    historialAcciones.push(accionRehacer);

    if (accionRehacer.tipo === 'marcador') {
        contadorNumero++;
        ultimoPuntoTramo = accionRehacer.elemento.getLatLng();
    }
}

function borrarTodo() {
    historialAcciones.forEach(item => map.removeLayer(item.elemento));
    historialRehacer.forEach(item => map.removeLayer(item.elemento));
    historialAcciones = [];
    historialRehacer = [];
    ultimoPuntoTramo = null;
    contadorNumero = 1;
    window.puntosDibujoLibre = [];
}

// Actualiza de forma GLOBAL el grosor, color y opacidad de TODAS las líneas del mapa
function actualizarEstilosGlobales() {
    const estilos = obtenerEstilosActuales();
    historialAcciones.forEach(item => {
        if (item.tipo === 'linea' && item.elemento) {
            item.elemento.setStyle({
                color: estilos.color,
                weight: estilos.weight,
                opacity: estilos.opacity
            });
        }
    });
}

// --- GESTIÓN CON GITHUB ---

function obtenerToken() {
    let token = localStorage.getItem('github_token');
    if (!token) {
        token = prompt("Introduce tu Personal Access Token de GitHub:");
        if (token) {
            localStorage.setItem('github_token', token.trim());
        }
    }
    return token;
}

function cambiarToken() {
    const nuevoToken = prompt("Introduce tu nuevo Personal Access Token de GitHub:");
    if (nuevoToken) {
        localStorage.setItem('github_token', nuevoToken.trim());
        alert("Token actualizado correctamente.");
    }
}

function exportarDatosMapa() {
    const elementos = [];

    historialAcciones.forEach(item => {
        if (item.tipo === 'linea') {
            const latlngs = item.elemento.getLatLngs().map(ll => [ll.lng, ll.lat]);
            elementos.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: latlngs },
                properties: {
                    tipo: "linea",
                    color: item.elemento.options.color,
                    weight: item.elemento.options.weight,
                    opacity: item.elemento.options.opacity
                }
            });
        } else if (item.tipo === 'marcador') {
            const ll = item.elemento.getLatLng();
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: {
                    tipo: "marcador",
                    numero: item.numero,
                    color: item.color || "#007bff"
                }
            });
        }
    });

    return {
        type: "FeatureCollection",
        features: elementos
    };
}

async function guardarEnGithub() {
    const token = obtenerToken();
    if (!token) return alert("Se requiere un Token de GitHub para guardar.");

    const urlDir = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;
    
    try {
        let archivosDisponibles = [];
        const resList = await fetch(urlDir);
        if (resList.ok) {
            const dataFiles = await resList.json();
            archivosDisponibles = dataFiles.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
        }

        let mensajePrompt = "Elige un nombre de mapa existente para sobrescribir o escribe uno nuevo:\n\n";
        if (archivosDisponibles.length > 0) {
            mensajePrompt += "Mapas guardados actualmente:\n- " + archivosDisponibles.join("\n- ") + "\n\n";
        } else {
            mensajePrompt += "(No hay mapas previos, introduce uno nuevo)\n\n";
        }

        const nombreArchivo = prompt(mensajePrompt);
        if (!nombreArchivo) return;

        const path = `${GITHUB_FOLDER}/${nombreArchivo.trim().toLowerCase().replace(/\s+/g, '-')}.json`;
        const contenido = JSON.stringify(exportarDatosMapa(), null, 2);
        const contenidoBase64 = btoa(unescape(encodeURIComponent(contenido)));

        const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

        let sha = null;
        const resExist = await fetch(url, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (resExist.ok) {
            const dataExist = await resExist.json();
            sha = dataExist.sha;
        }

        const body = {
            message: `Guardar mapa: ${nombreArchivo}`,
            content: contenidoBase64
        };
        if (sha) body.sha = sha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            alert("¡Mapa guardado con éxito en tu repositorio!");
        } else {
            const errData = await res.json();
            alert(`Error al guardar: ${errData.message}`);
        }
    } catch (e) {
        alert(`Error de conexión: ${e.message}`);
    }
}

async function abrirModalCargarGithub() {
    const modal = document.getElementById('modal-load');
    const listaContainer = document.getElementById('lista-mapas');
    if (!modal) return;
    
    modal.style.display = 'block';
    listaContainer.innerHTML = 'Cargando mapas...';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("No se pudo obtener la lista de mapas.");

        const archivos = await res.json();
        const jsonFiles = archivos.filter(f => f.name.endsWith('.json'));

        if (jsonFiles.length === 0) {
            listaContainer.innerHTML = 'No se encontraron mapas guardados.';
            return;
        }

        listaContainer.innerHTML = '';
        jsonFiles.forEach(file => {
            const item = document.createElement('div');
            item.className = 'map-item';
            item.innerHTML = `
                <span>${file.name.replace('.json', '')}</span>
                <button class="btn btn-primary" onclick="cargarMapaDesdeGithub('${file.name}')">Cargar</button>
            `;
            listaContainer.appendChild(item);
        });
    } catch (e) {
        listaContainer.innerHTML = `Error: ${e.message}`;
    }
}

function cerrarModal() {
    const modal = document.getElementById('modal-load');
    if (modal) modal.style.display = 'none';
}

async function cargarMapaDesdeGithub(nombreArchivo) {
    const url = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${GITHUB_FOLDER}/${nombreArchivo}`;

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("No se pudo descargar el archivo del mapa.");

        const geojson = await res.json();
        borrarTodo();

        const bounds = [];

        geojson.features.forEach(feature => {
            if (feature.properties.tipo === 'linea') {
                const latlngs = feature.geometry.coordinates.map(coord => [coord[1], coord[0]]);
                const polyline = L.polyline(latlngs, {
                    color: feature.properties.color,
                    weight: feature.properties.weight,
                    opacity: feature.properties.opacity
                }).addTo(map);

                historialAcciones.push({ tipo: 'linea', elemento: polyline });
                bounds.push(...latlngs);
            } else if (feature.properties.tipo === 'marcador') {
                const coord = feature.geometry.coordinates;
                const latlng = [coord[1], coord[0]];

                const num = feature.properties.numero;
                const color = feature.properties.color || "#007bff";

                const numberIcon = L.divIcon({
                    className: 'number-icon',
                    html: `<span>${num}</span>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                const marker = L.marker(latlng, { icon: numberIcon }).addTo(map);
                setTimeout(() => {
                    const el = marker.getElement();
                    if (el) el.style.backgroundColor = color;
                }, 10);

                marker.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(marker);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== marker);
                    }
                });

                historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, color: color });
                bounds.push(latlng);

                if (num >= contadorNumero) {
                    contadorNumero = num + 1;
                }
            }
        });

        if (bounds.length > 0) {
            map.fitBounds(bounds);
        }

        cerrarModal();
    } catch (e) {
        alert(`Error al cargar el mapa: ${e.message}`);
    }
}

async function compartirMapaGithub() {
    const urlDir = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;

    try {
        let archivosDisponibles = [];
        const resList = await fetch(urlDir);
        if (resList.ok) {
            const dataFiles = await resList.json();
            archivosDisponibles = dataFiles.filter(f => f.name.endsWith('.json')).map(f => f.name.replace('.json', ''));
        }

        let mensajePrompt = "Introduce el nombre del mapa guardado que quieres compartir:\n\n";
        if (archivosDisponibles.length > 0) {
            mensajePrompt += "Mapas disponibles:\n- " + archivosDisponibles.join("\n- ") + "\n\n";
        } else {
            mensajePrompt += "(No hay mapas guardados todavía)\n\n";
        }

        const nombreMapa = prompt(mensajePrompt);
        if (!nombreMapa) return;

        const fileName = nombreMapa.trim().toLowerCase().replace(/\s+/g, '-') + '.json';
        const baseUrl = window.location.href.split('?')[0];
        const shareUrl = `${baseUrl}?mapa=${fileName}`;

        navigator.clipboard.writeText(shareUrl).then(() => {
            alert(`¡Enlace copiado al portapapeles!\n\n${shareUrl}`);
        }).catch(() => {
            prompt("Copia este enlace para compartir:", shareUrl);
        });
    } catch (e) {
        alert(`Error al obtener los mapas: ${e.message}`);
    }
}

function importarGPX(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (e) {
        new L.GPX(e.target.result, {
            async: true,
            marker_options: {
                startIconUrl: '',
                endIconUrl: '',
                shadowUrl: ''
            }
        }).on('loaded', function (e) {
            map.fitBounds(e.target.getBounds());
        }).addTo(map);
    };
    reader.readAsText(file);
}