const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

let map;
let modoActual = 'ruta'; // 'ruta', 'aislado', 'dibujar_puntos', 'continuo', 'borrar'
let contadorNumero = 1;

let historialAcciones = [];
let historialRehacer = [];

let ultimoPuntoTramo = null; 
let trazoLibreActivo = false; 

let estaDibujandoLibre = false;
let polilineaContinuaActual = null;
let ultimoToqueTiempo = 0;

document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: false,
        touchZoom: true,
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

        polilineaContinuaActual.on('click', function(ev) {
            if (modoActual === 'borrar') {
                L.DomEvent.stopPropagation(ev);
                map.removeLayer(this);
                historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                mostrarToast("Línea borrada");
            }
        });

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
            const linea = L.polyline([pAnt, latlng], { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);

            linea.on('click', function(ev) {
                if (modoActual === 'borrar') {
                    L.DomEvent.stopPropagation(ev);
                    map.removeLayer(this);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                    mostrarToast("Segmento borrado");
                }
            });
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
                map.removeLayer(this);
                historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                if (this.lineaAsociada) {
                    map.removeLayer(this.lineaAsociada);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== this.lineaAsociada);
                }
                recalcularContadorNumeros();
                mostrarToast("Punto borrado");
            }
        });

        if (modoActual === 'ruta' && ultimoPuntoTramo) {
            const coords = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);
            if (coords && coords.length > 0) {
                const linea = L.polyline(coords, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                linea.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(this);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                        mostrarToast("Tramo borrado");
                    }
                });
                marker.lineaAsociada = linea;
                historialAcciones.push({ tipo: 'linea', elemento: linea });
            }
        }
        ultimoPuntoTramo = (modoActual === 'ruta') ? latlng : null;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: modoActual });
        historialRehacer = [];
        contadorNumero++;
    }
}
async function obtenerRutaPorCallesOSRM(origen, destino) {
    const url = `https://routing.openstreetmap.de/routed-bike/route/v1/bike/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`;
    try {
        const response = await fetch(url);
        if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes.length > 0) {
                return data.routes[0].geometry.coordinates.map(coord => [coord[1], coord[0]]);
            }
        }
    } catch (e) {}
    return [ [origen.lat, origen.lng], [destino.lat, destino.lng] ];
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
                
                linea.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(this);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                        mostrarToast("GPX borrado");
                    }
                });

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
            if (i && i.elemento) map.removeLayer(i.elemento);
        });
        historialRehacer.forEach(i => {
            if (i && i.elemento) map.removeLayer(i.elemento);
        });

        historialAcciones = [];
        historialRehacer = [];
        ultimoPuntoTramo = null;
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
        historialRehacer.push(accion);

        if (accion.tipo === 'marcador') {
            if (accion.elemento.lineaAsociada) {
                map.removeLayer(accion.elemento.lineaAsociada);
                historialAcciones = historialAcciones.filter(item => item.elemento !== accion.elemento.lineaAsociada);
                historialRehacer.push({ tipo: 'linea', elemento: accion.elemento.lineaAsociada });
            }
            recalcularContadorNumeros();
            const ultimo = historialAcciones.slice().reverse().find(i => i.tipo === 'marcador' && i.submodo === 'ruta');
            ultimoPuntoTramo = ultimo ? ultimo.elemento.getLatLng() : null;
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
        historialAcciones.push(accion);
        if (accion.tipo === 'marcador') {
            recalcularContadorNumeros();
            if (accion.submodo === 'ruta') ultimoPuntoTramo = accion.elemento.getLatLng();
        }
        mostrarToast("Rehecho");
    }
}

function obtenerToken() {
    let token = localStorage.getItem('github_token');
    if (!token) {
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
        const resExist = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        if (resExist.ok) sha = (await resExist.json()).sha;

        const body = { message: `Guardar mapa`, content: contenido };
        if (sha) body.sha = sha;

        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `token ${token}` }, body: JSON.stringify(body) });
        if (res.ok) { alert("¡Guardado!"); cerrarModal(); }
    } catch (e) { alert("Error: " + e.message); }
}

