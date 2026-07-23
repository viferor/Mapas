// Configuración de GitHub
const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

let map;
let modoActual = 'numero'; 
let submodoNumero = 'ruta'; 
let contadorNumero = 1;

let historialAcciones = [];
let historialRehacer = [];

let ultimoPuntoTramo = null; 
let trazoLibreActivo = false; 

document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: true,
        touchZoom: true
    }).setView([37.8882, -4.7794], 13);

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const cartoClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap & CARTO' });
    const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '&copy; Google Maps' });

    osm.addTo(map);

    L.control.layers({ "Callejero": osm, "Claro / Nombres nítidos": cartoClaro, "Híbrido Google": googleHybrid }, null, { position: 'topright' }).addTo(map);

    map.getContainer().style.touchAction = 'auto';
    map.on('click', gestionarPulsacion);

    inicializarInterfaz();
    setModo('numero');

    const urlParams = new URLSearchParams(window.location.search);
    const mapaCompartido = urlParams.get('mapa');
    if (mapaCompartido) {
        cargarMapaDesdeGithub(mapaCompartido);
    }
});

function inicializarInterfaz() {
    const btnNumber = document.getElementById('btn-numeros');
    const btnDraw = document.getElementById('btn-dibujo');
    const btnErase = document.getElementById('btn-borrar');
    const colorPicker = document.getElementById('color-picker');
    const grosorInput = document.getElementById('grosor-range');
    const opacidadInput = document.getElementById('opacidad-range');

    if (opacidadInput) opacidadInput.value = 1;
    if (grosorInput) grosorInput.value = 4;

    if (btnNumber) btnNumber.addEventListener('click', () => setModo('numero'));
    if (btnDraw) btnDraw.addEventListener('click', () => setModo('dibujar'));
    if (btnErase) btnErase.addEventListener('click', () => setModo('borrar'));

    if (colorPicker) colorPicker.addEventListener('input', actualizarEstilosGlobales);
    if (grosorInput) grosorInput.addEventListener('input', actualizarEstilosGlobales);
    if (opacidadInput) opacidadInput.addEventListener('input', actualizarEstilosGlobales);

    const btnCortar = document.getElementById('btn-cortar');
    const btnDeshacer = document.getElementById('btn-deshacer');
    const btnRehacer = document.getElementById('btn-rehacer');
    const btnBorrarTodo = document.getElementById('btn-borrar-todo');
    const btnGuardar = document.getElementById('btn-guardar');
    const btnCargar = document.getElementById('btn-cargar');
    const btnCompartir = document.getElementById('btn-compartir');
    const btnToken = document.getElementById('btn-token');
    const selectRutaType = document.getElementById('route-type-select');

    if (btnCortar) btnCortar.addEventListener('click', cortarTramoActual);
    if (btnDeshacer) btnDeshacer.addEventListener('click', deshacerUltimo);
    if (btnRehacer) btnRehacer.addEventListener('click', rehacerProximo);
    
    if (btnBorrarTodo) {
        btnBorrarTodo.addEventListener('click', () => {
            if (confirm("¿Estás seguro de que quieres borrar todo el mapa? Esta acción eliminará los elementos actuales.")) {
                borrarTodo();
            }
        });
    }
    
    if (btnGuardar) btnGuardar.onclick = () => abrirModalGithub('guardar');
    if (btnCargar) btnCargar.onclick = () => abrirModalGithub('cargar');
    if (btnCompartir) btnCompartir.onclick = () => abrirModalGithub('compartir');

    if (btnToken) btnToken.addEventListener('click', cambiarToken);
    
    if (selectRutaType) {
        selectRutaType.addEventListener('change', (e) => {
            submodoNumero = (e.target.value === 'callejero') ? 'ruta' : 'aislado';
            if (submodoNumero === 'aislado') ultimoPuntoTramo = null;
        });
    }
}

