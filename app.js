// ==================== CONFIGURACIÓN GITHUB ====================
const GITHUB_USER = "viferor";      
const GITHUB_REPO = "Mapas";  
const CARPETA_MAPAS = "mapas";                 

function obtenerToken() {
    let token = localStorage.getItem("github_token_mapas");
    if (!token) {
        token = prompt("Introduce tu Token de GitHub (solo se pedirá una vez):");
        if (token) {
            token = token.trim();
            localStorage.setItem("github_token_mapas", token);
        }
    }
    return token;
}

function cambiarToken() {
    localStorage.removeItem("github_token_mapas");
    obtenerToken();
}
// ==============================================================

// Mapa inicializado con zoom máximo en nivel 22
const map = L.map('map', { zoomControl: false, tap: false, maxZoom: 22 }).setView([37.8882, -4.7794], 14);

// CALLEJERO GOOGLE COMPLETO (Sustituido únicamente este layer por el más detallado)
const mapaCallejero = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { 
    attribution: '© Google Maps',
    maxZoom: 22,
    maxNativeZoom: 20
}).addTo(map);

// HÍBRIDO HD+ (Se mantiene exactamente igual que tenías)
const mapaSatelite = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { 
    attribution: '© Google Maps',
    maxZoom: 22,
    maxNativeZoom: 20
});

L.control.layers({ "🚶‍♂️ Callejero Detallado": mapaCallejero, "🛰️ Híbrido HD+": mapaSatelite }, null, { position: 'topright' }).addTo(map);
L.control.zoom({ position: 'topleft' }).addTo(map);

const contenedorControles = document.getElementById('controls');
L.DomEvent.disableClickPropagation(contenedorControles);
L.DomEvent.disableScrollPropagation(contenedorControles);

let modoActual = 'navegar', puntosRutaActual = [], lineaActual = null;
let historialTrazos = [], papeleraTrazos = [], capasGPX = [];

function getEstilos() {
    return { color: document.getElementById('color').value, weight: parseInt(document.getElementById('grosor').value), opacity: parseFloat(document.getElementById('opacidad').value) / 100 };
}

function setModo(nuevoModo) {
    map.getContainer().removeEventListener('mousedown', iniciarTrazo);
    map.getContainer().removeEventListener('touchstart', iniciarTrazo);
    modoActual = (modoActual === nuevoModo) ? 'navegar' : nuevoModo;
    document.getElementById('btn-draw').className = modoActual === 'dibujar' ? "btn btn-active-draw" : "btn btn-primary";
    document.getElementById('btn-erase').className = modoActual === 'borrar' ? "btn btn-active-erase" : "btn btn-secondary";
    
    if (modoActual !== 'navegar') {
        map.dragging.disable();
        map.getContainer().addEventListener('mousedown', iniciarTrazo, {passive: false});
        map.getContainer().addEventListener('touchstart', iniciarTrazo, {passive: false});
    } else { map.dragging.enable(); }
}

function iniciarTrazo(e) {
    if (e.touches && e.touches.length > 1) { abortarTrazado(); return; }
    const eReal = e.touches ? e.touches[0] : e;
    if (contenedorControles.contains(eReal.target)) return;

    const latlng = map.mouseEventToLatLng(eReal);
    if (modoActual === 'dibujar') {
        papeleraTrazos = [];
        puntosRutaActual = [latlng];
        lineaActual = L.polyline(puntosRutaActual, getEstilos()).addTo(map);
        vincularEventoGoma(lineaActual);
        window.addEventListener('mousemove', dibujarTrazo, {passive: false});
        window.addEventListener('touchmove', dibujarTrazo, {passive: false});
        window.addEventListener('mouseup', terminarTrazo);
        window.addEventListener('touchend', terminarTrazo);
    } else if (modoActual === 'borrar') {
        ejecutarBorradoInmediato(eReal);
        window.addEventListener('mousemove', arrastrarBorrado, {passive: false});
        window.addEventListener('touchmove', arrastrarBorrado, {passive: false});
        window.addEventListener('mouseup', terminarBorrado);
        window.addEventListener('touchend', terminarBorrado);
    }
}