async function abrirModalGithub(accion) {
    const token = obtenerToken();
    if (!token) return;

    document.getElementById('modal-load').style.display = 'flex';
    const lista = document.getElementById('lista-mapas');
    lista.innerHTML = 'Cargando...';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;
    try {
        const res = await fetch(url, { headers: { 'Authorization': `token ${token}` } });
        const archivos = res.ok ? await res.json() : [];
        const jsonFiles = archivos.filter(f => f.name.endsWith('.json'));

        lista.innerHTML = accion === 'guardar' ? `<button class="btn btn-blue" style="width: 100%; margin-bottom:10px; border-radius:6px;" onclick="promptGuardarNuevo()">+ Nuevo...</button>` : '';

        if (jsonFiles.length === 0 && accion !== 'guardar') {
            lista.innerHTML = 'No hay mapas guardados.';
            return;
        }

        jsonFiles.forEach(file => {
            const n = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #ddd; padding-bottom:6px;';
            
            let btn = '';
            if (accion === 'guardar') btn = `<button class="btn btn-blue" style="border-radius:6px;" onclick="guardarEnGithub('${n}')">Sobrescribir</button>`;
            else if (accion === 'cargar') btn = `<button class="btn" style="border-radius:6px; background:#e0e0e0;" onclick="cargarMapaDesdeGithub('${file.name}')">Cargar</button>`;
            else if (accion === 'compartir') btn = `<button class="btn btn-yellow" style="border-radius:6px;" onclick="compartirMapaEspecifico('${file.name}')">Link</button>`;

            item.innerHTML = `<span style="font-weight:600;">${n}</span> ${btn}`;
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
            
            l.on('click', ev => { 
                if (modoActual === 'borrar') { 
                    L.DomEvent.stopPropagation(ev); 
                    mapInstance.removeLayer(l); 
                    historialAcciones = hist_acciones_filtrar(l); // Ajuste interno
                    mostrarToast("Línea borrada"); 
                } 
            });
            
            historialAcciones.push({ tipo: 'linea', elemento: l });
            grupoCapas.addLayer(l);

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

        if (lineas.length === 0) {
            alert("El archivo de texto está vacío o no contiene líneas válidas.");
            event.target.value = '';
            return;
        }

        mostrarToast(`Geocodificando ${lineas.length} calles en Córdoba...`);
        let grupoCapas = L.featureGroup();
        let puntosCoordenadas = [];
        let textosNoReconocidos = [];

        for (let nombre of lineas) {
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

            let encontradoValido = false;

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
                await new Promise(r => setTimeout(r, 200));
            }

            if (!encontradoValido) {
                if (!textosNoReconocidos.includes(nombre)) {
                    textosNoReconocidos.push(nombre);
                }
            }
            await new Promise(r => setTimeout(r, 250));
        }

        if (textosNoReconocidos.length > 0) {
            alert(`⚠️ Atención: Las siguientes calles del archivo no se han podido reconocer en Córdoba y han sido descartadas:\n\n- ${textosNoReconocidos.join('\n- ')}`);
        }

        if (puntosCoordenadas.length === 0) {
            alert("No se ha podido trazar ninguna ruta porque ninguna calle del archivo coincide con el callejero.");
            event.target.value = '';
            return;
        }

        let ultimoPunto = null;
        const estilos = obtenerEstilosActuales();

        for (let i = 0; i < puntosCoordenadas.length; i++) {
            const pt = puntosCoordenadas[i];
            const num = contadorNumero;
            
            const icon = L.divIcon({ className: 'number-icon', html: `<span>${num}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
            const marker = L.marker(pt.latlng, { icon: icon, draggable: true, interactive: true }).addTo(map);
            
            marker.on('click', function(ev) {
                if (modoActual === 'borrar') {
                    L.DomEvent.stopPropagation(ev);
                    map.removeLayer(this);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                    if (this.lineaAsociada) {
                        map.removeLayer(this.lineaAsociada);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== this.lineaAsociada);
                    }
                    recalcularContadorNumeros();
                    mostrarToast("Punto borrado");
                }
            });

            grupoCapas.addLayer(marker);

            if (ultimoPunto) {
                const coordsRuta = await obtenerRutaPorCallesOSRM(ultimoPunto, pt.latlng);
                if (coordsRuta && coordsRuta.length > 0) {
                    const linea = L.polyline(coordsRuta, { color: estilos.color, weight: estilos.weight, opacity: estilos.opacity, interactive: true }).addTo(map);
                    linea.on('click', function(ev) {
                        if (modoActual === 'borrar') {
                            L.DomEvent.stopPropagation(ev);
                            map.removeLayer(this);
                            historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                            mostrarToast("Tramo borrado");
                        }
                    });
                    marker.lineaAsociada = linea;
                    historialAcciones.push({ tipo: 'linea', elemento: linea });
                    grupoCapas.addLayer(linea);
                }
            }

            ultimoPunto = pt.latlng;
            historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: 'ruta' });
            contadorNumero++;
        }

        historialRehacer = [];
        enfocarMapaEnGrupo(grupoCapas, map);
        mostrarToast("¡Ruta procesada desde archivo de texto!");
        event.target.value = '';
    };

    lector.readAsText(archivo);
}