function setModo(modo) {
    modoActual = modo;
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();

    const btnNumEl = document.getElementById('btn-numeros');
    const btnDrawEl = document.getElementById('btn-dibujo');
    const btnErrEl = document.getElementById('btn-borrar');
    
    if (btnNumEl) btnNumEl.className = modo === 'numero' ? 'btn btn-blue' : 'btn btn-gray';
    if (btnDrawEl) btnDrawEl.className = modo === 'dibujar' ? 'btn btn-blue' : 'btn btn-gray';
    if (btnErrEl) btnErrEl.className = modo === 'borrar' ? 'btn btn-red' : 'btn btn-gray';

    if (modo === 'dibujar') ultimoPuntoTramo = null;
}

function obtenerEstilosActuales() {
    const colorEl = document.getElementById('color-picker');
    const grosorEl = document.getElementById('grosor-range');
    const opacidadEl = document.getElementById('opacidad-range');

    return {
        color: colorEl ? colorEl.value : '#3388ff',
        weight: grosorEl ? parseInt(grosorEl.value) : 4,
        opacity: opacidadEl ? parseFloat(opacidadEl.value) : 1
    };
}

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast-aviso');
    if (!toast) return;
    toast.innerText = mensaje;
    toast.style.opacity = '1';
    
    setTimeout(() => {
        toast.style.opacity = '0';
    }, 2500);
}

function cortarTramoActual() {
    ultimoPuntoTramo = null;
    window.puntosDibujoLibre = [];
    trazoLibreActivo = false; 
    mostrarToast("Próximo punto iniciado como un trazado nuevo independiente.");
}

function recalcularContadorNumeros() {
    const marcadoresRestantes = historialAcciones.filter(item => item.tipo === 'marcador');
    if (marcadoresRestantes.length === 0) {
        contadorNumero = 1;
    } else {
        const maxNum = Math.max(...marcadoresRestantes.map(m => m.numero));
        contadorNumero = maxNum + 1;
    }
}

let ultimoToqueTiempo = 0;

