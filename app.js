// Configuración de GitHub
const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

// Variables globales
let map;
let modoActual = 'dibujar'; // 'dibujar', 'numero', 'borrar'
let dibujando = false;
let lineaActual = null;
let contadorNumero = 1;

// Historial para deshacer / rehacer
let historialAcciones = [];
let historialRehacer = [];

// Inicialización del mapa
document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: true,
        touchZoom: true
    }).setView([37.8882, -4.7794], 13); // Centrado en Córdoba

    // Capas base de mapas
    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    });

    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        maxZoom: 17,
        attribution: '© OpenTopoMap'
    });

    const esriSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri'
    });

    osm.addTo(map);

    // Selector de capas
    const baseMaps = {
        "Callejero": osm,
        "Topográfico": topo,
        "Satélite": esriSat
    };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(map);

    // Eventos de interacción sobre el mapa
    map.on('mousedown touchstart', iniciarTrazo);
    map.on('mousemove touchmove', moverTrazo);
    map.on('mouseup touchend', finalizarTrazo);
    map.on('click', gestionarPulsacion);

    // Establecer modo por defecto al cargar visualmente
    setModo('dibujar');

    // Cargar mapa desde URL si viene con parámetro ?mapa=nombre.json
    const urlParams = new URLSearchParams(window.location.search);
    const mapaCompartido = urlParams.get('mapa');
    if (mapaCompartido) {
        cargarMapaDesdeGithub(mapaCompartido);
    }
});

// Selección de modo
function setModo(modo) {
    modoActual = modo;
    
    if (modo === 'dibujar') {
        map.dragging.disable();
    } else {
        map.dragging.enable();
    }

    document.getElementById('btn-draw').className = modo === 'dibujar' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('btn-number').className = modo === 'numero' ? 'btn btn-primary' : 'btn btn-secondary';
    document.getElementById('btn-erase').className = modo === 'borrar' ? 'btn btn-danger' : 'btn btn-secondary';
}

function obtenerEstilosActuales() {
    return {
        color: document.getElementById('color').value,
        weight: parseInt(document.getElementById('grosor').value),
        opacity: parseFloat(document.getElementById('opacidad').value) / 100
    };
}

// Dibujo a mano alzada
function iniciarTrazo(e) {
    if (modoActual !== 'dibujar') return;
    
    if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') {
        e.originalEvent.preventDefault();
    }
    
    dibujando = true;

    const latlng = e.latlng || map.mouseEventToLatLng(e.originalEvent.touches ? e.originalEvent.touches[0] : e.originalEvent);
    const estilos = obtenerEstilosActuales();

    lineaActual = L.polyline([latlng], {
        color: estilos.color,
        weight: estilos.weight,
        opacity: estilos.opacity,
        smoothFactor: 1
    }).addTo(map);
}

function moverTrazo(e) {
    if (!dibujando || modoActual !== 'dibujar') return;
    
    if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') {
        e.originalEvent.preventDefault();
    }

    const latlng = e.latlng || map.mouseEventToLatLng(e.originalEvent.touches ? e.originalEvent.touches[0] : e.originalEvent);
    if (latlng) {
        lineaActual.addLatLng(latlng);
    }
}

function finalizarTrazo() {
    if (!dibujando || modoActual !== 'dibujar') return;
    dibujando = false;

    if (lineaActual) {
        historialAcciones.push({ tipo: 'linea', elemento: lineaActual });
        historialRehacer = [];
        lineaActual = null;
    }
}

// Numeración paso a paso
function gestionarPulsacion(e) {
    if (modoActual === 'numero') {
        const color = document.getElementById('color').value;

        const numberIcon = L.divIcon({
            className: 'number-icon',
            html: `<span>${contadorNumero}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker(e.latlng, { icon: numberIcon }).addTo(map);
        
        setTimeout(() => {
            const el = marker.getElement();
            if (el) {
                el.style.backgroundColor = color;
            }
        }, 10);

        marker.on('click', function() {
            if (modoActual === 'borrar') {
                map.removeLayer(marker);
                historialAcciones = historialAcciones.filter(item => item.elemento !== marker);
            }
        });

        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: contadorNumero, color: color });
        historialRehacer = [];
        contadorNumero++;
    }
}

// Deshacer y Rehacer
function deshacerUltimo() {
    if (historialAcciones.length === 0) return;

    const ultimaAccion = historialAcciones.pop();
    map.removeLayer(ultimaAccion.elemento);
    historialRehacer.push(ultimaAccion);

    if (ultimaAccion.tipo === 'marcador') {
        contadorNumero = Math.max(1, contadorNumero - 1);
    }
}

function rehacerProximo() {
    if (historialRehacer.length === 0) return;

    const accionRehacer = historialRehacer.pop();
    accionRehacer.elemento.addTo(map);
    historialAcciones.push(accionRehacer);

    if (accionRehacer.tipo === 'marcador') {
        contadorNumero++;
    }
}

function borrarTodo() {
    historialAcciones.forEach(item => map.removeLayer(item.elemento));
    historialRehacer.forEach(item => map.removeLayer(item.elemento));
    historialAcciones = [];
    historialRehacer = [];
    contadorNumero = 1;
}

function actualizarEstiloRuta() {}

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

// Guardar permitiendo elegir un mapa existente de la lista o crear uno nuevo
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
    document.getElementById('modal-load').style.display = 'none';
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
                    if (el) {
                        el.style.backgroundColor = color;
                    }
                }, 10);

                marker.on('click', function() {
                    if (modoActual === 'borrar') {
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

// Compartir mostrando listado previo de mapas existentes
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