function dibujarTrazo(e) {
    if (e.touches && e.touches.length > 1) { abortarTrazado(); return; }
    const eReal = e.touches ? e.touches[0] : e;
    const latlng = map.mouseEventToLatLng(eReal);
    if (lineaActual) { puntosRutaActual.push(latlng); lineaActual.setLatLngs(puntosRutaActual); }
}

function abortarTrazado() {
    window.removeEventListener('mousemove', dibujarTrazo); window.removeEventListener('mouseup', terminarTrazo);
    window.removeEventListener('touchmove', dibujarTrazo); window.removeEventListener('touchend', terminarTrazo);
    if (lineaActual) { map.removeLayer(lineaActual); lineaActual = null; }
}

function terminarTrazo() {
    window.removeEventListener('mousemove', dibujarTrazo); window.removeEventListener('mouseup', terminarTrazo);
    window.removeEventListener('touchmove', dibujarTrazo); window.removeEventListener('touchend', terminarTrazo);
    if (lineaActual) { historialTrazos.push(lineaActual); lineaActual = null; }
}

function vincularEventoGoma(linea) { 
    linea.on('click touchstart', function(e) { 
        if (modoActual === 'borrar') { 
            L.DomEvent.stopPropagation(e);
            map.removeLayer(linea); 
            papeleraTrazos.push(linea); 
            historialTrazos = historialTrazos.filter(h => h !== linea); 
        } 
    }); 
}

function ejecutarBorradoInmediato(eReal) {
    const el = document.elementFromPoint(eReal.clientX, eReal.clientY);
    if(el && el.tagName === 'path') {
        historialTrazos.forEach(linea => { if(linea._path === el) { map.removeLayer(linea); papeleraTrazos.push(linea); historialTrazos = historialTrazos.filter(h => h !== linea); } });
    }
}

function arrastrarBorrado(e) { ejecutarBorradoInmediato(e.touches ? e.touches[0] : e); }
function terminarBorrado() { 
    window.removeEventListener('mousemove', arrastrarBorrado); window.removeEventListener('mouseup', terminarBorrado); 
    window.removeEventListener('touchmove', arrastrarBorrado); window.removeEventListener('touchend', terminarBorrado); 
}

function actualizarEstiloRuta() { const s = getEstilos(); historialTrazos.forEach(l => l.setStyle(s)); capasGPX.forEach(g => g.setStyle(s)); }
function deshacerUltimo() { if (historialTrazos.length > 0) { const l = historialTrazos.pop(); map.removeLayer(l); papeleraTrazos.push(l); } }
function rehacerProximo() { if (papeleraTrazos.length > 0) { const l = papeleraTrazos.pop(); l.addTo(map); historialTrazos.push(l); } }
function borrarTodo() { historialTrazos.forEach(l => map.removeLayer(l)); capasGPX.forEach(g => map.removeLayer(g)); historialTrazos = []; papeleraTrazos = []; }

function extraerCoordenadasActuales() { return historialTrazos.map(linea => linea.getLatLngs().map(ll => [parseFloat(ll.lat.toFixed(5)), parseFloat(ll.lng.toFixed(5))])); }

