const GITHUB_USER = "viferor"; 
const GITHUB_REPO = "Mapas"; 
const GITHUB_FOLDER = "mapas"; 

let map;
let modoActual = 'numero'; 
let submodoNumero = 'ruta'; // 'ruta' (callejero) o 'aislado'
let submodoDibujo = 'puntos'; // 'puntos' o 'continuo'
let contadorNumero = 1;

let historialAcciones = [];
let historialRehacer = [];

let ultimoPuntoTramo = null; 
let trazoLibreActivo = false; 

let estaDibujandoLibre = false;
let polilineaContinuaActual = null;

document.addEventListener("DOMContentLoaded", function () {
    map = L.map('map', {
        zoomControl: false,
        touchZoom: true,
        tap: false 
    }).setView([37.8882, -4.7794], 13);

    const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const cartoClaro = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 20, attribution: '&copy; OpenStreetMap & CARTO' });
    const googleHybrid = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', { maxZoom: 20, subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], attribution: '&copy; Google Maps' });

    osm.addTo(map);
    L.control.layers({ "Callejero": osm, "Claro": cartoClaro, "Google": googleHybrid }, null, { position: 'topright' }).addTo(map);

    map.on('click', gestionarPulsacion);

    inicializarInterfaz();
    configurarDibujoTactilTablet();
    setModo('numero');

    const urlParams = new URLSearchParams(window.location.search);
    const mapaCompartido = urlParams.get('mapa');
    if (mapaCompartido) cargarMapaDesdeGithub(mapaCompartido);
});

function inicializarInterfaz() {
    const btnNumber = document.getElementById('btn-numeros');
    const btnDraw = document.getElementById('btn-dibujo');
    const btnErase = document.getElementById('btn-borrar');

    // Botón Puntos: Si ya está activo, despliega el menú flotante de selección
    if (btnNumber) {
        btnNumber.addEventListener('click', (e) => {
            e.stopPropagation();
            cerrarMenusFlotantes();
            if (modoActual !== 'numero') {
                setModo('numero');
            } else {
                toggleMenu('menu-puntos');
            }
        });
    }
    
    // Botón Dibujar: Si ya está activo, despliega el menú flotante de selección
    if (btnDraw) {
        btnDraw.addEventListener('click', (e) => {
            e.stopPropagation();
            cerrarMenusFlotantes();
            if (modoActual !== 'dibujar') {
                setModo('dibujar');
            } else {
                toggleMenu('menu-dibujo');
            }
        });
    }

    if (btnErase) {
        btnErase.addEventListener('click', (e) => {
            e.stopPropagation();
            cerrarMenusFlotantes();
            setModo('borrar');
        });
    }

    document.addEventListener('click', () => cerrarMenusFlotantes());

    document.getElementById('btn-cortar')?.addEventListener('click', cortarTramoActual);
    document.getElementById('btn-deshacer')?.addEventListener('click', deshacerUltimo);
    document.getElementById('btn-rehacer')?.addEventListener('click', rehacerProximo);
    
    document.getElementById('btn-guardar').onclick = () => abrirModalGithub('guardar');
    document.getElementById('btn-cargar').onclick = () => abrirModalGithub('cargar');
    document.getElementById('btn-compartir').onclick = () => abrirModalGithub('compartir');
}

function cerrarMenusFlotantes() {
    document.getElementById('menu-puntos').style.display = 'none';
    document.getElementById('menu-dibujo').style.display = 'none';
}

function toggleMenu(id) {
    const menu = document.getElementById(id);
    const visible = menu.style.display === 'flex';
    cerrarMenusFlotantes();
    menu.style.display = visible ? 'none' : 'flex';
}

function cambiarSubmodoNumero(sub) {
    submodoNumero = sub;
    if (sub === 'aislado') ultimoPuntoTramo = null;
    cerrarMenusFlotantes();
    actualizarTextosBotones();
    mostrarToast(sub === 'ruta' ? "Modo: Callejero OSRM" : "Modo: Puntos Aislados");
}

function cambiarSubmodoDibujo(sub) {
    submodoDibujo = sub;
    cortarTramoActual();
    cerrarMenusFlotantes();
    actualizarTextosBotones();
    mostrarToast(sub === 'continuo' ? "Modo: Mano alzada continua" : "Modo: Punto a punto");
}