async function gestionarPulsacion(e) {
    const latlng = e.latlng;
    const estilos = obtenerEstilosActuales();

    const tiempoActual = new Date().getTime();
    if (tiempoActual - ultimoToqueTiempo < 350) {
        cortarTramoActual();
    }
    ultimoToqueTiempo = tiempoActual;

    if (modoActual === 'borrar') return; 

    if (modoActual === 'dibujar') {
        if (!window.puntosDibujoLibre || !trazoLibreActivo) {
            window.puntosDibujoLibre = [];
            trazoLibreActivo = true;
        }

        window.puntosDibujoLibre.push(latlng);

        if (window.puntosDibujoLibre.length > 1) {
            const pAnt = window.puntosDibujoLibre[window.puntosDibujoLibre.length - 2];
            const lineaLibre = L.polyline([pAnt, latlng], {
                color: estilos.color,
                weight: estilos.weight,
                opacity: estilos.opacity,
                interactive: true,
                bubblingMouseEvents: false
            }).addTo(map);

            lineaLibre.on('click', function(ev) {
                if (modoActual === 'borrar') {
                    L.DomEvent.stopPropagation(ev);
                    map.removeLayer(lineaLibre);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== lineaLibre);
                }
            });

            historialAcciones.push({ tipo: 'linea', elemento: lineaLibre });

            const ultimoMarcadorLibre = historialAcciones.slice().reverse().find(item => item.tipo === 'marcador-libre');
            if (ultimoMarcadorLibre && ultimoMarcadorLibre.elemento) {
                map.removeLayer(ultimoMarcadorLibre.elemento);
                historialAcciones = historialAcciones.filter(item => item !== ultimoMarcadorLibre);
            }
        }

        const radioPuntoLibre = Math.max(2, Math.round(estilos.weight * 0.8));
        
        const markerLibre = L.marker(latlng, {
            icon: L.divIcon({
                className: 'circle-marker-icon',
                html: `<div style="width: ${radioPuntoLibre*2}px; height: ${radioPuntoLibre*2}px; background-color: ${estilos.color}; opacity: ${estilos.opacity}; border-radius: 50%; border: 1px solid white;"></div>`,
                iconSize: [radioPuntoLibre*2, radioPuntoLibre*2],
                iconAnchor: [radioPuntoLibre, radioPuntoLibre]
            }),
            draggable: true,
            interactive: true,
            bubblingMouseEvents: false
        }).addTo(map);

        markerLibre.on('click', function(ev) {
            if (modoActual === 'borrar') {
                L.DomEvent.stopPropagation(ev);
                map.removeLayer(markerLibre);
                historialAcciones = historialAcciones.filter(item => item.elemento !== markerLibre);
            }
        });

        historialAcciones.push({ tipo: 'marcador-libre', elemento: markerLibre });
        historialRehacer = [];
        return;
    }

    if (modoActual === 'numero') {
        const numeroActual = contadorNumero;

        const numberIcon = L.divIcon({
            className: 'number-icon',
            html: `<span>${numeroActual}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        });

        const marker = L.marker(latlng, { icon: numberIcon, draggable: true, interactive: true, bubblingMouseEvents: false }).addTo(map);
        
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
                recalcularContadorNumeros();
            }
        });

        let lineaAsociada = null;

        if (submodoNumero === 'ruta' && ultimoPuntoTramo) {
            const coordenadasCalle = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);

            if (coordenadasCalle && coordenadasCalle.length > 0) {
                lineaAsociada = L.polyline(coordenadasCalle, {
                    color: estilos.color,
                    weight: estilos.weight,
                    opacity: estilos.opacity,
                    smoothFactor: 1,
                    interactive: true,
                    bubblingMouseEvents: false
                }).addTo(map);

                lineaAsociada.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(lineaAsociada);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== lineaAsociada);
                    }
                });

                marker.lineaAsociada = lineaAsociada;
                historialAcciones.push({ tipo: 'linea', elemento: lineaAsociada });
            }
        }

        if (submodoNumero === 'ruta') {
            ultimoPuntoTramo = latlng;
        } else {
            ultimoPuntoTrad = null;
        }

        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: numeroActual, color: estilos.color, submodo: submodoNumero });
        historialRehacer = [];
        contadorNumero++;
    }
}
async function obtenerRutaPorCallesOSRM(origen, destino) {
    // Usamos el perfil 'car' pero con una aproximación o bien OSRM flexible pasando por alto restricciones 
    // Si prefieres que ignore por completo sentidos únicos peatonales/de tráfico, usamos el perfil de coche 
    // permitiendo flexibilidad o uniendo en línea recta inteligente si falla.
    // Nota: OSRM público oficial 'foot' respeta algunas direcciones de calles. Para ir completamente a contradirección 
    // sin restricciones estrictas de sentido único urbano, podemos usar puntos intermedios o una directriz abierta.
    const url = `https://router.project-osrm.org/route/v1/driving/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson&continue_straight=true`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            }
        }
    } catch (e) {
        console.warn("Error OSRM:", e);
    }
    return [origen, destino];
}

function deshacerUltimo() {
    if (historialAcciones.length === 0) return;
    const ultimaAccion = historialAcciones.pop();
    if (ultimaAccion && ultimaAccion.elemento) {
        map.removeLayer(ultimaAccion.elemento);
        historialRehacer.push(ultimaAccion);

        if (ultimaAccion.tipo === 'marcador') {
            if (ultimaAccion.elemento.lineaAsociada) {
                map.removeLayer(ultimaAccion.elemento.lineaAsociada);
                historialAcciones = historialAcciones.filter(item => item.elemento !== ultimaAccion.elemento.lineaAsociada);
                historialRehacer.push({ tipo: 'linea', elemento: ultimaAccion.elemento.lineaAsociada });
            }
            recalcularContadorNumeros();
            const ultimoMarcadorRuta = historialAcciones.slice().reverse().find(item => item.tipo === 'marcador' && item.submodo === 'ruta');
            ultimoPuntoTramo = ultimoMarcadorRuta ? ultimoMarcadorRuta.elemento.getLatLng() : null;
        }
    }
}