// API GITHUB
async function guardarEnGithub() {
    if (historialTrazos.length === 0) return alert("Dibuja una ruta antes de guardar.");
    
    const token = obtenerToken();
    if (!token) return alert("Necesitas introducir un Token para guardar.");

    let nombre = prompt("Nombre del mapa para guardar en GitHub:");
    if (!nombre) return;
    
    const nombreArchivo = nombre.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const path = `${CARPETA_MAPAS}/${nombreArchivo}.json`;
    const content = btoa(JSON.stringify(extraerCoordenadasActuales(), null, 2));
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        let sha = "";
        const checkRes = await fetch(url, { headers: { "Authorization": `token ${token}` } });
        if (checkRes.status === 200) {
            const data = await checkRes.json();
            sha = data.sha;
        }

        const res = await fetch(url, {
            method: "PUT",
            headers: { "Authorization": `token ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: `Guardado: ${nombreArchivo}`,
                content: content,
                sha: sha !== "" ? sha : undefined
            })
        });

        if (res.ok) { 
            alert(`☁️ Mapa '${nombreArchivo}' guardado con éxito!`); 
        } else if (res.status === 401) {
            alert("Token incorrecto o caducado.");
            cambiarToken();
        } else { 
            alert("Error al guardar en GitHub."); 
        }
    } catch (err) { alert("Error de conexión con GitHub."); }
}

async function abrirModalCargarGithub() {
    const token = obtenerToken();
    if (!token) return alert("Necesitas introducir un Token para ver tus mapas.");

    const lista = document.getElementById('lista-mapas');
    lista.innerHTML = "Cargando...";
    document.getElementById('modal-load').style.display = 'block';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${CARPETA_MAPAS}`;
    try {
        const res = await fetch(url, { headers: { "Authorization": `token ${token}` } });
        if (res.status === 404) { lista.innerHTML = "<p style='font-size:12px;'>No hay carpeta 'mapas'.</p>"; return; }
        if (res.status === 401) {
            alert("Token inválido.");
            cambiarToken();
            cerrarModal();
            return;
        }
        
        const files = await res.json();
        lista.innerHTML = "";
        const jsonFiles = files.filter(f => f.name.endsWith('.json'));
        
        if (jsonFiles.length === 0) {
            lista.innerHTML = "<p style='font-size:12px;'>No hay mapas guardados aún.</p>";
            return;
        }

        jsonFiles.forEach(file => {
            const div = document.createElement('div');
            div.className = 'map-item';
            const nombreLimpio = file.name.replace('.json', '');
            
            div.innerHTML = `
                <span style="cursor:pointer; flex:1;" onclick="cargarMapaDesdeGithub('${file.download_url}')">📍 ${nombreLimpio}</span>
                <span style="cursor:pointer; margin-left:10px;" onclick="eliminarMapaGithub('${file.name}', '${file.sha}')">🗑️</span>
            `;
            lista.appendChild(div);
        });
    } catch (err) { lista.innerHTML = "Error al conectar con GitHub."; }
}

async function eliminarMapaGithub(nombreArchivo, sha) {
    if (!confirm(`¿Seguro que quieres borrar el mapa '${nombreArchivo.replace('.json', '')}'?`)) return;

    const token = obtenerToken();
    if (!token) return;

    const path = `${CARPETA_MAPAS}/${nombreArchivo}`;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        const res = await fetch(url, {
            method: "DELETE",
            headers: { "Authorization": `token ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                message: `Borrado: ${nombreArchivo}`,
                sha: sha
            })
        });

        if (res.ok) {
            alert("🗑️ Mapa eliminado correctamente.");
            abrirModalCargarGithub();
        } else {
            alert("Error al intentar eliminar el mapa.");
        }
    } catch (err) {
        alert("Error de conexión al eliminar el mapa.");
    }
}

async function cargarMapaDesdeGithub(downloadUrl) {
    try {
        const res = await fetch(downloadUrl);
        const coordenadas = await res.json();
        borrarTodo();
        coordenadas.forEach(c => {
            const l = L.polyline(c, getEstilos()).addTo(map);
            vincularEventoGoma(l);
            historialTrazos.push(l);
        });
        cerrarModal();
    } catch (err) { alert("Error al descargar el mapa."); }
}

function cerrarModal() { document.getElementById('modal-load').style.display = 'none'; }

function compartirMapaGithub() {
    const nombreMapa = prompt("Escribe el nombre del mapa guardado que quieres compartir:");
    if (!nombreMapa) return;

    const nombreArchivo = nombreMapa.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const urlRawGithub = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${CARPETA_MAPAS}/${nombreArchivo}.json`;
    const urlAppCompartir = `${window.location.origin}${window.location.pathname}?g=${encodeURIComponent(urlRawGithub)}`;

    if (navigator.share) {
        navigator.share({ title: `Mi recorrido: ${nombreArchivo}`, url: urlAppCompartir });
    } else {
        navigator.clipboard.writeText(urlAppCompartir).then(() => alert("🔗 Link copiado al portapapeles"));
    }
}

function importarGPX(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const gpxLayer = new L.GPX(e.target.result, { async: true, polyline_options: getEstilos() })
        .on('loaded', function(e) { map.fitBounds(e.target.getBounds()); }).addTo(map);
        capasGPX.push(gpxLayer);
    };
    reader.readAsText(file);
}

map.whenReady(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('g')) {
        cargarMapaDesdeGithub(decodeURIComponent(urlParams.get('g')));
    }
});