function setModo(modo) {
    modoActual = modo;
    map.dragging.enable();
    cerrarMenusFlotantes();
    actualizarTextosBotones();
    if (modo === 'dibujar') ultimoPuntoTramo = null;
}

function actualizarTextosBotones() {
    const btnNum = document.getElementById('btn-numeros');
    const btnDraw = document.getElementById('btn-dibujo');
    const btnErr = document.getElementById('btn-borrar');

    btnNum.className = modo === 'numero' ? 'btn btn-blue' : 'btn';
    btnDraw.className = modo === 'dibujar' ? 'btn btn-blue' : 'btn';
    btnErr.className = modo === 'borrar' ? 'btn btn-red' : 'btn';

    // Textos dinámicos según el submodo escogido
    if (modoActual === 'numero') {
        btnNum.innerText = submodoNumero === 'ruta' ? '📍 Callejero' : '📍 Aislados';
    } else {
        btnNum.innerText = '📍 Puntos';
    }

    if (modoActual === 'dibujar') {
        btnDraw.innerText = submodoDibujo === 'continuo' ? '✏️ Mano alzada' : '✏️ Puntos rectos';
    } else {
        btnDraw.innerText = '✏️ Dibujar';
    }

    // Actualizar clases activas en los menús flotantes
    document.getElementById('sub-callejero').className = submodoNumero === 'ruta' ? 'active' : '';
    document.getElementById('sub-aislado').className = submodoNumero === 'aislado' ? 'active' : '';
    document.getElementById('sub-rectos').className = submodoDibujo === 'puntos' ? 'active' : '';
    document.getElementById('sub-continuo').className = submodoDibujo === 'continuo' ? 'active' : '';
}

function obtenerEstilosActuales() {
    return { color: '#3388ff', weight: 4, opacity: 1 };
}

function mostrarToast(mensaje) {
    const toast = document.getElementById('toast-aviso');
    if (!toast) return;
    toast.innerText = mensaje;
    toast.style.opacity = '1';
    setTimeout(() => toast.style.opacity = '0', 2500);
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
        if (modoActual !== 'dibujar' || submodoDibujo !== 'continuo') return;
        if (e.touches.length > 1) { estaDibujandoLibre = false; return; }

        e.preventDefault(); 
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
            }
        });

        historialAcciones.push({ tipo: 'linea', elemento: polilineaContinuaActual });
        historialRehacer = [];
    }, { passive: false });

    mapaContenedor.addEventListener('touchmove', (e) => {
        if (!estaDibujandoLibre || !polilineaContinuaActual) return;
        if (e.touches.length > 1) return;

        e.preventDefault(); 
        const touch = e.touches[0];
        const rect = mapaContenedor.getBoundingClientRect();
        const latlng = map.containerPointToLatLng(L.point(touch.clientX - rect.left, touch.clientY - rect.top));
        polilineaContinuaActual.addLatLng(latlng);
    }, { passive: false });

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
let ultimoToqueTiempo = 0;

async function gestionarPulsacion(e) {
    if (modoActual === 'dibujar' && submodoDibujo === 'continuo') return; 

    const latlng = e.latlng;
    const estilos = obtenerEstilosActuales();

    const tiempoActual = new Date().getTime();
    if (tiempoActual - ultimoToqueTiempo < 350) cortarTramoActual();
    ultimoToqueTiempo = tiempoActual;

    if (modoActual === 'borrar') return; 

    if (modoActual === 'dibujar' && submodoDibujo === 'puntos') {
        if (!window.puntosDibujoLibre || !trazoLibreActivo) {
            window.puntosDibujoLibre = [];
            trazoLibreActivo = true;
        }
        window.puntosDibujoLibre.push(latlng);

        if (window.puntosDibujoLibre.length > 1) {
            const pAnt = window.puntosDibujoLibre[window.puntosDibujoLibre.length - 2];
            const linea = L.polyline([pAnt, latlng], { color: estilos.color, weight: estilos.weight, interactive: true }).addTo(map);

            linea.on('click', function(ev) {
                if (modoActual === 'borrar') {
                    L.DomEvent.stopPropagation(ev);
                    map.removeLayer(this);
                    historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                }
            });
            historialAcciones.push({ tipo: 'linea', elemento: linea });
        }
        historialRehacer = [];
        return;
    }

    if (modoActual === 'numero') {
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
            }
        });

        if (submodoNumero === 'ruta' && ultimoPuntoTramo) {
            const coords = await obtenerRutaPorCallesOSRM(ultimoPuntoTramo, latlng);
            if (coords && coords.length > 0) {
                const linea = L.polyline(coords, { color: estilos.color, weight: estilos.weight, interactive: true }).addTo(map);
                linea.on('click', function(ev) {
                    if (modoActual === 'borrar') {
                        L.DomEvent.stopPropagation(ev);
                        map.removeLayer(this);
                        historialAcciones = historialAcciones.filter(item => item.elemento !== this);
                    }
                });
                marker.lineaAsociada = linea;
                historialAcciones.push({ tipo: 'linea', elemento: linea });
            }
        }
        ultimoPuntoTramo = (submodoNumero === 'ruta') ? latlng : null;
        historialAcciones.push({ tipo: 'marcador', elemento: marker, numero: num, submodo: submodoNumero });
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