function rehacerProximo() {
    if (historialRehacer.length === 0) return;
    const accionRehacer = historialRehacer.pop();
    if (accionRehacer && accionRehacer.elemento) {
        accionRehacer.elemento.addTo(map);
        historialAcciones.push(accionRehacer);
        if (accionRehacer.tipo === 'marcador') {
            recalcularContadorNumeros();
            if (accionRehacer.submodo === 'ruta') {
                ultimoPuntoTramo = accionRehacer.elemento.getLatLng();
            }
        }
    }
}

function borrarTodo() {
    historialAcciones.forEach(item => { if (item && item.elemento) map.removeLayer(item.elemento); });
    historialRehacer.forEach(item => { if (item && item.elemento) map.removeLayer(item.elemento); });
    historialAcciones = [];
    historialRehacer = [];
    ultimoPuntoTramo = null;
    contadorNumero = 1;
    window.puntosDibujoLibre = [];
    trazoLibreActivo = false;
}

function actualizarEstilosGlobales() {
    const estilos = obtenerEstilosActuales();
    const nuevoRadioLibre = Math.max(2, Math.round(estilos.weight * 0.8));

    historialAcciones.forEach(item => {
        if (!item || !item.elemento) return;
        if (item.tipo === 'linea') {
            item.elemento.setStyle({ color: estilos.color, weight: estilos.weight, opacity: estilos.opacity });
        } else if (item.tipo === 'marcador-libre') {
            item.elemento.setIcon(L.divIcon({
                className: 'circle-marker-icon',
                html: `<div style="width: ${nuevoRadioLibre*2}px; height: ${nuevoRadioLibre*2}px; background-color: ${estilos.color}; opacity: ${estilos.opacity}; border-radius: 50%; border: 1px solid white;"></div>`,
                iconSize: [nuevoRadioLibre*2, nuevoRadioLibre*2],
                iconAnchor: [nuevoRadioLibre, nuevoRadioLibre]
            }));
        }
    });
}

// --- GITHUB ---

function obtenerToken() {
    let token = localStorage.getItem('github_token');
    if (!token) {
        token = prompt("Introduce tu Personal Access Token de GitHub:");
        if (token) localStorage.setItem('github_token', token.trim());
    }
    return token;
}

function cambiarToken() {
    const tokenActual = localStorage.getItem('github_token') || "";
    const nuevoToken = prompt("Introduce tu Personal Access Token de GitHub:", tokenActual);
    if (nuevoToken !== null) {
        localStorage.setItem('github_token', nuevoToken.trim());
        alert("Token actualizado correctamente.");
    }
}

function exportarDatosMapa() {
    const elementos = [];
    historialAcciones.forEach(item => {
        if (!item || !item.elemento) return;
        if (item.tipo === 'linea') {
            const latlngs = item.elemento.getLatLngs().map(ll => [ll.lng, ll.lat]);
            elementos.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: latlngs },
                properties: { tipo: "linea", color: item.elemento.options.color, weight: item.elemento.options.weight, opacity: item.elemento.options.opacity }
            });
        } else if (item.tipo === 'marcador') {
            const ll = item.elemento.getLatLng();
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: { tipo: "marcador", numero: item.numero, color: item.color || "#3388ff", submodo: item.submodo || "ruta" }
            });
        } else if (item.tipo === 'marcador-libre') {
            const ll = item.elemento.getLatLng();
            const iconHtml = item.elemento.options.icon.options.html || "";
            elementos.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: [ll.lng, ll.lat] },
                properties: { tipo: "marcador-libre", htmlIcon: iconHtml }
            });
        }
    });
    return { type: "FeatureCollection", features: elementos };
}

