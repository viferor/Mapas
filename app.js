// Asegurar enlace directo de los botones Guardar y Cargar
document.addEventListener("DOMContentLoaded", function () {
    // ... (resto de tu código de inicialización del mapa) ...

    const btnGuardar = document.getElementById('btn-guardar');
    const btnCargar = document.getElementById('btn-cargar');

    if (btnGuardar) {
        btnGuardar.onclick = function() {
            abrirModalGuardarGithub();
        };
    }

    if (btnCargar) {
        btnCargar.onclick = function() {
            abrirModalCargarGithub();
        };
    }
});

async function abrirModalGuardarGithub() {
    const token = obtenerToken();
    if (!token) return;

    const modal = document.getElementById('modal-load');
    const listaContainer = document.getElementById('lista-mapas');
    if (!modal || !listaContainer) {
        alert("Falta el elemento modal-load en el HTML.");
        return;
    }
    
    modal.style.display = 'flex';
    listaContainer.innerHTML = 'Cargando mapas...';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `token ${token}` }
        });
        
        let jsonFiles = [];
        if (res.ok) {
            const archivos = await res.json();
            jsonFiles = archivos.filter(f => f.name.endsWith('.json'));
        }

        listaContainer.innerHTML = '';

        // Botón para crear un mapa nuevo
        const divNuevo = document.createElement('div');
        divNuevo.style.marginBottom = '12px';
        divNuevo.innerHTML = `
            <button class="btn btn-blue" style="width: 100%; padding: 8px;" onclick="promptGuardarNuevo()">+ Guardar como mapa nuevo...</button>
        `;
        listaContainer.appendChild(divNuevo);

        if (jsonFiles.length > 0) {
            const titulo = document.createElement('div');
            titulo.style.fontSize = '12px';
            titulo.style.color = '#666';
            titulo.style.marginBottom = '6px';
            titulo.innerText = 'O sobrescribir existente:';
            listaContainer.appendChild(titulo);

            jsonFiles.forEach(file => {
                const nombreLimpio = file.name.replace('.json', '');
                const item = document.createElement('div');
                item.style.display = 'flex';
                item.style.justifyContent = 'space-between';
                item.style.alignItems = 'center';
                item.style.padding = '8px';
                item.style.borderBottom = '1px solid #eee';

                item.innerHTML = `
                    <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 190px;">${nombreLimpio}</span>
                    <button class="btn btn-blue" style="padding: 4px 10px; font-size: 13px;" onclick="guardarEnGithub('${nombreLimpio}')">Sobrescribir</button>
                `;
                listaContainer.appendChild(item);
            });
        }
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

async function abrirModalCargarGithub() {
    const token = obtenerToken();
    if (!token) return;

    const modal = document.getElementById('modal-load');
    const listaContainer = document.getElementById('lista-mapas');
    if (!modal || !listaContainer) {
        alert("Falta el elemento modal-load en el HTML.");
        return;
    }
    
    modal.style.display = 'flex';
    listaContainer.innerHTML = 'Cargando mapas...';

    const url = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${GITHUB_FOLDER}`;

    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `token ${token}` }
        });
        if (!res.ok) throw new Error("No se pudo obtener la lista de mapas.");

        const archivos = await res.json();
        const jsonFiles = archivos.filter(f => f.name.endsWith('.json'));

        if (jsonFiles.length === 0) {
            listaContainer.innerHTML = 'No se encontraron mapas guardados.';
            return;
        }

        listaContainer.innerHTML = '';
        jsonFiles.forEach(file => {
            const nombreLimpio = file.name.replace('.json', '');
            const item = document.createElement('div');
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '8px';
            item.style.borderBottom = '1px solid #eee';

            item.innerHTML = `
                <span style="font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;">${nombreLimpio}</span>
                <div style="display: flex; gap: 6px;">
                    <button class="btn btn-blue" style="padding: 4px 10px; font-size: 13px;" onclick="cargarMapaDesdeGithub('${file.name}')">Cargar</button>
                    <button class="btn btn-red" style="padding: 4px 10px; font-size: 13px;" onclick="eliminarMapaDeGithub('${file.name}', '${file.sha}')">🗑️</button>
                </div>
            `;
            listaContainer.appendChild(item);
        });
    } catch (e) {
        listaContainer.innerHTML = `Error: ${e.message}`;
    }
}