function deshacerUltimo() {
    if (historialAcciones.length === 0) return;
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
    }
}

function rehacerProximo() {
    if (historialRehacer.length === 0) return;
    const accion = historialRehacer.pop();
    if (accion && accion.elemento) {
        accion.elemento.addTo(map);
        historialAcciones.push(accion);
        if (accion.tipo === 'marcador') {
            recalcularContadorNumeros();
            if (accion.submodo === 'ruta') ultimoPuntoTramo = accion.elemento.getLatLng();
        }
    }
}

function obtenerToken() {
    let token = localStorage.getItem('github_token');
    if (!token) {
        token = prompt("Token GitHub:");
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
                properties: { tipo: "linea", color: item.elemento.options.color }
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

        jsonFiles.forEach(file => {
            const n = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #ccc; padding-bottom:4px;';
            
            let btn = '';
            if (accion === 'guardar') btn = `<button class="btn btn-blue" style="border-radius:6px;" onclick="guardarEnGithub('${n}')">Sobrescribir</button>`;
            else if (accion === 'cargar') btn = `<button class="btn" style="border-radius:6px; background:#ddd;" onclick="cargarMapaDesdeGithub('${file.name}')">Cargar</button>`;
            else if (accion === 'compartir') btn = `<button class="btn btn-yellow" style="border-radius:6px;" onclick="compartirMapaEspecifico('${file.name}')">Link</button>`;

            item.innerHTML = `<span>${n}</span> ${btn}`;
            lista.appendChild(item);
        });
    } catch (e) { lista.innerHTML = "Error de conexión"; }
}

function promptGuardarNuevo() {
    const n = prompt("Nombre:");
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

        geojson.features.forEach(f => {
            if (f.properties.tipo === 'linea') {
                const ll = f.geometry.coordinates.map(c => [c[1], c[0]]);
                const l = L.polyline(ll, { color: f.properties.color, interactive: true }).addTo(map);
                l.on('click', ev => { if(modoActual==='borrar'){ L.DomEvent.stopPropagation(ev); map.removeLayer(l); }});
                historialAcciones.push({ tipo: 'linea', elemento: l });
            } else if (f.properties.tipo === 'marcador') {
                const latlng = [f.geometry.coordinates[1], f.geometry.coordinates[0]];
                const m = L.marker(latlng, { icon: L.divIcon({ className: 'number-icon', html: `<span>${f.properties.numero}</span>`, iconSize: [28,28], iconAnchor:[14,14] }), interactive: true }).addTo(map);
                m.on('click', ev => { if(modoActual==='borrar'){ L.DomEvent.stopPropagation(ev); map.removeLayer(m); }});
                historialAcciones.push({ tipo: 'marcador', elemento: m, numero: f.properties.numero });
            }
        });
        recalcularContadorNumeros();
        cerrarModal();
    } catch (e) { alert("Error al cargar"); }
}

async function compartirMapaEspecifico(fileName) {
    const link = `${window.location.href.split('?')[0]}?mapa=${fileName}`;
    if (navigator.share) {
        try { await navigator.share({ title: 'Ruta', url: link }); cerrarModal(); return; } catch (e) {}
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(link)}`, '_blank');
    cerrarModal();
}