async function guardarEnGithub(nombreArchivo) {
    const token = obtenerToken();
    if (!token) return alert("Se requiere un Token de GitHub para guardar.");

    const path = `${GITHUB_FOLDER}/${nombreArchivo.trim().toLowerCase().replace(/\s+/g, '-')}.json`;
    const contenido = JSON.stringify(exportarDatosMapa(), null, 2);
    const contenidoBase64 = btoa(unescape(encodeURIComponent(contenido)));
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        let sha = null;
        const resExist = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (resExist.ok) {
            const dataExist = await resExist.json();
            sha = dataExist.sha;
        }

        const body = { message: `Guardar mapa: ${nombreArchivo}`, content: contenidoBase64 };
        if (sha) body.sha = sha;

        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (res.ok) {
            alert("¡Mapa guardado con éxito!");
            cerrarModal();
        } else {
            const errData = await res.json();
            alert(`Error al guardar: ${errData.message}`);
        }
    } catch (e) {
        alert(`Error de conexión: ${e.message}`);
    }
}

async function abrirModalGithub(accion) {
    const token = obtenerToken();
    if (!token) return;

    const modal = document.getElementById('modal-load');
    const listaContainer = document.getElementById('lista-mapas');
    const tituloModal = document.getElementById('modal-titulo');
    
    if (!modal || !listaContainer) return;
    
    modal.style.display = 'flex';
    listaContainer.innerHTML = 'Cargando mapas...';

    if (accion === 'guardar') tituloModal.innerText = 'Guardar Mapa en GitHub';
    else if (accion === 'cargar') tituloModal.innerText = 'Cargar Mapa de GitHub';
    else if (accion === 'compartir') tituloModal.innerText = 'Compartir Mapa de GitHub';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;

    try {
        const res = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        let jsonFiles = [];
        if (res.ok) {
            const archivos = await res.json();
            jsonFiles = archivos.filter(f => f.name.endsWith('.json'));
        }

        listaContainer.innerHTML = '';

        if (accion === 'guardar') {
            const divNuevo = document.createElement('div');
            divNuevo.style.marginBottom = '12px';
            divNuevo.innerHTML = `<button class="btn btn-blue" style="width: 100%; padding: 8px;" onclick="promptGuardarNuevo()">+ Guardar como mapa nuevo...</button>`;
            listaContainer.appendChild(divNuevo);
        }

        if (jsonFiles.length === 0) {
            if (accion !== 'guardar') listaContainer.innerHTML = 'No se encontraron mapas guardados.';
            return;
        }

        if (accion === 'guardar' && jsonFiles.length > 0) {
            const titulo = document.createElement('div');
            titulo.style.fontSize = '12px';
            titulo.style.color = '#666';
            titulo.style.marginBottom = '6px';
            titulo.innerText = 'O sobrescribir existente:';
            listaContainer.appendChild(titulo);
        }

        jsonFiles.forEach(file => {
            const nombreLimpio = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '8px';
            item.style.borderBottom = '1px solid #eee';

            let botonesHtml = '';
            if (accion === 'guardar') {
                botonesHtml = `<button class="btn btn-blue" style="padding: 4px 10px; font-size: 13px;" onclick="guardarEnGithub('${nombreLimpio}')">Sobrescribir</button>`;
            } else if (accion === 'cargar') {
                botonesHtml = `
                    <div style="display: flex; gap: 6px;">
                        <button class="btn btn-blue" style="padding: 4px 10px; font-size: 13px;" onclick="cargarMapaDesdeGithub('${file.name}')">Cargar</button>
                        <button class="btn btn-red" style="padding: 4px 10px; font-size: 13px;" onclick="eliminarMapaDeGithub('${file.name}', '${file.sha}', '${accion}')">🗑️</button>
                    </div>`;
            } else if (accion === 'compartir') {
                botonesHtml = `<button class="btn btn-yellow" style="padding: 4px 10px; font-size: 13px; color: black;" onclick="compartirMapaEspecifico('${file.name}')">Compartir</button>`;
            }

            item.innerHTML = `<span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">${nombreLimpio}</span>${botonesHtml}`;
            listaContainer.appendChild(item);
        });
    } catch (e) {
        listaContainer.innerHTML = `Error de conexión: ${e.message}`;
    }
}

function promptGuardarNuevo() {
    const nombre = prompt("Introduce el nombre para el nuevo mapa:");
    if (nombre && nombre.trim() !== "") {
        guardarEnGithub(nombre.trim());
    }
}

async function eliminarMapaDeGithub(fileName, sha, accionOrigen) {
    const token = obtenerToken();
    if (!token) return;
    if (!confirm(`¿Eliminar permanentemente el mapa "${fileName.replace('.json', '')}"?`)) return;

    const path = `${GITHUB_FOLDER}/${fileName}`;
    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${path}`;

    try {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: `Eliminar ${fileName}`, sha: sha })
        });

        if (res.ok) {
            alert("Mapa eliminado correctamente.");
            abrirModalGithub(accionOrigen); 
        } else {
            const errData = await res.json();
            alert(`Error al eliminar: ${errData.message}`);
        }
    } catch (e) {
        alert(`Error de conexión: ${e.message}`);
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
                    opacity: feature.properties.opacity,
                    interactive: true,
                    bubblingMouseEvents: false
                }).addTo(map);

                polyline.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(polyline);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== polyline);
                    }
                });

                historialAcciones.push({ tipo: 'linea', elemento: polyline });
                bounds.push(...latlngs);
            } else if (feature.properties.tipo === 'marcador') {
                const coord = feature.geometry.coordinates;
                const latlng = [coord[1], coord[0]];
                const num = feature.properties.numero;
                const color = feature.properties.color || "#3388ff";
                const sub = feature.properties.submodo || "ruta";

                const numberIcon = L.divIcon({
                    className: 'number-icon',
                    html: `<span>${num}</span>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                });

                const marker = L.marker(latlng, { icon: numberIcon, draggable: true, interactive: true, bubblingMouseEvents: false }).addTo(map);
                setTimeout(() => {
                    const el = marker.getElement();
                    if (el) el.style.backgroundColor = color;
                }, 10);

                marker.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(marker);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== marker);
                        recalcularContadorNumeros();
                    }
                });

                historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, color: color, submodo: sub });
                bounds.push(latlng);

                if (sub === 'ruta') ultimoPuntoTramo = latlng;
                recalcularContadorNumeros();
            } else if (feature.properties.tipo === 'marcador-libre') {
                const coord = feature.geometry.coordinates;
                const latlng = [coord[1], coord[0]];
                const htmlIconStr = feature.properties.htmlIcon || `<div style="width: 8px; height: 8px; background-color: #3388ff; border-radius: 50%; border: 1px solid white;"></div>`;

                const markerLibre = L.marker(latlng, {
                    icon: L.divIcon({
                        className: 'circle-marker-icon',
                        html: htmlIconStr,
                        iconSize: [12, 12],
                        iconAnchor: [6, 6]
                    }),
                    draggable: true,
                    interactive: true,
                    bubblingMouseEvents: false
                }).addTo(map);

                markerLibre.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(markerLibre);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== markerLibre);
                    }
                });

                historialAcciones.push({ tipo: 'marcador-libre', elemento: markerLibre });
                bounds.push(latlng);
            }
        });

        if (bounds.length > 0) map.fitBounds(bounds);
        cerrarModal();
    } catch (e) {
        alert(`Error al cargar el mapa: ${e.message}`);
    }
}

async function compartirMapaEspecifico(fileName) {
    const nombreMapaLimpio = fileName.replace('.json', '');
    const baseUrl = window.location.href.split('?')[0];
    const shareUrl = `${baseUrl}?mapa=${fileName}`;
    const textoMensaje = `🗺️ ¡Mira esta ruta guardada "${nombreMapaLimpio}"!\n${shareUrl}`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: 'Ruta en Visor de Mapas',
                text: textoMensaje,
                url: shareUrl,
            });
            cerrarModal();
            return;
        } catch (err) {
            if (err.name === 'AbortError') return;
        }
    }

    const urlWhatsApp = `https://api.whatsapp.com/send?text=${encodeURIComponent(textoMensaje)}`;
    window.open(urlWhatsApp, '_blank');
    cerrarModal();
}